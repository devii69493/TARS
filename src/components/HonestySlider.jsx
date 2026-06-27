export function HonestySlider({ value, onChange }) {
  const label =
    value >= 85 ? 'MAXIMUM'
    : value >= 65 ? 'HIGH'
    : value >= 45 ? 'BALANCED'
    : 'DIPLOMATIC'

  return (
    <div className="honesty-slider">
      <div className="honesty-header">
        <span className="honesty-label">HONESTY PROTOCOL</span>
        <span className="honesty-value">{Math.round(value)}% — {label}</span>
      </div>
      <input
        type="range"
        min={10}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider"
        aria-label="Honesty level"
      />
      <div className="honesty-markers">
        <span>DIPLOMATIC</span>
        <span>BALANCED</span>
        <span>MAXIMUM</span>
      </div>
    </div>
  )
}
