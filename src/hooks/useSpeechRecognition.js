import { useEffect, useRef, useState, useCallback } from 'react'

export function useSpeechRecognition({ onResult, onInterim, onNoSpeech }) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)
  const recognitionRef  = useRef(null)
  const isListeningRef  = useRef(false)  // mirrors state but always current in callbacks

  // Keep ref in sync whenever state changes
  useEffect(() => { isListeningRef.current = isListening }, [isListening])

  const setListening = (val) => {
    isListeningRef.current = val
    setIsListening(val)
  }

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    setIsSupported(true)

    const r = new SR()
    r.continuous      = false
    r.interimResults  = true
    r.lang            = 'en-US'
    r.maxAlternatives = 1

    r.onresult = (e) => {
      let interim = ''
      let final   = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final   += t
        else                       interim += t
      }
      if (interim) onInterim?.(interim)
      if (final)   onResult?.(final.trim())
    }

    r.onend = () => setListening(false)

    r.onerror = (e) => {
      // 'aborted' means we called .stop() ourselves — not a real error, no retry needed
      if (e.error !== 'aborted') {
        if (e.error !== 'no-speech') console.error('Speech recognition error:', e.error)
        // Treat every non-abort error (no-speech, network, audio-capture, etc.)
        // the same way: let the caller decide whether to restart
        onNoSpeech?.()
      }
      setListening(false)
    }

    recognitionRef.current = r
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Stable identity — reads isListeningRef so no stale-closure issues
  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListeningRef.current) return
    try {
      recognitionRef.current.start()
      setListening(true)
    } catch (err) {
      console.error('Recognition start failed:', err)
    }
  }, []) // intentionally empty deps — relies on isListeningRef

  const stopListening = useCallback(() => {
    if (!recognitionRef.current || !isListeningRef.current) return
    recognitionRef.current.stop()
    setListening(false)
  }, []) // intentionally empty deps — relies on isListeningRef

  return { isListening, isSupported, startListening, stopListening }
}
