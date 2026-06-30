export function PersonalitySlider({ protocol, value, onChange, min = 0, markers, getTag }) {
  return (
    <div className="honesty-slider">
      <div className="honesty-header">
        <span className="honesty-label">{protocol}</span>
        <span className="honesty-value">{Math.round(value)}% — {getTag(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider"
        aria-label={protocol}
      />
      <div className="honesty-markers">
        {markers.map((m, i) => <span key={i}>{m}</span>)}
      </div>
    </div>
  )
}
