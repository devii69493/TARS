import { useRef, useCallback, useEffect } from 'react'

const PATTERNS_KEY   = 'tars_patterns'
const SESSION_KEY    = 'tars_pattern_suggested'
const MIN_DAYS       = 3    // unique days before a pattern fires
const HOUR_TOLERANCE = 1    // ±1 hour window

function getPatterns() {
  try { return JSON.parse(localStorage.getItem(PATTERNS_KEY) || '{}') } catch { return {} }
}
function savePatterns(p) {
  try { localStorage.setItem(PATTERNS_KEY, JSON.stringify(p)) } catch {}
}

// Human-readable suggestion text based on tool
function suggestionFor(data) {
  const { toolName, lastArgs } = data
  if (toolName === 'desktop_spotify') {
    const what = lastArgs?.query ? `${lastArgs.query} on Spotify` : 'Spotify'
    return `You usually listen to ${what} around now, Sir. Want me to start it?`
  }
  if (toolName === 'desktop_youtube') {
    const what = lastArgs?.query ? `"${lastArgs.query}" on YouTube` : 'YouTube'
    return `Your usual ${what} session — shall I fire it up?`
  }
  if (toolName === 'desktop_app_open') {
    return `You typically open ${lastArgs?.name || 'that app'} at this time. Want me to?`
  }
  return null  // don't suggest unfamiliar patterns
}

export function usePatternLearning({ onSuggestion, audioUnlocked }) {
  const suggestedRef = useRef(false)

  // Record each successful tool call
  const recordTool = useCallback((toolName, args) => {
    const trackable = ['desktop_spotify', 'desktop_youtube', 'desktop_app_open']
    if (!trackable.includes(toolName)) return

    const dateStr = new Date().toDateString()
    const hour    = new Date().getHours()
    const key     = `${toolName}:${hour}`
    const p       = getPatterns()

    if (!p[key]) p[key] = { toolName, hour, dates: [], lastArgs: {} }
    if (!p[key].dates.includes(dateStr)) p[key].dates.push(dateStr)
    if (p[key].dates.length > 60) p[key].dates = p[key].dates.slice(-60)
    p[key].lastArgs = args ?? {}
    savePatterns(p)
  }, [])

  // Check once per session after audio unlocks
  useEffect(() => {
    if (!audioUnlocked || suggestedRef.current) return

    const alreadySuggested = sessionStorage.getItem(SESSION_KEY)
    if (alreadySuggested) { suggestedRef.current = true; return }

    const hour = new Date().getHours()
    const today = new Date().toDateString()
    const p = getPatterns()

    for (const data of Object.values(p)) {
      // Only trigger within ±HOUR_TOLERANCE of the recorded hour, exclude today's records
      if (Math.abs(data.hour - hour) > HOUR_TOLERANCE) continue
      const pastDays = data.dates.filter(d => d !== today)
      if (pastDays.length < MIN_DAYS) continue

      const text = suggestionFor(data)
      if (!text) continue

      suggestedRef.current = true
      sessionStorage.setItem(SESSION_KEY, '1')
      // Short delay so TARS finishes wake greeting first
      setTimeout(() => onSuggestion?.(text, data), 3500)
      return
    }
  }, [audioUnlocked, onSuggestion])

  return { recordTool }
}
