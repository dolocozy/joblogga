import type { ApplicationStatus } from '../api'
import { statusLabel, statusStyles } from '../status'

export default function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[status]}`}>
      {statusLabel(status)}
    </span>
  )
}
