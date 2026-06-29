import { useEffect, useRef, useCallback } from 'react'
import { listEvents } from '../lib/calendarApi'

const POLL_MS        = 5 * 60 * 1000   // 5 minutes
const STORAGE_OFFSET = 'tars_reminder_offset'

export function useProactiveReminders({ googleConnected, onReminder }) {
  const announcedRef  = useRef(new Set())   // eventIds announced this session
  const onReminderRef = useRef(onReminder)
  useEffect(() => { onReminderRef.current = onReminder }, [onReminder])

  useEffect(() => {
    if (!googleConnected) return

    const check = async () => {
      const offsetMins = parseInt(localStorage.getItem(STORAGE_OFFSET) || '10', 10)
      const now  = new Date()
      const soon = new Date(now.getTime() + offsetMins * 60 * 1000)

      let events = []
      try {
        events = await listEvents(now.toISOString(), soon.toISOString(), 10) || []
      } catch { return }

      for (const ev of events) {
        if (announcedRef.current.has(ev.id)) continue
        announcedRef.current.add(ev.id)
        const start    = new Date(ev.start?.dateTime || ev.start?.date)
        const minsAway = Math.max(1, Math.round((start - now) / 60000))
        onReminderRef.current?.(ev.summary || 'event', minsAway)
      }
    }

    check()
    const id = setInterval(check, POLL_MS)
    return () => clearInterval(id)
  }, [googleConnected])

  const setOffset = useCallback((mins) => {
    localStorage.setItem(STORAGE_OFFSET, String(Math.max(1, parseInt(mins, 10))))
  }, [])

  return { setOffset }
}
