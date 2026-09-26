import type { ReactNode } from 'react'

// Column layout shared by the real applications list and the landing page's
// sample page: company and role | status | applied | follow up.
export const LEDGER_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_10.5rem_9rem_11rem]'
// The saved-jobs list has one more column, for the "Mark applied" button.
export const SAVED_LEDGER_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_10.5rem_9rem_11rem_8rem]'

export function LedgerHeader({ saved = false }: { saved?: boolean }) {
  return (
    <div className={`hidden gap-x-4 border-b-2 border-ink pb-2 text-sm font-semibold text-ink-soft md:grid ${saved ? SAVED_LEDGER_COLUMNS : LEDGER_COLUMNS}`}>
      <span>Company and role</span>
      <span>Status</span>
      <span>{saved ? 'Saved' : 'Applied'}</span>
      <span>{saved ? 'Apply by' : 'Follow up'}</span>
      {saved && <span aria-hidden />}
    </div>
  )
}

// A date cell. On narrow screens the column header is hidden, so each cell
// names itself.
export function DateCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="figure">
      <span className="mr-1 font-sans text-xs text-ink-soft md:hidden">{label}</span>
      {children}
    </span>
  )
}

// A follow-up date. Overdue ones get the highlighter wash and the word "overdue".
// Ink stays on the wash (9.7:1); red text on yellow would be too faint.
export function FollowUp({ text, overdue }: { text: string; overdue: boolean }) {
  if (!overdue) return <>{text}</>
  return (
    <>
      <mark className="bg-marker px-1 text-ink">{text}</mark>{' '}
      <span className="font-sans text-xs font-semibold text-ink">overdue</span>
    </>
  )
}
