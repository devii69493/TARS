import { listUnread, searchEmails, getEmail, sendEmail, createDraft } from '../lib/gmailApi'
import { listEvents, createEvent, updateEvent, deleteEvent } from '../lib/calendarApi'
import { webSearch } from '../lib/searchApi'

// ── Date resolver ──────────────────────────────────────────────────────────
// Converts relative terms the model may pass ("yesterday", "this week", etc.)
// into ISO 8601 strings before they reach the Calendar API.
// `asEnd` = true returns the *exclusive* end of the period (start of next day/week).
function resolveDate(val, asEnd = false) {
  if (!val) return undefined

  const lower = String(val).toLowerCase().trim()
  const now   = new Date()
  const y = now.getFullYear(), mo = now.getMonth(), d = now.getDate()

  const day  = (offsetDays = 0) => new Date(y, mo, d + offsetDays)
  const iso  = (date) => date.toISOString()

  // For a whole-day period, start = day(0), end = day(1) (exclusive)
  const period = (startDay, lengthDays = 1) =>
    asEnd ? iso(day(startDay + lengthDays)) : iso(day(startDay))

  // Week helpers (weeks start Monday)
  const dow        = now.getDay()                      // 0=Sun … 6=Sat
  const toMonday   = dow === 0 ? -6 : 1 - dow         // offset to this Monday
  const thisMonday = toMonday

  switch (lower) {
    case 'today':       return period(0)
    case 'yesterday':   return period(-1)
    case 'tomorrow':    return period(1)

    case 'this week':
      return asEnd ? iso(day(thisMonday + 7)) : iso(day(thisMonday))
    case 'last week':
      return asEnd ? iso(day(thisMonday))     : iso(day(thisMonday - 7))
    case 'next week':
      return asEnd ? iso(day(thisMonday + 14)): iso(day(thisMonday + 7))

    case 'this month': {
      const start = new Date(y, mo, 1)
      const end   = new Date(y, mo + 1, 1)
      return asEnd ? iso(end) : iso(start)
    }
    case 'last month': {
      const start = new Date(y, mo - 1, 1)
      const end   = new Date(y, mo, 1)
      return asEnd ? iso(end) : iso(start)
    }
    case 'next month': {
      const start = new Date(y, mo + 1, 1)
      const end   = new Date(y, mo + 2, 1)
      return asEnd ? iso(end) : iso(start)
    }

    case 'now':
      return iso(now)

    case 'end of the year':
    case 'end of year':
    case 'year end': {
      const end = new Date(y, 11, 31, 23, 59, 59, 999)
      return iso(end)
    }
    case 'start of the year':
    case 'start of year':
    case 'beginning of the year':
    case 'beginning of year':
    case 'year start': {
      const start = new Date(y, 0, 1)
      return iso(start)
    }
    case 'end of the month':
    case 'end of month': {
      const end = new Date(y, mo + 1, 1)  // exclusive start of next month
      return iso(end)
    }
    case 'start of the month':
    case 'start of month':
    case 'beginning of the month':
    case 'beginning of month': {
      const start = new Date(y, mo, 1)
      return iso(start)
    }

    default: {
      const parsed = new Date(val)
      return isNaN(parsed.getTime()) ? undefined : iso(parsed)
    }
  }
}

// Resolve all date fields a calendar tool call might carry
function resolveCalendarDates(args) {
  return {
    ...args,
    ...(args.timeMin    !== undefined && { timeMin:    resolveDate(args.timeMin,    false) }),
    ...(args.timeMax    !== undefined && { timeMax:    resolveDate(args.timeMax,    true)  }),
    ...(args.startTime  !== undefined && { startTime:  resolveDate(args.startTime,  false) }),
    ...(args.endTime    !== undefined && { endTime:    resolveDate(args.endTime,    true)  }),
  }
}

