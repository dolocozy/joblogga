import { STATUSES } from '../api'
import type { ApplicationStatus } from '../api'
import { statusLabel, statusText } from '../status'
import StageMeter from './StageMeter'

interface Props {
  value: ApplicationStatus
  label: string // accessible name, e.g. "Status for Acme"
  disabled?: boolean
  onChange: (status: ApplicationStatus) => void
}

// Changes an application's status in place. Looks like the status word with an
// underline, since it is a control and should read as one.
export default function StatusSelect({ value, label, disabled, onChange }: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      <StageMeter status={value} />
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as ApplicationStatus)}
        className={`cursor-pointer rounded-none border-b border-pencil bg-transparent py-0.5 text-sm ${statusText[value]} disabled:opacity-60`}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s} className="font-normal text-ink">
            {statusLabel(s)}
          </option>
        ))}
      </select>
    </span>
  )
}
