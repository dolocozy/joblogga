import { useEffect, useRef } from 'react'
import type { DuplicateMatch } from '../api'
import { describeMatch } from '../duplicates'

interface Props {
  matches: DuplicateMatch[]
  confirmLabel: string // "Add anyway" or "Save anyway"
  busy: boolean
  onConfirm: () => void
  onDismiss: () => void
}

// Shown when the company and role being saved match an application the person already has. It informs and
// asks; nothing is blocked, since applying twice can be perfectly reasonable.
export default function DuplicateWarning({ matches, confirmLabel, busy, onConfirm, onDismiss }: Props) {
  const heading = useRef<HTMLParagraphElement>(null)
  // Move attention to the warning when it appears, so it is not missed below the fold or by a screen reader.
  useEffect(() => heading.current?.focus(), [])
  const first = matches[0]
  return (
    <div role="group" aria-label="Possible duplicate" className="border-l-2 border-marker bg-marker/20 px-4 py-3">
      <p ref={heading} tabIndex={-1} className="font-semibold outline-none">
        {matches.length === 1
          ? `You already have an application for ${first.company}, ${first.role}.`
          : `You already have ${matches.length} applications for ${first.company}, ${first.role}.`}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {matches.map((m) => (
          <li key={m.id}>
            {/* A new tab, so the form you are filling in is not lost. */}
            <a href={`/applications/${m.id}`} target="_blank" rel="noopener noreferrer" className="link">
              {m.company} — {m.role}
            </a>
            : {describeMatch(m)}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={onConfirm} disabled={busy} className="btn btn-primary">
          {busy ? 'Saving…' : confirmLabel}
        </button>
        <button type="button" onClick={onDismiss} disabled={busy} className="btn btn-secondary">
          Go back and edit
        </button>
      </div>
    </div>
  )
}
