import { useCallback, useRef, useState, useEffect } from 'react'

export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [voices, setVoices] = useState([])

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  const pickVoice = useCallback(() => {
    // Ordered by perceived depth / robotic quality.
    // Google UK English Male is the deepest widely available Chrome voice.
    const preferred = [
      'Google UK English Male',
      'Daniel',             // macOS UK — deep
      'Tom',                // macOS US — deeper than Alex
      'Microsoft George',   // Windows UK — deep
      'Fred',               // macOS — flat/robotic
      'Microsoft David',    // Windows standard
      'Alex',               // macOS standard
    ]
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name))
      if (v) return v
    }
    return voices.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('female')) || voices[0]
  }, [voices])

  const speak = useCallback((text, onEnd) => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()

    const u = new SpeechSynthesisUtterance(text)
    const voice = pickVoice()
    if (voice) u.voice = voice
    u.rate = 0.85
    u.pitch = 0.65
    u.volume = 1.0

    u.onstart = () => setIsSpeaking(true)
    u.onend = () => {
      setIsSpeaking(false)
      onEnd?.()
    }
    u.onerror = () => {
      setIsSpeaking(false)
      onEnd?.()
    }

    // Chromium bug workaround: synthesis stops after ~15s
    const resume = setInterval(() => {
      if (!window.speechSynthesis.speaking) clearInterval(resume)
      else window.speechSynthesis.resume()
    }, 10000)
    u.onend = () => { clearInterval(resume); setIsSpeaking(false); onEnd?.() }
    u.onerror = () => { clearInterval(resume); setIsSpeaking(false); onEnd?.() }

    window.speechSynthesis.speak(u)
    setIsSpeaking(true)
  }, [pickVoice])

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)
  }, [])

  return { isSpeaking, speak, stop }
}
