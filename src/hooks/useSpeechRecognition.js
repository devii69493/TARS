import { useEffect, useRef, useState, useCallback } from 'react'

export function useSpeechRecognition({ onResult, onInterim, onNoSpeech }) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(false)

  const recognitionRef = useRef(null)
  const isListeningRef = useRef(false)

  // Always-current callback refs — read inside event handlers so they never
  // go stale even though the recognition instance persists across renders.
  const onResultRef   = useRef(onResult)
  const onInterimRef  = useRef(onInterim)
  const onNoSpeechRef = useRef(onNoSpeech)
  useEffect(() => {
    onResultRef.current   = onResult
    onInterimRef.current  = onInterim
    onNoSpeechRef.current = onNoSpeech
  })

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (SR) setIsSupported(true)
  }, [])

  const setListening = (val) => {
    isListeningRef.current = val
    setIsListening(val)
  }

  // Creates a fresh SpeechRecognition instance every call.
  // Reusing a stopped instance causes Chrome to silently fail after a few
  // start/stop cycles — the browser's internal state machine gets stuck.
  const startListening = useCallback(() => {
    if (isListeningRef.current) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return

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
      if (interim) onInterimRef.current?.(interim)
      if (final)   onResultRef.current?.(final.trim())
    }

    r.onend = () => setListening(false)

    r.onerror = (e) => {
      // 'aborted' means we called .stop() ourselves — ignore it.
      if (e.error === 'aborted') return
      if (e.error !== 'no-speech') console.error('Speech recognition error:', e.error)
      setListening(false)
      onNoSpeechRef.current?.()
    }

    recognitionRef.current = r

    try {
      r.start()
      setListening(true)
    } catch (err) {
      console.error('Recognition start failed:', err)
      recognitionRef.current = null
    }
  }, [])

  const stopListening = useCallback(() => {
    if (!recognitionRef.current || !isListeningRef.current) return
    try { recognitionRef.current.stop() } catch (_) {}
    setListening(false)
  }, [])

  return { isListening, isSupported, startListening, stopListening }
}
