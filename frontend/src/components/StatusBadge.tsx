import type { ApplicationStatus } from '../api'
import { statusLabel, statusText } from '../status'
import StageMeter from './StageMeter'

// A status shown as its word, with the stage meter beside it.
export default function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <StageMeter status={status} />
      <span className={statusText[status]}>{statusLabel(status)}</span>
    </span>
  )
}
