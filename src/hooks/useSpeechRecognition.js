import { useEffect, useRef, useState, useCallback } from 'react'

// ── VAD thresholds (0–255 AnalyserNode byte frequency average) ────────────
// Two-threshold hysteresis: prevents background noise from falsely triggering
// "speech detected" or blocking "silence detected" independently.
const VOICE_THRESHOLD   = 35    // avg must EXCEED this to mark speech as started
const SILENCE_THRESHOLD = 18    // avg must DROP BELOW this to mark silence

const SILENCE_MS        = 1200  // ms of silence after speech before we stop
const MIN_RECORD_MS     = 300   // never stop before this (avoids clipping first word)
const MAX_WAIT_MS       = 5000  // give up and call onNoSpeech if nothing heard
const MAX_RECORD_MS     = 25000 // absolute safety cap (Whisper file size limit)
const VAD_POLL_MS       = 100   // VAD check interval

const GROQ_URL          = 'https://api.groq.com/openai/v1/audio/transcriptions'
const WHISPER_MODEL     = 'whisper-large-v3-turbo'

// Derive file extension from MIME type for Whisper's format detection
function mimeExt(mime = '') {
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4')) return 'mp4'
  return 'webm'
}

// Pick the best supported MediaRecorder MIME type for this browser
function bestMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ]
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) || ''
}

