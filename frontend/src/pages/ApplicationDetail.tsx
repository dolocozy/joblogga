import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, deleteApplication, getApplication, updateApplication } from '../api'
import type { ApplicationDetail as Detail, ApplicationInput } from '../api'
import ApplicationForm from '../components/ApplicationForm'
import ContactsSection from '../components/ContactsSection'
import MarkApplied from '../components/MarkApplied'
import PostingLink from '../components/PostingLink'
import RoundsNote from '../components/RoundsNote'
import StatusBadge from '../components/StatusBadge'
import TagList from '../components/TagList'
import { MAX_TAGS } from '../tags'
import { formatDateTime } from '../dates'
import { statusLabel } from '../status'
import { placeLine, roleLine } from '../workMode'

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
    country_id: a.country?.id ?? null,
    city_id: a.city?.id ?? null,
    work_mode: a.work_mode,
    tags: a.tags,
    notes: a.notes,
    interview_round: a.interview_round,
    interview_rounds_total: a.interview_rounds_total,
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
  // Bumped to remount the form with fresh values after a save or applying. Not on archiving: that should not wipe what someone is typing.
  const [formKey, setFormKey] = useState(0)
  const [archiving, setArchiving] = useState(false)

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

  async function setArchived(archive: boolean) {
    if (!app) return
    setArchiving(true)
    setError(null)
    try {
      setApp(await updateApplication(app.id, { archived: archive }))
    } catch (err) {
      setError(err instanceof Error ? err.message : archive ? 'Could not archive' : 'Could not unarchive')
    } finally {
      setArchiving(false)
    }
  }

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
        {placeLine(app) && <p className="text-ink-soft">{placeLine(app)}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          <StatusBadge status={app.status} />
          <RoundsNote app={app} className="text-sm" />
          <PostingLink url={app.job_url} />
        </div>
        <TagList tags={app.tags} max={MAX_TAGS} className="mt-2" />
      </div>

      {app.archived && (
        <div className="sheet mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-l-2 border-l-pencil p-4">
          <p className="text-sm">
            <span className="font-semibold">This application is archived.</span> It is hidden from your list and board, and still counted in your dashboard and export.
          </p>
          <button type="button" onClick={() => setArchived(false)} disabled={archiving} className="btn btn-secondary btn-sm">
            {archiving ? 'Unarchiving…' : 'Unarchive'}
          </button>
        </div>
      )}

      {app.status === 'saved' && (
        <MarkApplied
          onApply={async (date) => {
            setSaved(false)
            setApp(await updateApplication(app.id, { status: 'applied', date_applied: date }))
            setFormKey((k) => k + 1)
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
            key={formKey}
            initial={toInput(app)}
            initialPlace={{
              country: app.country,
              city: app.city ? { id: app.city.id, label: `${app.city.name}, ${app.city.state.name}` } : null,
              location: app.location,
            }}
            submitLabel="Save changes"
            editingId={app.id}
            onSubmit={async (input) => {
              setSaved(false)
              setApp(await updateApplication(app.id, input))
              setFormKey((k) => k + 1)
              setSaved(true)
            }}
          />
        </div>

        <aside className="space-y-8">
          <ContactsSection applicationId={app.id} contacts={app.contacts} onChange={(contacts) => setApp({ ...app, contacts })} />
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
          <div className="flex flex-wrap items-center gap-x-2">
            {!app.archived && (
              <button type="button" onClick={() => setArchived(true)} disabled={archiving} className="btn btn-secondary btn-sm" title="Hide it from your list and board. It stays in your dashboard and export.">
                {archiving ? 'Archiving…' : 'Archive'}
              </button>
            )}
            {/* Archiving hides; this really deletes. */}
            <button onClick={handleDelete} className="btn btn-danger">
              Delete application
            </button>
          </div>
        </aside>
      </div>
    </>
  )
}
