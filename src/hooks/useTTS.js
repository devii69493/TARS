import { useCallback, useEffect, useRef, useState } from 'react'

// ── Toggle ElevenLabs here ─────────────────────────────────────────────────
// Set to false to always use Web Speech Synthesis (browser built-in)
const ELEVENLABS_ENABLED = true

const EL_API_KEY  = import.meta.env.VITE_ELEVENLABS_API_KEY
const EL_VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID
const EL_MODEL    = 'eleven_monolingual_v1'

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
// voiceMode: 'elevenlabs' | 'local' | 'browser'
// callAgent:  the call() function from useDesktopAgent (needed for 'local' mode)
export function useTTS({ voiceMode = 'elevenlabs', callAgent = null } = {}) {
  const [isSpeaking,   setIsSpeaking]   = useState(false)
  const [isElevenLabs, setIsElevenLabs] = useState(false)
  const [voices,       setVoices]       = useState([])

  const audioRef    = useRef(null)   // current HTMLAudioElement
  const abortRef    = useRef(null)   // current fetch AbortController

  // Web Speech voice list
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? [])
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])

  // ── unlock() — must be called synchronously inside a user gesture ─────────
  const unlock = useCallback(() => {
    if (!window.speechSynthesis) return
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
  }, [])

  // ── Web Speech Synthesis (fallback) ───────────────────────────────────────
  // Preserves original rate/pitch/volume settings
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

    // Chromium bug: onend silently stops firing after a few utterances.
    // Poll every 500ms; if speech ended without onend, fire the callback ourselves.
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearInterval(keepAlive)
      setIsSpeaking(false)
      onEnd?.()
    }

    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
      } else if (!window.speechSynthesis.speaking) {
        finish()
      }
    }, 500)

    u.onend  = finish
    u.onerror = (e) => {
      if (e.error === 'canceled') { done = true; clearInterval(keepAlive); setIsSpeaking(false); return }
      finish()
    }

    setTimeout(() => {
      window.speechSynthesis.resume()
      window.speechSynthesis.speak(u)
      setIsSpeaking(true)
    }, 50)
  }, [voices])

  // ── ElevenLabs via blob URL + HTMLAudioElement ─────────────────────────────
  const speakElevenLabs = useCallback(async (text, onEnd) => {
    // Stop whatever is currently playing
    abortRef.current?.abort()
    abortRef.current = null
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onplay   = null
      audioRef.current.onended  = null
      audioRef.current.onerror  = null
      audioRef.current = null
    }

    const clean      = stripMarkdown(text)
    const controller = new AbortController()
    abortRef.current = controller
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
            text,
            model_id: EL_MODEL,
            voice_settings: { stability: 0.4, similarity_boost: 0.8 },
          }),
        }
      )

      if (!res.ok) {
        const msg = await res.text().catch(() => String(res.status))
        throw new Error(`ElevenLabs ${res.status}: ${msg}`)
      }

      const blob  = await res.blob()
      const url   = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      // onplay / onended hook the waveform animation state
      audio.onplay = () => setIsSpeaking(true)

      audio.onended = () => {
        URL.revokeObjectURL(url)
        audioRef.current = null
        setIsSpeaking(false)
        setIsElevenLabs(false)
        onEnd?.()
      }

      audio.onerror = () => {
        URL.revokeObjectURL(url)
        audioRef.current = null
        setIsElevenLabs(false)
        console.warn('[TARS] ElevenLabs audio playback failed, falling back to Web Speech')
        speakWebSpeech(text, onEnd)
      }

      await audio.play()
    } catch (err) {
      if (err.name === 'AbortError') {
        // Intentional stop — don't fire onEnd or fall back
        setIsSpeaking(false)
        setIsElevenLabs(false)
        return
      }
      console.warn('[TARS] ElevenLabs failed, falling back to Web Speech:', err)
      setIsElevenLabs(false)
      speakWebSpeech(text, onEnd)
    }
  }, [speakWebSpeech])

  // ── Local TTS (macOS 'say' via agent) ────────────────────────────────────
  const speakLocal = useCallback(async (text, onEnd) => {
    if (!callAgent) { speakWebSpeech(text, onEnd); return }
    // Stop anything playing
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    try {
      const clean  = stripMarkdown(text)
      const result = await callAgent('tts_synthesize', { text: clean })
      const audio  = new Audio(`data:audio/wav;base64,${result.audio}`)
      audioRef.current = audio
      audio.onplay  = () => setIsSpeaking(true)
      audio.onended = () => { audioRef.current = null; setIsSpeaking(false); onEnd?.() }
      audio.onerror = () => { audioRef.current = null; setIsSpeaking(false); speakWebSpeech(text, onEnd) }
      await audio.play()
    } catch {
      speakWebSpeech(text, onEnd)
    }
  }, [callAgent, speakWebSpeech])

  // ── Unified speak ──────────────────────────────────────────────────────────
  const speak = useCallback((text, onEnd) => {
    if (voiceMode === 'local')    { speakLocal(text, onEnd); return }
    if (voiceMode === 'browser')  { speakWebSpeech(text, onEnd); return }
    // 'elevenlabs' (default) — falls back to browser if keys missing
    const useEL = ELEVENLABS_ENABLED && EL_API_KEY && EL_VOICE_ID
    if (useEL) speakElevenLabs(text, onEnd)
    else       speakWebSpeech(text, onEnd)
  }, [voiceMode, speakLocal, speakElevenLabs, speakWebSpeech])

  // ── stop() ─────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onplay   = null
      audioRef.current.onended  = null
      audioRef.current.onerror  = null
      audioRef.current = null
    }
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)
    setIsElevenLabs(false)
  }, [])

  const isLocal = voiceMode === 'local'
  return { speak, stop, unlock, isSpeaking, isElevenLabs, isLocal }
}
