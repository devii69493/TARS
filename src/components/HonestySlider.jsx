import { PersonalitySlider } from './PersonalitySlider'

const getTag = (v) =>
  v >= 85 ? 'MAXIMUM' : v >= 65 ? 'HIGH' : v >= 45 ? 'BALANCED' : 'DIPLOMATIC'

export function HonestySlider({ value, onChange }) {
  return (
    <PersonalitySlider
      protocol="HONESTY PROTOCOL"
      value={value}
      onChange={onChange}
      min={10}
      markers={['DIPLOMATIC', 'BALANCED', 'MAXIMUM']}
      getTag={getTag}
    />
  )
}
