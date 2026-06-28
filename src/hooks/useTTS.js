import { useCallback, useEffect, useRef, useState } from 'react'

// ── Toggle ElevenLabs here ─────────────────────────────────────────────────
// Set to false to always use Web Speech Synthesis (browser built-in)
const ELEVENLABS_ENABLED = true

const EL_API_KEY  = import.meta.env.VITE_ELEVENLABS_API_KEY
const EL_VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID
const EL_MODEL    = 'eleven_turbo_v2_5'

// ── Strip markdown before sending to ElevenLabs ────────────────────────────
function stripMarkdown(text) {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`{1,3}[\s\S]*?`{1,3}/g, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Web Speech voice picker ────────────────────────────────────────────────
function pickVoice(list) {
  if (!list?.length) return null
  const preferred = [
    'Google UK English Male',
    'Daniel',
    'Tom',
    'Microsoft George',
    'Fred',
    'Microsoft David',
    'Alex',
  ]
  for (const name of preferred) {
    const v = list.find(v => v.name.includes(name))
    if (v) return v
  }
  return list.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('female')) || list[0]
}

// ── Unified TTS hook ───────────────────────────────────────────────────────
// Tries ElevenLabs first (if ELEVENLABS_ENABLED + keys present).
// Automatically falls back to Web Speech Synthesis on any failure.
export function useTTS() {
  const [isSpeaking,   setIsSpeaking]   = useState(false)
  const [isElevenLabs, setIsElevenLabs] = useState(false)
  const [voices,       setVoices]       = useState([])

  // AudioContext is created once inside unlock() (a user gesture), so
  // subsequent async audio plays don't hit the browser autoplay block.
  const audioCtxRef = useRef(null)
  const sourceRef   = useRef(null)  // current BufferSourceNode
  const abortRef    = useRef(null)  // current fetch AbortController

  // Web Speech voice list
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? [])
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])

  // ── unlock() — must be called synchronously inside a user gesture ─────────
  // Creates the AudioContext and primes Web Speech, both of which need a
  // direct user activation to satisfy browser autoplay policies.
  const unlock = useCallback(() => {
    // Web Speech primer
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel()
      window.speechSynthesis.resume()
      const primer = new SpeechSynthesisUtterance('.')
      primer.volume = 0.01
      primer.rate   = 10
      window.speechSynthesis.speak(primer)
      setTimeout(() => {
        const v = window.speechSynthesis.getVoices()
        if (v.length) setVoices(v)
      }, 150)
    }
    // AudioContext unlock — creating + resuming here binds it to the gesture
    // so later async .start() calls won't be blocked
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
  }, [])

  // ── Web Speech Synthesis ───────────────────────────────────────────────────
  const speakWebSpeech = useCallback((text, onEnd) => {
    if (!window.speechSynthesis) { onEnd?.(); return }
    window.speechSynthesis.cancel()

    const liveVoices = window.speechSynthesis.getVoices()
    const list  = liveVoices.length ? liveVoices : voices
    const voice = pickVoice(list)

    const u = new SpeechSynthesisUtterance(text)
    if (voice) u.voice = voice
    u.rate   = 1.12
    u.pitch  = 0.65
    u.volume = 1.0

    // Chromium bug: long utterances stall silently — resume() unsticks them
    const keepAlive = setInterval(() => {
      if (!window.speechSynthesis.speaking) clearInterval(keepAlive)
      else if (window.speechSynthesis.paused) window.speechSynthesis.resume()
    }, 5000)

    u.onend = () => {
      clearInterval(keepAlive)
      setIsSpeaking(false)
      onEnd?.()
    }
    u.onerror = (e) => {
      clearInterval(keepAlive)
      setIsSpeaking(false)
      if (e.error !== 'canceled') onEnd?.()
    }

    setTimeout(() => {
      window.speechSynthesis.resume()
      window.speechSynthesis.speak(u)
      setIsSpeaking(true)
    }, 50)
  }, [voices])

  // ── ElevenLabs via AudioContext ────────────────────────────────────────────
  const speakElevenLabs = useCallback(async (text, onEnd) => {
    // Stop whatever is currently playing
    abortRef.current?.abort()
    abortRef.current = null
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch {}
      sourceRef.current = null
    }

    const ac = audioCtxRef.current
    if (!ac) {
      // unlock() wasn't called before speak() — fall back gracefully
      speakWebSpeech(text, onEnd)
      return
    }
    if (ac.state === 'suspended') await ac.resume()

    const clean      = stripMarkdown(text)
    const controller = new AbortController()
    abortRef.current = controller
    setIsSpeaking(true)
    setIsElevenLabs(true)

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE_ID}`,
        {
          method:  'POST',
          signal:  controller.signal,
          headers: {
            'xi-api-key':   EL_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: clean,
            model_id: EL_MODEL,
            voice_settings: {
              stability:         0.45,
              similarity_boost:  0.80,
              style:             0.0,
              use_speaker_boost: true,
            },
          }),
        }
      )

      if (!res.ok) {
        const msg = await res.text().catch(() => String(res.status))
        throw new Error(`ElevenLabs ${res.status}: ${msg}`)
      }

      const arrayBuffer = await res.arrayBuffer()
      const audioBuffer = await ac.decodeAudioData(arrayBuffer)

      const source  = ac.createBufferSource()
      source.buffer = audioBuffer
      source.connect(ac.destination)
      sourceRef.current = source

      source.onended = () => {
        sourceRef.current = null
        setIsSpeaking(false)
        setIsElevenLabs(false)
        onEnd?.()
      }
      source.start(0)
    } catch (err) {
      if (err.name === 'AbortError') {
        // Intentional stop — don't fire onEnd
        setIsSpeaking(false)
        setIsElevenLabs(false)
        return
      }
      console.warn('[TARS] ElevenLabs failed, falling back to Web Speech:', err)
      setIsElevenLabs(false)
      speakWebSpeech(text, onEnd)
    }
  }, [speakWebSpeech])

  // ── Unified speak ──────────────────────────────────────────────────────────
  const speak = useCallback((text, onEnd) => {
    const useEL = ELEVENLABS_ENABLED && EL_API_KEY && EL_VOICE_ID
    if (useEL) speakElevenLabs(text, onEnd)
    else       speakWebSpeech(text, onEnd)
  }, [speakElevenLabs, speakWebSpeech])

  // ── stop() ─────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch {}
      sourceRef.current = null
    }
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)
    setIsElevenLabs(false)
  }, [])

  return { speak, stop, unlock, isSpeaking, isElevenLabs }
}
