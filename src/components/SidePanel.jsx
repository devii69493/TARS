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
  showKeyInput,
  onToggleKeyInput,
}) {
  const handleKeySubmit = (e) => {
    e.preventDefault()
    const val = e.target.elements.key.value.trim()
    if (val) onApiKeyChange(val)
  }

  return (
    <aside className="side-panel">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="side-header">
        <div className="side-header-left">
          <span className="side-title">COMM LOG</span>
          <span className="side-provider">{getProviderLabel()}</span>
        </div>
        <button className="icon-btn" onClick={onToggleKeyInput} title="API Key settings">⚙</button>
      </div>

      {/* ── API key form ────────────────────────────────────────────── */}
      {showKeyInput && (
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
      )}

      {/* ── Honesty slider ──────────────────────────────────────────── */}
      <div className="side-honesty">
        <HonestySlider value={honesty} onChange={onHonestyChange} />
      </div>

      {/* ── Chat log ────────────────────────────────────────────────── */}
      <ChatLog messages={messages} interimText={interimText} />

      {/* ── Error ───────────────────────────────────────────────────── */}
      {error && <div className="side-error">{error}</div>}

      {/* ── Text input (disabled during conv mode) ───────────────────── */}
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
