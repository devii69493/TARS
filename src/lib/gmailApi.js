import { getAccessToken } from './googleAuth'

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

async function gFetch(path, options = {}) {
  const token = await getAccessToken()
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Gmail API error ${res.status}`)
  }
  return res.status === 204 ? {} : res.json()
}

function header(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

function decodeB64(str) {
  try { return atob(str.replace(/-/g, '+').replace(/_/g, '/')) } catch { return str }
}

function extractBody(payload) {
  if (payload?.body?.data) return decodeB64(payload.body.data)
  if (payload?.parts) {
    const plain = payload.parts.find(p => p.mimeType === 'text/plain')
    if (plain?.body?.data) return decodeB64(plain.body.data)
    const html  = payload.parts.find(p => p.mimeType === 'text/html')
    if (html?.body?.data) return decodeB64(html.body.data).replace(/<[^>]+>/g, '').trim()
  }
  return ''
}

function summarise(msg) {
  return {
    id:      msg.id,
    from:    header(msg.payload?.headers, 'From'),
    subject: header(msg.payload?.headers, 'Subject'),
    date:    header(msg.payload?.headers, 'Date'),
    snippet: msg.snippet,
  }
}

export async function listUnread(maxResults = 5) {
  const data = await gFetch(`/messages?q=is:unread&maxResults=${maxResults}`)
  if (!data.messages?.length) return []
  const msgs = await Promise.all(data.messages.map(m =>
    gFetch(`/messages/${m.id}?format=metadata&metadataHeaders=From,Subject,Date`)
  ))
  return msgs.map(summarise)
}

export async function searchEmails(query, maxResults = 5) {
  const data = await gFetch(`/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`)
  if (!data.messages?.length) return []
  const msgs = await Promise.all(data.messages.map(m =>
    gFetch(`/messages/${m.id}?format=metadata&metadataHeaders=From,Subject,Date`)
  ))
  return msgs.map(summarise)
}

export async function getEmail(messageId) {
  const msg = await gFetch(`/messages/${messageId}?format=full`)
  return {
    id:      msg.id,
    from:    header(msg.payload?.headers, 'From'),
    to:      header(msg.payload?.headers, 'To'),
    subject: header(msg.payload?.headers, 'Subject'),
    date:    header(msg.payload?.headers, 'Date'),
    body:    extractBody(msg.payload).slice(0, 4000),
  }
}

function buildRaw(to, subject, body, inReplyTo) {
  const lines = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8']
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`)
  lines.push('', body)
  const raw = lines.join('\r\n')
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sendEmail(to, subject, body, replyToId) {
  const raw = buildRaw(to, subject, body, replyToId)
  let threadId
  if (replyToId) {
    const msg = await gFetch(`/messages/${replyToId}?format=minimal`)
    threadId = msg.threadId
  }
  return gFetch('/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
  })
}

export async function createDraft(to, subject, body) {
  const raw = buildRaw(to, subject, body)
  return gFetch('/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw } }),
  })
}
