import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchUpcoming, listApplications, STATUSES, updateApplication } from '../api'
import type { Application, ApplicationStatus } from '../api'
import StatusSelect from '../components/StatusSelect'
import { formatDate, localToday } from '../dates'
import { useDebounced } from '../hooks'
import { statusLabel } from '../status'

export const PAGE_SIZE = 20

interface Filters {
  q: string
  company: string
  status: ApplicationStatus | ''
  dateFrom: string
  dateTo: string
}

const NO_FILTERS: Filters = { q: '', company: '', status: '', dateFrom: '', dateTo: '' }

function UpcomingPanel({ reloadKey }: { reloadKey: number }) {
  const [items, setItems] = useState<Application[]>([])
  useEffect(() => {
    fetchUpcoming()
      .then(setItems)
      .catch(() => setItems([]))
  }, [reloadKey])
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

const inputClass =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function Applications() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [page, setPage] = useState(0)
  const [items, setItems] = useState<Application[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true) // true only until the first response
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null) // row with a status change in flight
  // Bumped after a status change to refetch the list and the reminders panel.
  const [reloadKey, setReloadKey] = useState(0)

  // Changing any filter returns to page 1; otherwise you could be left on a
  // page that no longer exists.
  function setFilter(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(0)
  }

  // Text fields wait for a pause in typing; dropdowns and dates apply at once.
  const q = useDebounced(filters.q.trim(), 300)
  const company = useDebounced(filters.company.trim(), 300)
  const { status, dateFrom, dateTo } = filters

  useEffect(() => {
    // `cancelled` drops the result of an outdated request, so a slow earlier
    // response can't overwrite a newer one.
    let cancelled = false
    listApplications({
      q,
      company,
      status: status || undefined,
      date_from: dateFrom,
      date_to: dateTo,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return
        // Deleting or re-filtering can leave us past the last page: step back.
        if (res.items.length === 0 && res.total > 0 && page > 0) {
          setPage(Math.ceil(res.total / PAGE_SIZE) - 1)
          return
        }
        setItems(res.items)
        setTotal(res.total)
        setError(null)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [q, company, status, dateFrom, dateTo, page, reloadKey])

  async function changeStatus(app: Application, next: ApplicationStatus) {
    if (next === app.status) return
    setBusyId(app.id)
    setError(null)
    try {
      await updateApplication(app.id, { status: next })
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change status')
    } finally {
      setBusyId(null)
    }
  }

  const filtered = q !== '' || company !== '' || status !== '' || dateFrom !== '' || dateTo !== ''
  const badRange = dateFrom !== '' && dateTo !== '' && dateFrom > dateTo
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstShown = total === 0 ? 0 : page * PAGE_SIZE + 1
  const lastShown = page * PAGE_SIZE + items.length

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

      <UpcomingPanel reloadKey={reloadKey} />

      <div className="grid gap-3 mb-4 sm:grid-cols-2 lg:grid-cols-6">
        <input
          type="search"
          placeholder="Search company, role, location, notes…"
          aria-label="Search"
          value={filters.q}
          onChange={(e) => setFilter({ q: e.target.value })}
          className={`${inputClass} sm:col-span-2 lg:col-span-3`}
        />
        <input
          type="search"
          placeholder="Company"
          aria-label="Company"
          value={filters.company}
          onChange={(e) => setFilter({ company: e.target.value })}
          className={`${inputClass} lg:col-span-2`}
        />
        <select
          value={filters.status}
          onChange={(e) => setFilter({ status: e.target.value as ApplicationStatus | '' })}
          aria-label="Filter by status"
          className={inputClass}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-1 lg:col-span-2">
          Applied from
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilter({ dateFrom: e.target.value })}
            className={`${inputClass} flex-1`}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 sm:col-span-1 lg:col-span-2">
          to
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilter({ dateTo: e.target.value })}
            className={`${inputClass} flex-1`}
          />
        </label>
        {filtered && (
          <button
            type="button"
            onClick={() => setFilter(NO_FILTERS)}
            className="text-sm text-indigo-600 hover:underline justify-self-start lg:col-span-2 self-center"
          >
            Clear filters
          </button>
        )}
      </div>

      {badRange && (
        <p role="alert" className="text-sm text-amber-700 mb-3">
          The start date is after the end date, so nothing can match.
        </p>
      )}
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
              <li key={a.id} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-50">
                <Link to={`/applications/${a.id}`} className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 truncate">{a.company}</p>
                  <p className="text-sm text-slate-600 truncate">
                    {a.role}
                    {a.location ? ` · ${a.location}` : ''}
                  </p>
                </Link>
                {/* Sits beside the link (not inside it): a control nested in a link is invalid HTML. */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <StatusSelect
                    value={a.status}
                    label={`Status for ${a.company}`}
                    disabled={busyId === a.id}
                    onChange={(next) => changeStatus(a, next)}
                  />
                  <span className="text-xs text-slate-500">{formatDate(a.date_applied)}</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>
              Showing {firstShown}–{lastShown} of {total}
            </span>
            {pageCount > 1 && (
              <nav aria-label="Pagination" className="flex items-center gap-3">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 0}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-white"
                >
                  Previous
                </button>
                <span>
                  Page {page + 1} of {pageCount}
                </span>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page + 1 >= pageCount}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 hover:bg-slate-100 disabled:opacity-50 disabled:hover:bg-white"
                >
                  Next
                </button>
              </nav>
            )}
          </div>
        </>
      )}
    </>
  )
}
