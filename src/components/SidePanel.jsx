import { useRef } from 'react'
import { ChatLog } from './ChatLog'
import { HonestySlider } from './HonestySlider'
import { getProviderLabel, getKeyPlaceholder } from '../lib/aiConfig'

export function SidePanel({
  messages,
  interimText,
  honesty,
  onHonestyChange,
  error,
  onSubmit,
  disabled,
  apiKey,
  onApiKeyChange,
  showSettings,
  onToggleSettings,
  // README profile
  profile,
  onProfileLoad,
  onProfileClear,
  // Google
  googleConnected,
  googlePending,
  googleError,
  googleClientId,
  onGoogleConnect,
  onGoogleDisconnect,
  // Voice
  voiceMode,
  onVoiceModeChange,
  agentConnected,
}) {
  const fileInputRef = useRef(null)

  const handleKeySubmit = (e) => {
    e.preventDefault()
    const val = e.target.elements.key.value.trim()
    if (val) onApiKeyChange(val)
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => onProfileLoad(ev.target.result)
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <aside className="side-panel">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="side-header">
        <div className="side-header-left">
          <span className="side-title">COMM LOG</span>
          <span className="side-provider">{getProviderLabel()}</span>
        </div>
        <button className="icon-btn" onClick={onToggleSettings} title="Settings">⚙</button>
      </div>

      {/* ── Settings panel ───────────────────────────────────────────── */}
      {showSettings && (
        <div className="settings-panel">

          {/* AI API key */}
          <div className="settings-section">
            <div className="settings-label">AI API KEY</div>
            <form className="key-form" onSubmit={handleKeySubmit}>
              <input
                name="key"
                type="password"
                defaultValue={apiKey}
                placeholder={getKeyPlaceholder()}
                className="key-input"
                autoFocus
              />
              <button type="submit" className="key-save">LINK</button>
            </form>
          </div>

          {/* Operator profile */}
          <div className="settings-section">
            <div className="settings-label">OPERATOR PROFILE</div>
            {profile ? (
              <div className="profile-row">
                <span className="profile-status">◉ README.md LOADED</span>
                <button className="settings-btn settings-btn--dim" onClick={onProfileClear}>CLEAR</button>
              </div>
            ) : (
              <div className="profile-row">
                <span className="profile-hint">Upload README.md to personalise TARS</span>
                <button className="settings-btn" onClick={() => fileInputRef.current?.click()}>UPLOAD</button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>

          {/* Google connection */}
          <div className="settings-section">
            <div className="settings-label">GOOGLE — GMAIL + CALENDAR</div>
            {!googleClientId ? (
              <div className="settings-hint">Set VITE_GOOGLE_CLIENT_ID to enable</div>
            ) : googleConnected ? (
              <div className="profile-row">
                <span className="profile-status">◉ CONNECTED</span>
                <button className="settings-btn settings-btn--dim" onClick={onGoogleDisconnect}>
                  DISCONNECT
                </button>
              </div>
            ) : (
              <div className="profile-row">
                <span className="profile-hint">{googlePending ? 'AUTHORIZING...' : 'Not connected'}</span>
                <button
                  className="settings-btn"
                  onClick={onGoogleConnect}
                  disabled={googlePending}
                >
                  {googlePending ? '...' : 'CONNECT'}
                </button>
              </div>
            )}
            {googleError && (
              <div className="settings-error">{googleError}</div>
            )}
          </div>

          {/* Voice output */}
          <div className="settings-section">
            <div className="settings-label">VOICE OUTPUT</div>
            <div className="voice-mode-row">
              {[
                { id: 'elevenlabs', label: 'ELEVENLABS' },
                { id: 'local',     label: 'LOCAL (MACOS)' },
                { id: 'browser',   label: 'BROWSER' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  className={`voice-mode-btn${voiceMode === id ? ' voice-mode-btn--active' : ''}`}
                  onClick={() => onVoiceModeChange(id)}
                  title={id === 'local' && !agentConnected ? 'Requires desktop agent' : ''}
                >
                  {label}
                </button>
              ))}
            </div>
            {voiceMode === 'local' && !agentConnected && (
              <div className="settings-hint">Agent offline — run start-tars.sh</div>
            )}
          </div>

        </div>
      )}

      {/* ── Honesty slider ───────────────────────────────────────────── */}
      <div className="side-honesty">
        <HonestySlider value={honesty} onChange={onHonestyChange} />
      </div>

      {/* ── Chat log ─────────────────────────────────────────────────── */}
      <ChatLog messages={messages} interimText={interimText} />

      {/* ── Error ────────────────────────────────────────────────────── */}
      {error && <div className="side-error">{error}</div>}

      {/* ── Text input ───────────────────────────────────────────────── */}
      <form className="side-input-row" onSubmit={onSubmit}>
        <input
          name="textInput"
          type="text"
          placeholder={disabled ? 'SESSION ACTIVE...' : 'TYPE MESSAGE...'}
          className="side-input"
          disabled={disabled}
          autoComplete="off"
        />
        <button type="submit" className="side-send" disabled={disabled}>▶</button>
      </form>

    </aside>
  )
}
