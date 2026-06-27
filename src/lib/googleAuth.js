import { saveGoogleToken, loadGoogleToken, clearGoogleToken } from './storage'

// All four scopes in one flow — Gmail modify + send, Calendar full + events.
// Changing this string invalidates any stored token (see scope-guard below).
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ')

// ── Scope-version guard ────────────────────────────────────────────────────
// If the stored scope fingerprint differs from SCOPES, the saved token was
// issued for a different scope set and must be discarded so the next
// connectGoogle() triggers a fresh consent screen with all four scopes.
const SCOPE_KEY = 'tars_g_scopes'
try {
  if (localStorage.getItem(SCOPE_KEY) !== SCOPES) {
    clearGoogleToken()
    localStorage.setItem(SCOPE_KEY, SCOPES)
  }
} catch {}

let tokenClient = null
let accessToken  = null
let tokenExpiry  = 0

// Restore token at module load — runs before any React render so
// isGoogleConnected() already reflects the saved state when useState() runs.
const saved = loadGoogleToken()
if (saved) { accessToken = saved.token; tokenExpiry = saved.expiry }

async function loadGIS() {
  if (window.google?.accounts?.oauth2) return
  await new Promise((resolve, reject) => {
    const script   = document.createElement('script')
    script.src     = 'https://accounts.google.com/gsi/client'
    script.async   = true
    script.onload  = resolve
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(script)
  })
}

// Always creates a fresh client — never reuse a cached one so scope changes
// and consent prompts are never silently skipped by GIS.
async function createClient() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID not set.')
  await loadGIS()
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope:     SCOPES,
    callback:  () => {},
  })
}

async function ensureClient() {
  if (!tokenClient) await createClient()
}

export function isGoogleConnected() {
  return !!(accessToken && Date.now() < tokenExpiry)
}

// Explicit connect — prompt:'consent' forces the full consent screen every
// time so all four scopes are explicitly approved in one flow.
export async function connectGoogle() {
  await createClient()
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error_description || response.error))
        return
      }
      accessToken = response.access_token
      tokenExpiry = Date.now() + response.expires_in * 1000 - 60_000
      saveGoogleToken(accessToken, tokenExpiry)
      resolve(accessToken)
    }
    tokenClient.requestAccessToken({ prompt: 'consent' })
  })
}

// Silent refresh — used by API helpers when the in-memory token has expired
async function silentRefresh() {
  await ensureClient()
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) { reject(new Error(response.error)); return }
      accessToken = response.access_token
      tokenExpiry = Date.now() + response.expires_in * 1000 - 60_000
      saveGoogleToken(accessToken, tokenExpiry)
      resolve(accessToken)
    }
    tokenClient.requestAccessToken({ prompt: '' })
  })
}

export async function getAccessToken() {
  if (isGoogleConnected()) return accessToken
  return silentRefresh()
}

export function disconnectGoogle() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {})
  }
  accessToken = null
  tokenExpiry  = 0
  tokenClient  = null
  clearGoogleToken()
}
