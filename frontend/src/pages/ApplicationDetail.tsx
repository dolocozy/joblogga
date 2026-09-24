import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, deleteApplication, getApplication, updateApplication } from '../api'
import type { ApplicationDetail as Detail, ApplicationInput } from '../api'
import ApplicationForm from '../components/ApplicationForm'
import StatusBadge from '../components/StatusBadge'
import { formatDateTime } from '../dates'

function toInput(a: Detail): ApplicationInput {
  return {
    company: a.company,
    role: a.role,
    job_url: a.job_url,
    date_applied: a.date_applied,
    resume_version: a.resume_version,
    salary_min: a.salary_min,
    salary_max: a.salary_max,
    location: a.location,
    notes: a.notes,
    status: a.status,
    follow_up_date: a.follow_up_date,
  }
}

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [app, setApp] = useState<Detail | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // A URL like /applications/abc is "not found" without asking the server.
  const appId = Number(id)
  const validId = Number.isInteger(appId)
  const notFound = missing || !validId

  useEffect(() => {
    if (!validId) return
    getApplication(appId)
      .then(setApp)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true)
        else setError(err.message)
      })
  }, [appId, validId])

  if (notFound) {
    return (
      <p className="text-slate-600">
        Application not found. <Link to="/" className="text-indigo-600 hover:underline">Back to list</Link>
      </p>
    )
  }
  if (error) return <p role="alert" className="text-red-700">{error}</p>
  if (!app) return <p className="text-slate-500">Loading…</p>

  async function handleDelete() {
    if (!app || !window.confirm(`Delete your application to ${app.company}? This can't be undone.`)) return
    try {
      await deleteApplication(app.id)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  // Only render the link if it's really http(s). The API already enforces this;
  // checking again here means a bad value could never become a script-running link.
  const safeUrl = app.job_url && /^https?:\/\//i.test(app.job_url) ? app.job_url : null

  return (
    <>
      <Link to="/" className="text-sm text-indigo-600 hover:underline">
        ← Back to applications
      </Link>
      <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">
          {app.company} <span className="text-slate-500 font-normal">· {app.role}</span>
        </h1>
        <StatusBadge status={app.status} />
        {safeUrl && (
          <a href={safeUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 hover:underline">
            View posting ↗
          </a>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-6">
          {saved && (
            <p role="status" className="mb-4 rounded-lg bg-emerald-50 text-emerald-800 text-sm px-3 py-2">
              Saved.
            </p>
          )}
          {/* key remounts the form with fresh values after each successful save */}
          <ApplicationForm
            key={app.updated_at}
            initial={toInput(app)}
            submitLabel="Save changes"
            onSubmit={async (input) => {
              setSaved(false)
              setApp(await updateApplication(app.id, input))
              setSaved(true)
            }}
          />
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="font-semibold text-slate-900 mb-3">Status history</h2>
            <ol className="space-y-3 text-sm">
              {[...app.history].reverse().map((h) => (
                <li key={h.id}>
                  <div className="flex items-center gap-2">
                    {h.from_status && (
                      <>
                        <StatusBadge status={h.from_status} />
                        <span className="text-slate-400">→</span>
                      </>
                    )}
                    <StatusBadge status={h.to_status} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {h.from_status ? '' : 'Started as · '}
                    {formatDateTime(h.changed_at)}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <button
            onClick={handleDelete}
            className="w-full rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete application
          </button>
        </aside>
      </div>
    </>
  )
}
