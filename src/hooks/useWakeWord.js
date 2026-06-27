import { useEffect, useRef } from 'react'

// Uses Web Speech API continuous recognition — intentionally NOT Whisper.
// Runs only in standby; stops completely when conversation is active.
// Whisper is reserved for high-accuracy conversation turns.

export const WAKE_WORDS = [
  'wake up', 'good morning', 'good evening', 'good afternoon', 'hey tars', 'tars',
]

export const SLEEP_WORDS = [
  'goodbye', 'good night', 'go to sleep', "that's all", 'thats all', 'dismiss',
]

export function matchWord(transcript, words) {
  const lower = transcript.toLowerCase()
  return words.some(w => lower.includes(w))
}

// ── React hook ────────────────────────────────────────────────────────────
// `enabled` drives the lifecycle: true = start listening, false = stop.
// Auto-restarts after silence/network errors (continuous mode fires onend).
export function useWakeWord({ onWake, onSleep, enabled }) {
  const srRef       = useRef(null)
  const enabledRef  = useRef(enabled)
  const onWakeRef   = useRef(onWake)
  const onSleepRef  = useRef(onSleep)
  const restartRef  = useRef(null)

  useEffect(() => { enabledRef.current = enabled  }, [enabled])
  useEffect(() => { onWakeRef.current  = onWake   }, [onWake])
  useEffect(() => { onSleepRef.current = onSleep  }, [onSleep])

  // ── Destroy current instance (doesn't affect enabledRef) ───────────────
  function destroy() {
    clearTimeout(restartRef.current)
    restartRef.current = null
    const r = srRef.current
    if (!r) return
    r.onresult = null
    r.onerror  = null
    r.onend    = null
    try { r.abort() } catch {}
    srRef.current = null
  }

  // ── Launch a new SR instance ────────────────────────────────────────────
  function launch() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR || !enabledRef.current || srRef.current) return

    const r = new SR()
    r.continuous      = true
    r.interimResults  = true   // interim → faster wake word detection
    r.lang            = 'en-US'
    r.maxAlternatives = 1
    srRef.current     = r

    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript
        if (matchWord(text, WAKE_WORDS)) { onWakeRef.current?.(text.trim()); return }
        if (matchWord(text, SLEEP_WORDS)) { onSleepRef.current?.(text.trim()); return }
      }
    }

    r.onerror = (e) => {
      if (e.error === 'aborted') return
      srRef.current = null
      // Recoverable error (network, no-mic) — back off then retry
      if (enabledRef.current) restartRef.current = setTimeout(launch, 1500)
    }

    r.onend = () => {
      // Continuous mode still fires onend after silence — restart immediately
      srRef.current = null
      if (enabledRef.current) restartRef.current = setTimeout(launch, 200)
    }

    try {
      r.start()
    } catch {
      srRef.current = null
      if (enabledRef.current) restartRef.current = setTimeout(launch, 1500)
    }
  }

  // ── Effect: start / stop when `enabled` changes ────────────────────────
  useEffect(() => {
    if (enabled) {
      launch()
    } else {
      destroy()
    }
    return destroy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const isAvailable = !!(
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  )

  return { isAvailable }
}
