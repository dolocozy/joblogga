import { STATUSES } from '../api'
import type { ApplicationStatus } from '../api'
import { statusLabel, statusStyles } from '../status'

interface Props {
  value: ApplicationStatus
  label: string // accessible name, e.g. "Status for Acme"
  disabled?: boolean
  onChange: (status: ApplicationStatus) => void
}

// A dropdown styled like a status badge, for changing status in place.
export default function StatusSelect({ value, label, disabled, onChange }: Props) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as ApplicationStatus)}
      className={`rounded-full border-0 px-2.5 py-0.5 text-xs font-medium cursor-pointer disabled:opacity-60 ${statusStyles[value]}`}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {statusLabel(s)}
        </option>
      ))}
    </select>
  )
}
