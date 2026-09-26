import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, deleteApplication, getApplication, updateApplication } from '../api'
import type { ApplicationDetail as Detail, ApplicationInput } from '../api'
import ApplicationForm from '../components/ApplicationForm'
import MarkApplied from '../components/MarkApplied'
import PostingLink from '../components/PostingLink'
import StatusBadge from '../components/StatusBadge'
import { formatDateTime } from '../dates'
import { statusLabel } from '../status'
import { roleLine } from '../workMode'

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
    work_mode: a.work_mode,
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
      <p className="text-ink-soft">
        Application not found.{' '}
        <Link to="/applications" className="link">
          Back to your applications
        </Link>
      </p>
    )
  }
  if (error) return <p role="alert" className="text-brick">{error}</p>
  if (!app) return <p className="text-ink-soft">Loading…</p>

  async function handleDelete() {
    if (!app || !window.confirm(`Delete your application to ${app.company}? This can't be undone.`)) return
    try {
      await deleteApplication(app.id)
      navigate('/applications', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  return (
    <>
      <Link to="/applications" className="link text-sm">
        Back to applications
      </Link>
      <div className="mb-6 mt-3">
        <h1 className="text-3xl">{app.company}</h1>
        <p className="text-lg text-ink-soft">{roleLine(app)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          <StatusBadge status={app.status} />
          <PostingLink url={app.job_url} />
        </div>
      </div>

      {app.status === 'saved' && (
        <MarkApplied
          onApply={async (date) => {
            setSaved(false)
            setApp(await updateApplication(app.id, { status: 'applied', date_applied: date }))
          }}
        />
      )}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="sheet p-6 lg:col-span-2">
          {saved && (
            <p role="status" className="mb-4 border-l-2 border-pine bg-pine/5 px-3 py-2 text-sm">
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

        <aside className="space-y-8">
          <section>
            <h2 className="mb-2 border-b-2 border-ink pb-2 text-lg">Status history</h2>
            <ol>
              {[...app.history].reverse().map((h) => (
                <li key={h.id} className="border-b border-rule py-3 text-sm">
                  <p className="font-semibold">
                    {h.from_status
                      ? `Moved from ${statusLabel(h.from_status)} to ${statusLabel(h.to_status)}`
                      : `Started as ${statusLabel(h.to_status)}`}
                  </p>
                  <p className="figure text-ink-soft">{formatDateTime(h.changed_at)}</p>
                </li>
              ))}
            </ol>
          </section>

          {error && <p role="alert" className="text-brick">{error}</p>}
          <button onClick={handleDelete} className="btn btn-danger">
            Delete application
          </button>
        </aside>
      </div>
    </>
  )
}
