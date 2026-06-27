import { useCallback, useState, useEffect } from 'react'

export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [voices, setVoices] = useState([])

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [])

  const pickVoice = useCallback((list) => {
    if (!list?.length) return null
    const preferred = [
      'Google UK English Male',
      'Daniel',           // macOS UK — deep
      'Tom',              // macOS US — deeper than Alex
      'Microsoft George', // Windows UK — deep
      'Fred',             // macOS — flat/robotic
      'Microsoft David',  // Windows standard
      'Alex',             // macOS standard
    ]
    for (const name of preferred) {
      const v = list.find(v => v.name.includes(name))
      if (v) return v
    }
    return list.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('female')) || list[0]
  }, [])

  // MUST be called synchronously inside a click/tap handler.
  // Speaks a near-silent utterance so Chrome marks the synthesis engine as
  // "activated by user gesture" — without this, every async speak() call
  // is silently dropped. Also forces a voice-list refresh because Chrome
  // mobile withholds getVoices() results until after the first gesture.
  const unlock = useCallback(() => {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.resume()
    const primer = new SpeechSynthesisUtterance('.')
    primer.volume = 0.01  // non-zero: volume=0 can be skipped by Chrome
    primer.rate   = 10
    window.speechSynthesis.speak(primer)
    setTimeout(() => {
      const v = window.speechSynthesis.getVoices()
      if (v.length > 0) setVoices(v)
    }, 150)
  }, [])

  const speak = useCallback((text, onEnd) => {
    if (!window.speechSynthesis) return

    // Clear the queue first, then give Chrome a tick to settle before
    // queuing the real utterance — skipping this causes silent failures
    // on mobile Chrome after cancel().
    window.speechSynthesis.cancel()

    const liveVoices = window.speechSynthesis.getVoices()
    const list  = liveVoices.length > 0 ? liveVoices : voices
    const voice = pickVoice(list)

    const u = new SpeechSynthesisUtterance(text)
    if (voice) u.voice = voice
    u.rate   = 1.12
    u.pitch  = 0.65
    u.volume = 1.0

    // Chromium bug: long utterances stall silently; resume() unsticks them.
    // Also catches the "paused for tab switch" case on mobile.
    const keepAlive = setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        clearInterval(keepAlive)
      } else if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume()
      }
    }, 5000)

    u.onend   = () => { clearInterval(keepAlive); setIsSpeaking(false); onEnd?.() }
    // 'canceled' fires when stop() is called mid-speech — don't treat it as
    // a natural end or the mic will re-open without the user asking.
    u.onerror = (e) => {
      clearInterval(keepAlive)
      setIsSpeaking(false)
      if (e.error !== 'canceled') onEnd?.()
    }

    // Resume to clear any paused state, then speak after a short gap.
    setTimeout(() => {
      window.speechSynthesis.resume()
      window.speechSynthesis.speak(u)
      setIsSpeaking(true)
    }, 50)
  }, [pickVoice, voices])

  const stop = useCallback(() => {
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)
  }, [])

  return { isSpeaking, speak, stop, unlock }
}
