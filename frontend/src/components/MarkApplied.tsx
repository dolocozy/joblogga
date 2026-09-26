import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { localToday } from '../dates'

// Turns a saved job into an application: the date defaults to today and can be changed
// first (say, you applied yesterday and are only logging it now).
export default function MarkApplied({ onApply }: { onApply: (date: string) => Promise<void> }) {
  const id = useId()
  const [date, setDate] = useState(localToday())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!date) {
      setError('Enter the date you applied')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onApply(date)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Mark as applied" className="sheet mb-6 flex flex-wrap items-end gap-x-4 gap-y-3 border-l-2 border-l-pine p-4">
      <div>
        <p className="font-semibold">Applied to this one?</p>
        <p className="text-sm text-ink-soft">It is saved, not applied yet, so it is left out of your response rate and weekly totals until you say so.</p>
      </div>
      <div className="flex items-end gap-3">
        <div>
          <label htmlFor={id} className="field-label">
            Date applied
          </label>
          <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={error ? true : undefined} className="input mt-1" />
        </div>
        <button type="submit" disabled={busy} className="btn btn-primary">
          {busy ? 'Saving…' : 'Mark as applied'}
        </button>
      </div>
      {error && (
        <p role="alert" className="w-full text-sm text-brick">
          {error}
        </p>
      )}
    </form>
  )
}
