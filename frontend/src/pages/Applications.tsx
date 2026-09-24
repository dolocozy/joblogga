import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { exportApplicationsCsv, fetchUpcoming, listApplications, STATUSES, updateApplication } from '../api'
import type { Application, ApplicationStatus } from '../api'
import { DateCell, FollowUp, LEDGER_COLUMNS, LedgerHeader } from '../components/Ledger'
import StatusSelect from '../components/StatusSelect'
import { formatDate, localToday } from '../dates'
import { saveFile } from '../download'
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
    <section className="mb-8 border-y border-rule py-4">
      <h2 className="mb-2 text-lg">Follow-ups due soon</h2>
      <ul className="space-y-1.5 text-sm">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4">
            <Link to={`/applications/${a.id}`} className="hover:underline">
              <span className="font-semibold">{a.company}</span> <span className="text-ink-soft">{a.role}</span>
            </Link>
            {/* YYYY-MM-DD strings compare correctly as plain text. */}
            <span className="figure">
              <FollowUp text={formatDate(a.follow_up_date!)} overdue={a.follow_up_date! < today} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Applications() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [page, setPage] = useState(0)
  const [items, setItems] = useState<Application[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true) // true only until the first response
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null) // row with a status change in flight
  const [exporting, setExporting] = useState(false)
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

  // Exports everything, not just what the filters show: it doubles as a backup.
  async function exportCsv() {
    setExporting(true)
    setError(null)
    try {
      saveFile(await exportApplicationsCsv(), `joblogga-applications-${localToday()}.csv`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export')
    } finally {
      setExporting(false)
    }
  }

  const filtered = q !== '' || company !== '' || status !== '' || dateFrom !== '' || dateTo !== ''
  const badRange = dateFrom !== '' && dateTo !== '' && dateFrom > dateTo
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstShown = total === 0 ? 0 : page * PAGE_SIZE + 1
  const lastShown = page * PAGE_SIZE + items.length

  const today = localToday()
  // Only open applications can be overdue: nobody follows up on a rejection.
  const isOverdue = (a: Application) =>
    a.follow_up_date !== null && a.follow_up_date < today && a.status !== 'rejected' && a.status !== 'withdrawn'

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl">Applications</h1>
        <div className="flex items-center gap-3">
          {/* Nothing to export on a brand-new account. */}
          {(total > 0 || filtered) && (
            <button type="button" onClick={exportCsv} disabled={exporting} className="btn btn-secondary">
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          )}
          <Link to="/applications/new" className="btn btn-primary">
            Add application
          </Link>
        </div>
      </div>

      <UpcomingPanel reloadKey={reloadKey} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <input
          type="search"
          placeholder="Search company, role, location, notes"
          aria-label="Search"
          value={filters.q}
          onChange={(e) => setFilter({ q: e.target.value })}
          className="input sm:col-span-2 lg:col-span-3"
        />
        <input
          type="search"
          placeholder="Company"
          aria-label="Company"
          value={filters.company}
          onChange={(e) => setFilter({ company: e.target.value })}
          className="input lg:col-span-2"
        />
        <select
          value={filters.status}
          onChange={(e) => setFilter({ status: e.target.value as ApplicationStatus | '' })}
          aria-label="Filter by status"
          className="input"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-ink-soft lg:col-span-2">
          Applied from
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilter({ dateFrom: e.target.value })}
            className="input flex-1"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft lg:col-span-2">
          to
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilter({ dateTo: e.target.value })}
            className="input flex-1"
          />
        </label>
        {filtered && (
          <button type="button" onClick={() => setFilter(NO_FILTERS)} className="link self-center justify-self-start text-sm lg:col-span-2">
            Clear filters
          </button>
        )}
      </div>

      {badRange && (
        <p role="alert" className="mb-3 text-sm text-brick">
          The start date is after the end date, so nothing can match.
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick-deep">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-ink-soft">Loading…</p>
      ) : items.length === 0 ? (
        <div className="sheet p-10 text-center text-ink-soft">
          {filtered ? (
            'No applications match your filters.'
          ) : (
            <>
              No applications yet.{' '}
              <Link to="/applications/new" className="link">
                Add your first one
              </Link>
              .
            </>
          )}
        </div>
      ) : (
        <>
          <LedgerHeader />
          <ul>
            {items.map((a) => (
              <li
                key={a.id}
                className={`grid gap-x-4 gap-y-1 border-b border-rule py-3 md:items-center ${LEDGER_COLUMNS}`}
              >
                <Link to={`/applications/${a.id}`} className="group min-w-0">
                  <span className="block truncate font-semibold group-hover:underline">{a.company}</span>
                  {/* Role and location are separated by a comma, as in a sentence. */}
                  <span className="block truncate text-sm text-ink-soft">
                    {a.role}
                    {a.location ? `, ${a.location}` : ''}
                  </span>
                </Link>
                {/* The status control sits beside the link (not inside it): a control nested in a link is invalid HTML. */}
                <StatusSelect
                  value={a.status}
                  label={`Status for ${a.company}`}
                  disabled={busyId === a.id}
                  onChange={(next) => changeStatus(a, next)}
                />
                <DateCell label="Applied">{formatDate(a.date_applied)}</DateCell>
                <DateCell label="Follow up">
                  {a.follow_up_date ? (
                    <FollowUp text={formatDate(a.follow_up_date)} overdue={isOverdue(a)} />
                  ) : (
                    <span className="text-ink-soft">None</span>
                  )}
                </DateCell>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between text-sm text-ink-soft">
            <span>
              Showing {firstShown}–{lastShown} of {total}
            </span>
            {pageCount > 1 && (
              <nav aria-label="Pagination" className="flex items-center gap-3">
                <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="btn btn-secondary btn-sm">
                  Previous
                </button>
                <span>
                  Page {page + 1} of {pageCount}
                </span>
                <button onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pageCount} className="btn btn-secondary btn-sm">
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
