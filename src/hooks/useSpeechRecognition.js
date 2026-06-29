import { useCallback, useEffect, useRef, useState } from 'react'

// Native Web Speech API — no server round-trip, no API key, real-time interim.
// Works in Chrome/Edge/Safari. Falls back to disabled state on Firefox.
export function useSpeechRecognition({ onResult, onInterim, onNoSpeech }) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)

  const srRef       = useRef(null)
  const suppressRef = useRef(false)  // true = manual stop, don't fire onNoSpeech
  const gotFinalRef = useRef(false)  // true = final result already delivered

  // Always-current callback refs so closures never go stale
  const onResultRef   = useRef(onResult)
  const onInterimRef  = useRef(onInterim)
  const onNoSpeechRef = useRef(onNoSpeech)
  useEffect(() => {
    onResultRef.current   = onResult
    onInterimRef.current  = onInterim
    onNoSpeechRef.current = onNoSpeech
  })

  useEffect(() => {
    setIsSupported(!!(window.SpeechRecognition || window.webkitSpeechRecognition))
    return () => {
      suppressRef.current = true
      try { srRef.current?.abort() } catch {}
    }
  }, [])

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

    // Tear down any previous instance
    try { srRef.current?.abort() } catch {}
    srRef.current = null

    suppressRef.current = false
    gotFinalRef.current = false

    const r = new SR()
    r.continuous      = false  // auto-stops after silence — exactly what we want
    r.interimResults  = true   // stream partials for live HUD display
    r.lang            = 'en-US'
    r.maxAlternatives = 1
    srRef.current     = r

    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          gotFinalRef.current = true
          onResultRef.current?.(text.trim())
        } else {
          onInterimRef.current?.(text)
        }
      }
    }

    r.onerror = (e) => {
      if (e.error === 'aborted' || suppressRef.current) return
      console.warn('[SR] error:', e.error)
      setIsListening(false)
      srRef.current = null
      if (!gotFinalRef.current) onNoSpeechRef.current?.()
    }

    r.onend = () => {
      setIsListening(false)
      srRef.current = null
      if (!gotFinalRef.current && !suppressRef.current) {
        onNoSpeechRef.current?.()
      }
    }

    try {
      r.start()
      setIsListening(true)
    } catch (err) {
      console.warn('[SR] start failed:', err)
      srRef.current = null
    }
  }, [])

  const stopListening = useCallback(() => {
    suppressRef.current = true
    if (srRef.current) {
      try { srRef.current.stop() } catch {}
      srRef.current = null
    }
    setIsListening(false)
  }, [])

  return { isListening, isSupported, startListening, stopListening }
}
