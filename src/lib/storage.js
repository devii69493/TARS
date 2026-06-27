// Thin localStorage wrappers — all writes are try/caught so storage quota
// errors never crash the app.

const K = {
  messages: 'tars_messages',
  honesty:  'tars_honesty',
  apiKey:   'tars_api_key',
  gToken:   'tars_g_token',
  gExpiry:  'tars_g_expiry',
}

// ── Messages ───────────────────────────────────────────────────────────────
// Only persist completed (non-streaming) messages, capped at 120 to stay
// well under the 5 MB localStorage limit.
export function saveMessages(msgs) {
  try {
    const done = msgs.filter(m => !m.streaming).slice(-120)
    localStorage.setItem(K.messages, JSON.stringify(done))
  } catch {}
}

export function loadMessages() {
  try {
    const raw = localStorage.getItem(K.messages)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function clearMessages() {
  try { localStorage.removeItem(K.messages) } catch {}
}

// ── Honesty slider ─────────────────────────────────────────────────────────
export function saveHonesty(val) {
  try { localStorage.setItem(K.honesty, String(val)) } catch {}
}

export function loadHonesty(def = 90) {
  try {
    const raw = localStorage.getItem(K.honesty)
    if (raw === null) return def
    const n = parseInt(raw, 10)
    return isNaN(n) ? def : Math.max(10, Math.min(100, n))
  } catch { return def }
}

// ── API key ────────────────────────────────────────────────────────────────
export function saveApiKey(key) {
  try {
    if (key) localStorage.setItem(K.apiKey, key)
    else      localStorage.removeItem(K.apiKey)
  } catch {}
}

export function loadApiKey() {
  try { return localStorage.getItem(K.apiKey) || '' } catch { return '' }
}

// ── Google OAuth token ─────────────────────────────────────────────────────
export function saveGoogleToken(token, expiry) {
  try {
    localStorage.setItem(K.gToken,  token)
    localStorage.setItem(K.gExpiry, String(expiry))
  } catch {}
}

export function loadGoogleToken() {
  try {
    const token  = localStorage.getItem(K.gToken)
    const expiry = Number(localStorage.getItem(K.gExpiry) || 0)
    if (token && expiry > Date.now()) return { token, expiry }
  } catch {}
  return null
}

export function clearGoogleToken() {
  try {
    localStorage.removeItem(K.gToken)
    localStorage.removeItem(K.gExpiry)
  } catch {}
}