export function useSpeechRecognition({ onResult, onInterim, onNoSpeech }) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)

  // ── Session tracking ────────────────────────────────────────────────────
  // Epoch increments on every new startListening() call. Stale onstop handlers
  // from previous sessions check their captured epoch against the current one
  // and bail out early if they no longer own the session.
  const epochRef = useRef(0)

  // ── Recording refs ──────────────────────────────────────────────────────
  const isListeningRef   = useRef(false)
  const suppressRef      = useRef(false) // true = intentional stop; skip transcription & onNoSpeech
  const streamRef        = useRef(null)
  const recorderRef      = useRef(null)
  const chunksRef        = useRef([])

  // ── Web Audio refs for VAD ─────────────────────────────────────────────
  const audioCtxRef      = useRef(null)
  const analyserRef      = useRef(null)

  // ── Timer refs ──────────────────────────────────────────────────────────
  const vadIntervalRef   = useRef(null)
  const maxTimeoutRef    = useRef(null)
  const noSpeechTimerRef = useRef(null)

  // ── VAD state refs ──────────────────────────────────────────────────────
  const recordStartRef   = useRef(0)
  const silenceStartRef  = useRef(null) // timestamp when silence began (null = not silent)
  const voiceDetectedRef = useRef(false)

  // ── Always-current callback refs ─────────────────────────────────────────
  const onResultRef   = useRef(onResult)
  const onInterimRef  = useRef(onInterim)
  const onNoSpeechRef = useRef(onNoSpeech)
  useEffect(() => {
    onResultRef.current   = onResult
    onInterimRef.current  = onInterim
    onNoSpeechRef.current = onNoSpeech
  })

  useEffect(() => {
    setIsSupported(!!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder))
    return () => teardown()
  }, [])

  // ── Hard teardown — releases all resources ────────────────────────────────
  function teardown() {
    clearInterval(vadIntervalRef.current);   vadIntervalRef.current   = null
    clearTimeout(maxTimeoutRef.current);     maxTimeoutRef.current    = null
    clearTimeout(noSpeechTimerRef.current);  noSpeechTimerRef.current = null

    try { if (recorderRef.current?.state !== 'inactive') recorderRef.current.stop() } catch {}
    recorderRef.current = null

    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    try { if (audioCtxRef.current?.state !== 'closed') audioCtxRef.current.close() } catch {}
    audioCtxRef.current = null
    analyserRef.current = null

    chunksRef.current = []
  }

  // ── Stop recording (internal) — does NOT set suppress ────────────────────
  // Called by VAD timeout and safety timers. onstop will handle transcription.
  function stopRecording() {
    if (!isListeningRef.current) return
    isListeningRef.current = false
    setIsListening(false)

    clearInterval(vadIntervalRef.current);   vadIntervalRef.current   = null
    clearTimeout(maxTimeoutRef.current);     maxTimeoutRef.current    = null
    clearTimeout(noSpeechTimerRef.current);  noSpeechTimerRef.current = null

    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null

    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() } catch {}
  }

  // ── Whisper transcription ─────────────────────────────────────────────────
  async function transcribeBlob(blob, mimeType) {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY
    if (!apiKey) throw new Error('VITE_GROQ_API_KEY not set')

    const form = new FormData()
    form.append('file', blob, `audio.${mimeExt(mimeType)}`)
    form.append('model', WHISPER_MODEL)
    form.append('language', 'en')
    form.append('response_format', 'json')

    const res = await fetch(GROQ_URL, {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body:    form,
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error?.message || `Whisper ${res.status}`)
    }

    return (await res.json()).text?.trim() || ''
  }

  // ── VAD loop ──────────────────────────────────────────────────────────────
  function startVAD() {
    const analyser = analyserRef.current
    if (!analyser) return

    const freqData = new Uint8Array(analyser.frequencyBinCount)

    vadIntervalRef.current = setInterval(() => {
      if (!isListeningRef.current || !analyserRef.current) return

      analyser.getByteFrequencyData(freqData)
      const avg = freqData.reduce((s, v) => s + v, 0) / freqData.length

      // Live volume indicator — passes volume bars to interim display
      const bars = Math.min(Math.round(avg / 10), 6)
      onInterimRef.current?.('●'.repeat(Math.max(bars, 1)))

      if (avg >= VOICE_THRESHOLD) {
        // ── Active speech ────────────────────────────────────────────────
        voiceDetectedRef.current = true
        silenceStartRef.current  = null  // reset silence clock
      } else if (voiceDetectedRef.current) {
        // ── Had speech, now checking if done ─────────────────────────────
        if (avg < SILENCE_THRESHOLD) {
          if (silenceStartRef.current === null) silenceStartRef.current = Date.now()
          const silentFor   = Date.now() - silenceStartRef.current
          const recordedFor = Date.now() - recordStartRef.current
          if (silentFor >= SILENCE_MS && recordedFor >= MIN_RECORD_MS) {
            stopRecording()
          }
        } else {
          // In the ambiguous band (18–35): don't reset silence timer, don't extend it
          // This means sustained quiet background still counts toward silence
        }
      }
      // If !voiceDetectedRef: still waiting for first word; noSpeechTimer handles timeout
    }, VAD_POLL_MS)
  }

  // ── Public API ───────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (isListeningRef.current) return

    teardown()

    const myEpoch = ++epochRef.current

    suppressRef.current      = false
    voiceDetectedRef.current = false
    silenceStartRef.current  = null
    chunksRef.current        = []
    recordStartRef.current   = Date.now()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      if (epochRef.current !== myEpoch) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream

      // Web Audio context + analyser for VAD
      const ctx      = new (window.AudioContext || window.webkitAudioContext)()
      const source   = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize               = 256
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser

      // MediaRecorder
      const mime     = bestMime()
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {})
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        // Close Web Audio — no longer needed once recording stops
        try { audioCtxRef.current?.close() } catch {}
        audioCtxRef.current = null
        analyserRef.current = null

        // Guard: stale session or intentional stop
        if (epochRef.current !== myEpoch) return
        if (suppressRef.current)          return

        const chunks = chunksRef.current.splice(0)
        const mType  = recorder.mimeType || 'audio/webm'

        if (!voiceDetectedRef.current || chunks.length === 0) {
          onNoSpeechRef.current?.()
          return
        }

        const blob = new Blob(chunks, { type: mType })
        if (blob.size < 500) { onNoSpeechRef.current?.(); return }

        try {
          const text = await transcribeBlob(blob, mType)
          if (epochRef.current !== myEpoch) return  // session replaced while transcribing
          if (text) onResultRef.current?.(text)
          else      onNoSpeechRef.current?.()
        } catch (err) {
          console.error('[Whisper]', err.message)
          if (epochRef.current === myEpoch) onNoSpeechRef.current?.()
        }
      }

      recorder.start(100)  // emit chunks every 100ms
      isListeningRef.current = true
      setIsListening(true)

      startVAD()

      // No speech heard at all within MAX_WAIT_MS → stop and bail
      noSpeechTimerRef.current = setTimeout(() => {
        if (!voiceDetectedRef.current && isListeningRef.current) stopRecording()
      }, MAX_WAIT_MS)

      // Absolute safety cap
      maxTimeoutRef.current = setTimeout(() => {
        if (isListeningRef.current) stopRecording()
      }, MAX_RECORD_MS)

    } catch (err) {
      console.error('[Whisper] getUserMedia:', err.message)
      if (epochRef.current === myEpoch) {
        isListeningRef.current = false
        setIsListening(false)
        onNoSpeechRef.current?.()
      }
    }
  }, [])

  const stopListening = useCallback(() => {
    if (!isListeningRef.current) return
    suppressRef.current = true  // onstop: skip transcription AND skip onNoSpeech
    stopRecording()
  }, [])

  return { isListening, isSupported, startListening, stopListening }
}
