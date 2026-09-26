import type { ApplicationStatus } from '../api'
import { stageCount } from '../status'

// Four small ticks showing how far along the pipeline an application is. It is
// decorative (the status word beside it says the same thing), so it is hidden
// from screen readers. Declined, Rejected and Withdrawn show empty ticks (Rejected in its own color).
export default function StageMeter({ status }: { status: ApplicationStatus }) {
  const filled = stageCount[status]
  const hollow = status === 'rejected' ? 'border-brick' : 'border-pencil'
  return (
    <span aria-hidden className="inline-flex gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`h-1.5 w-2 ${i < filled ? 'bg-pine' : `border ${hollow}`}`} />
      ))}
    </span>
  )
}
