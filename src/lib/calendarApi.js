import { getAccessToken } from './googleAuth'

const BASE = 'https://www.googleapis.com/calendar/v3'
const TZ   = () => Intl.DateTimeFormat().resolvedOptions().timeZone

async function cFetch(path, options = {}) {
  const token = await getAccessToken()
  const res   = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  })

  if (res.status === 204) return { deleted: true }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg  = body.error?.message || ''

    if (res.status === 401) {
      throw new Error('Google auth expired. Disconnect and reconnect Google in settings.')
    }
    if (res.status === 403) {
      if (msg.toLowerCase().includes('disabled') || msg.toLowerCase().includes('not been used') || msg.toLowerCase().includes('not enabled')) {
        throw new Error('Google Calendar API is not enabled. Go to console.cloud.google.com → APIs & Services → Library → enable "Google Calendar API".')
      }
      // Scope not granted — token exists (Gmail works) but Calendar was never approved
      throw new Error('Calendar access not authorised. In TARS settings, disconnect Google and reconnect — make sure to approve both Gmail and Calendar on the consent screen.')
    }

    throw new Error(msg || `Calendar API error ${res.status}`)
  }

  return res.json()
}

function flatEvent(ev) {
  return {
    id:          ev.id,
    title:       ev.summary,
    start:       ev.start?.dateTime || ev.start?.date,
    end:         ev.end?.dateTime   || ev.end?.date,
    location:    ev.location,
    description: ev.description,
    allDay:      !ev.start?.dateTime,
  }
}

export async function listEvents(timeMin, timeMax, maxResults = 10) {
  const now      = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayEnd   = new Date(dayStart.getTime() + 86_400_000)
  const params   = new URLSearchParams({
    timeMin:      timeMin  || dayStart.toISOString(),
    timeMax:      timeMax  || dayEnd.toISOString(),
    maxResults:   String(maxResults),
    singleEvents: 'true',
    orderBy:      'startTime',
  })
  const data = await cFetch(`/calendars/primary/events?${params}`)
  return (data.items || []).map(flatEvent)
}

export async function createEvent(title, startTime, endTime, description, location) {
  return cFetch('/calendars/primary/events', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      summary:     title,
      description,
      location,
      start: { dateTime: startTime, timeZone: TZ() },
      end:   { dateTime: endTime,   timeZone: TZ() },
    }),
  }).then(flatEvent)
}

export async function updateEvent(eventId, fields) {
  const existing = await cFetch(`/calendars/primary/events/${eventId}`)
  const patch    = { ...existing }
  if (fields.title)       patch.summary     = fields.title
  if (fields.description) patch.description = fields.description
  if (fields.location)    patch.location    = fields.location
  if (fields.startTime)   patch.start       = { dateTime: fields.startTime, timeZone: TZ() }
  if (fields.endTime)     patch.end         = { dateTime: fields.endTime,   timeZone: TZ() }
  return cFetch(`/calendars/primary/events/${eventId}`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(patch),
  }).then(flatEvent)
}

export async function deleteEvent(eventId) {
  return cFetch(`/calendars/primary/events/${eventId}`, { method: 'DELETE' })
}
