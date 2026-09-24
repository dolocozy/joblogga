import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchStats } from '../api'
import type { Stats } from '../api'
import StatusChart from '../components/charts/StatusChart'
import WeeklyChart from '../components/charts/WeeklyChart'

// The one time filter for the whole page: it scopes every number and chart.
const RANGES: { label: string; weeks: number | null }[] = [
  { label: '4 weeks', weeks: 4 },
  { label: '12 weeks', weeks: 12 },
  { label: '26 weeks', weeks: 26 },
  { label: '52 weeks', weeks: 52 },
  { label: 'All time', weeks: null },
]

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value.toLocaleString()}</p>
    </div>
  )
}

export default function Dashboard() {
  const [weeks, setWeeks] = useState<number | null>(12)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false // ignore a response that a newer range choice has outdated
    fetchStats(weeks)
      .then((s) => {
        if (cancelled) return
        setStats(s)
        setError(null)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [weeks])

  function pickRange(next: number | null) {
    if (next === weeks) return
    setLoading(true) // keep showing the previous numbers, dimmed, until the new ones arrive
    setWeeks(next)
  }

  const count = (status: string) => stats?.by_status.find((s) => s.status === status)?.count ?? 0

  return (
    <>
      <h1 className="text-2xl font-semibold text-slate-900 mb-4">Dashboard</h1>

      <div role="group" aria-label="Time range" className="mb-6 flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.label}
            type="button"
            aria-pressed={r.weeks === weeks}
            onClick={() => pickRange(r.weeks)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              r.weeks === weeks
                ? 'border-indigo-600 bg-indigo-50 font-medium text-indigo-700'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {stats === null ? (
        !error && <p className="text-slate-500">Loading…</p>
      ) : stats.total === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-600">
          {weeks === null ? (
            <>
              No applications yet.{' '}
              <Link to="/applications/new" className="text-indigo-600 hover:underline">
                Add your first one
              </Link>{' '}
              to see your stats.
            </>
          ) : (
            'No applications in this period. Try a longer range.'
          )}
        </div>
      ) : (
        // While a new range loads, the previous render stays put at reduced
        // opacity: no skeleton and no layout jump.
        <div aria-busy={loading} className={`space-y-4 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-sm text-slate-500">Response rate</p>
              {/* The one headline number: 48px, in the same sans as everything else. */}
              <p className="mt-1 text-5xl font-semibold text-slate-900">
                {stats.response.rate === null ? '—' : `${Math.round(stats.response.rate * 100)}%`}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                {stats.response.rate === null
                  ? 'Nothing to measure yet'
                  : `${stats.response.responded} of ${stats.response.eligible} heard back`}
              </p>
            </div>
            <StatTile label="Applications" value={stats.total} />
            <StatTile label="Still open" value={count('applied') + count('screening') + count('interview')} />
            <StatTile label="Offers" value={count('offer')} />
          </div>

          <p className="text-sm text-slate-500">
            Response rate counts Screening, Interview, Offer and Rejected as a response. Withdrawn applications are
            left out entirely, since withdrawing is your decision, not the employer's.
          </p>

          <div className="grid gap-4 lg:grid-cols-2">
            <WeeklyChart perWeek={stats.per_week} />
            <StatusChart byStatus={stats.by_status} />
          </div>
        </div>
      )}
    </>
  )
}
