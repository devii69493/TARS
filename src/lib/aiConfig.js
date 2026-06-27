// ── AI Provider Configuration ──────────────────────────────────────────────
// To switch providers, change ONLY the two values in AI_CONFIG below.
// Everything else (env var names, labels, placeholders) is derived automatically.
//
// Provider options:
//   'openrouter' → model: 'meta-llama/llama-3.3-70b-instruct'  key: VITE_OPENROUTER_API_KEY
//   'groq'       → model: 'llama-3.3-70b-versatile'            key: VITE_GROQ_API_KEY
//   'gemini'     → model: 'gemini-2.0-flash'                   key: VITE_GEMINI_API_KEY
//   'anthropic'  → model: 'claude-sonnet-4-6'                  key: VITE_ANTHROPIC_API_KEY

export const AI_CONFIG = {
  provider: 'anthropic',
  model:    'claude-sonnet-4-6',
}

// ── Provider metadata ────────────────────────────────────────────────────────
const PROVIDERS = {
  openrouter: { envVar: 'VITE_OPENROUTER_API_KEY', label: 'OPENROUTER', placeholder: 'sk-or-v1-...' },
  groq:       { envVar: 'VITE_GROQ_API_KEY',       label: 'GROQ',       placeholder: 'gsk_...'      },
  gemini:     { envVar: 'VITE_GEMINI_API_KEY',      label: 'GEMINI',     placeholder: 'AIza...'      },
  anthropic:  { envVar: 'VITE_ANTHROPIC_API_KEY',   label: 'ANTHROPIC',  placeholder: 'sk-ant-...'   },
}

const current = () => PROVIDERS[AI_CONFIG.provider]

export const getApiKey         = () => import.meta.env[current().envVar]
export const getProviderLabel  = () => current().label
export const getKeyPlaceholder = () => current().placeholder
