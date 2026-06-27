import { useCallback, useRef, useState } from 'react'

const API_KEY  = import.meta.env.VITE_ELEVENLABS_API_KEY
const VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID
const MODEL    = 'eleven_turbo_v2_5'   // fastest model with good quality

export function useElevenLabsTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const audioRef   = useRef(null)  // current HTMLAudioElement
  const abortRef   = useRef(null)  // current AbortController

  const speak = useCallback(async (text, onEnd) => {
    // Stop anything currently playing
    abortRef.current?.abort()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }

    setIsSpeaking(true)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'xi-api-key':   API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: MODEL,
            voice_settings: {
              stability:        0.45,
              similarity_boost: 0.80,
              style:            0.0,
              use_speaker_boost: true,
            },
          }),
        }
      )

      if (!res.ok) {
        const msg = await res.text().catch(() => res.status)
        throw new Error(`ElevenLabs ${res.status}: ${msg}`)
      }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio

      const cleanup = () => {
        URL.revokeObjectURL(url)
        audioRef.current = null
        setIsSpeaking(false)
        onEnd?.()
      }

      audio.onended = cleanup
      audio.onerror = (e) => {
        console.error('Audio playback error:', e)
        cleanup()
      }

      await audio.play()
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('ElevenLabs TTS error:', err)
      }
      setIsSpeaking(false)
      onEnd?.()
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setIsSpeaking(false)
  }, [])

  return { isSpeaking, speak, stop }
}
