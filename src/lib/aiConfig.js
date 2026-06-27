// ── AI Provider Configuration ──────────────────────────────────────────────
// To switch providers, change ONLY the two values in AI_CONFIG below.
// Everything else (env var names, labels, placeholders) is derived automatically.
//
// Provider options:
//   'groq'      → model: 'llama-3.3-70b-versatile'   key: VITE_GROQ_API_KEY
//   'gemini'    → model: 'gemini-2.0-flash'           key: VITE_GEMINI_API_KEY
//   'anthropic' → model: 'claude-sonnet-4-6'          key: VITE_ANTHROPIC_API_KEY

export const AI_CONFIG = {
  provider: 'groq',
  model:    'llama-3.3-70b-versatile',
}

// ── Provider metadata (add a new row here to support a new provider) ────────
const PROVIDERS = {
  groq:      { envVar: 'VITE_GROQ_API_KEY',     label: 'GROQ',      placeholder: 'gsk_...' },
  gemini:    { envVar: 'VITE_GEMINI_API_KEY',    label: 'GEMINI',    placeholder: 'AIza...' },
  anthropic: { envVar: 'VITE_ANTHROPIC_API_KEY', label: 'ANTHROPIC', placeholder: 'sk-ant-...' },
}

const current = () => PROVIDERS[AI_CONFIG.provider]

export const getApiKey        = () => import.meta.env[current().envVar]
export const getProviderLabel = () => current().label
export const getKeyPlaceholder= () => current().placeholder
