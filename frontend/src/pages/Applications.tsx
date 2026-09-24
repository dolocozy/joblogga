import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchUpcoming, listApplications, STATUSES } from '../api'
import type { Application, ApplicationStatus } from '../api'
import StatusBadge from '../components/StatusBadge'
import { formatDate, localToday } from '../dates'
import { statusLabel } from '../status'

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

function UpcomingPanel() {
  const [items, setItems] = useState<Application[]>([])
  useEffect(() => {
    fetchUpcoming().then(setItems).catch(() => setItems([]))
  }, [])
  if (items.length === 0) return null

  const today = localToday()
  return (
    <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold text-amber-900 mb-2">Follow-ups due soon</h2>
      <ul className="space-y-1 text-sm">
        {items.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2">
            <Link to={`/applications/${a.id}`} className="text-slate-900 hover:underline">
              {a.company} <span className="text-slate-500">· {a.role}</span>
            </Link>
            {/* YYYY-MM-DD strings compare correctly as plain text. */}
            <span className={a.follow_up_date! < today ? 'text-red-700 font-medium' : 'text-amber-800'}>
              {a.follow_up_date! < today ? 'Overdue · ' : ''}
              {formatDate(a.follow_up_date!)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Applications() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ApplicationStatus | ''>('')
  const [items, setItems] = useState<Application[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Wait for a pause in typing so we don't fire a request per keystroke.
  const q = useDebounced(search.trim(), 300)

  useEffect(() => {
    // `cancelled` drops the result of an outdated request, so a slow earlier
    // response can't overwrite a newer one.
    let cancelled = false
    listApplications({ q: q || undefined, status: status || undefined })
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        setTotal(res.total)
        setError(null)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [q, status])

  const filtered = q !== '' || status !== ''

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Applications</h1>
        <Link
          to="/applications/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          + Add application
        </Link>
      </div>

      <UpcomingPanel />

      <div className="flex flex-col gap-3 sm:flex-row mb-4">
        <input
          type="search"
          placeholder="Search company, role, location, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ApplicationStatus | '')}
          aria-label="Filter by status"
          className="rounded-lg border border-slate-300 px-3 py-2 bg-white"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
          {filtered ? (
            'No applications match your filters.'
          ) : (
            <>
              No applications yet.{' '}
              <Link to="/applications/new" className="text-indigo-600 hover:underline">
                Add your first one
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {items.map((a) => (
              <li key={a.id}>
                <Link
                  to={`/applications/${a.id}`}
                  className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{a.company}</p>
                    <p className="text-sm text-slate-600 truncate">
                      {a.role}
                      {a.location ? ` · ${a.location}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={a.status} />
                    <span className="text-xs text-slate-500">{formatDate(a.date_applied)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-slate-500">
            {total} application{total === 1 ? '' : 's'}
            {items.length < total ? ` (showing ${items.length})` : ''}
          </p>
        </>
      )}
    </>
  )
}
