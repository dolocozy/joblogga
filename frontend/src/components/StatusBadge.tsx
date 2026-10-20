import type { ApplicationStatus } from '../api'
import { statusLabel, statusText } from '../status'
import StageMeter from './StageMeter'

// A status shown as its word, with the stage meter beside it (left off where a route already shows the stage).
export default function StatusBadge({ status, meter = true }: { status: ApplicationStatus; meter?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      {meter && <StageMeter status={status} />}
      <span className={statusText[status]}>{statusLabel(status)}</span>
    </span>
  )
}