// ── Browser-based timer (works without the desktop agent) ─────────────────
async function browserTimer(seconds, label = 'Timer') {
  if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    await Notification.requestPermission()
  }
  setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification('TARS', { body: `${label} complete`, silent: false })
    }
  }, seconds * 1000)
  const m = Math.floor(seconds / 60), s = seconds % 60
  return `Timer set: ${label} in ${m ? `${m}m ${s}s` : `${s}s`}`
}

// ── Desktop tool → agent tool mapping ─────────────────────────────────────
async function callDesktopTool(name, args, callAgent) {
  // Timer works in-browser even without the agent
  if (name === 'desktop_timer') {
    if (callAgent) {
      try { return await callAgent('set_timer', args) } catch {}
    }
    return browserTimer(parseInt(args.seconds), args.label || 'Timer')
  }

  if (!callAgent) throw new Error('Desktop agent offline. Run start-tars.sh for app/system control.')
  switch (name) {
    case 'desktop_app_open':   return callAgent('app_open',   args)
    case 'desktop_app_close':  return callAgent('app_close',  args)
    case 'desktop_app_switch': return callAgent('app_switch', args)
    case 'desktop_app_list':   return callAgent('app_list',   {})
    case 'desktop_screenshot': return callAgent('screenshot', {})
    case 'desktop_media': {
      const map = { play_pause: 'media_playpause', next: 'media_next', prev: 'media_prev', current: 'media_current' }
      return callAgent(map[args.action] ?? args.action, {})
    }
    case 'desktop_volume':
      if (args.mute  !== undefined) return callAgent('volume_mute', { muted: args.mute })
      if (args.level !== undefined) return callAgent('volume_set',  { level: args.level })
      return callAgent('volume_get', {})
    case 'desktop_file_open':   return callAgent('file_open',    args)
    case 'desktop_spotlight':   return callAgent('spotlight',    args)
    case 'desktop_dnd':         return callAgent('dnd',          args)
    case 'desktop_battery':     return callAgent('battery',      {})
    case 'desktop_lock':        return callAgent('lock_screen',  {})
    default: throw new Error(`Unknown desktop tool: ${name}`)
  }
}

// ── Tool executor ──────────────────────────────────────────────────────────
export function useToolExecutor({ callAgent } = {}) {
  async function executeTools(toolCalls) {
    return Promise.all(toolCalls.map(async (tc) => {
      const { name, arguments: argsStr } = tc.function
      let args = {}
      try { args = JSON.parse(argsStr) } catch {}

      try {
        let result

        switch (name) {
          // Gmail
          case 'gmail_list_unread':
            result = await listUnread(args.maxResults)
            break
          case 'gmail_search':
            result = await searchEmails(args.query, args.maxResults)
            break
          case 'gmail_get_email':
            result = await getEmail(args.messageId)
            break
          case 'gmail_send':
            result = await sendEmail(args.to, args.subject, args.body, args.replyToId)
            break
          case 'gmail_create_draft':
            result = await createDraft(args.to, args.subject, args.body)
            break

          // Calendar — always resolve dates before calling the API
          case 'calendar_list_events': {
            const a = resolveCalendarDates(args)
            result = await listEvents(a.timeMin, a.timeMax, a.maxResults)
            break
          }
          case 'calendar_create_event': {
            const a = resolveCalendarDates(args)
            result = await createEvent(a.title, a.startTime, a.endTime, a.description, a.location)
            break
          }
          case 'calendar_update_event': {
            const a = resolveCalendarDates(args)
            result = await updateEvent(a.eventId, a)
            break
          }
          case 'calendar_delete_event':
            result = await deleteEvent(args.eventId)
            break

          // Web Search
          case 'web_search':
            result = await webSearch(args.query)
            break

          // Desktop (routed through Python agent over WebSocket)
          default:
            if (name.startsWith('desktop_')) {
              result = await callDesktopTool(name, args, callAgent)
            } else {
              result = { error: `Unknown tool: ${name}` }
            }
        }

        return { id: tc.id, name, result }
      } catch (err) {
        return { id: tc.id, name, result: { error: err.message } }
      }
    }))
  }

  return { executeTools }
}
