import { useId } from 'react'
import type { ReactNode } from 'react'

// A section of a long form, marked by a stop on a vertical line that runs down to the next section: the same
// route shape the applications list uses, so the form reads as a few stops, not one long page of fields.
export default function FormSection({ title, last = false, children }: { title: string; last?: boolean; children: ReactNode }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="relative pl-8 pb-8">
      <span aria-hidden className="absolute left-0 top-2 h-[11px] w-[11px] rounded-field border-[3px] border-cobalt bg-ticket" />
      {!last && <span aria-hidden className="absolute bottom-0 left-[4px] top-6 w-[3px] bg-cobalt" />}
      <h2 id={headingId} className="mb-4 text-xl">
        {title}
      </h2>
      {children}
    </section>
  )
}
