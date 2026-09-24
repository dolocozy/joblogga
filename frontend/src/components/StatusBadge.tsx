import type { ApplicationStatus } from '../api'
import { statusLabel } from '../status'

const STYLES: Record<ApplicationStatus, string> = {
  applied: 'bg-slate-100 text-slate-700',
  screening: 'bg-sky-100 text-sky-800',
  interview: 'bg-indigo-100 text-indigo-800',
  offer: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  withdrawn: 'bg-amber-100 text-amber-800',
}

export default function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {statusLabel(status)}
    </span>
  )
}
