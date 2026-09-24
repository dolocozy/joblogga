import { useState } from 'react'
import type { FormEvent } from 'react'
import { STATUSES } from '../api'
import type { ApplicationInput, ApplicationStatus } from '../api'
import { localToday } from '../dates'
import { statusLabel } from '../status'

interface Props {
  initial?: ApplicationInput
  submitLabel: string
  onSubmit: (input: ApplicationInput) => Promise<void>
}

const EMPTY: ApplicationInput = {
  company: '',
  role: '',
  job_url: null,
  date_applied: localToday(),
  resume_version: null,
  salary_min: null,
  salary_max: null,
  location: null,
  notes: null,
  status: 'applied',
  follow_up_date: null,
}

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500'

// Inputs work with strings; the API wants null for "empty" and numbers for salary.
const orNull = (v: string) => (v.trim() === '' ? null : v.trim())
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

export default function ApplicationForm({ initial = EMPTY, submitLabel, onSubmit }: Props) {
  const [company, setCompany] = useState(initial.company)
  const [role, setRole] = useState(initial.role)
  const [jobUrl, setJobUrl] = useState(initial.job_url ?? '')
  const [dateApplied, setDateApplied] = useState(initial.date_applied)
  const [resume, setResume] = useState(initial.resume_version ?? '')
  const [salaryMin, setSalaryMin] = useState(initial.salary_min?.toString() ?? '')
  const [salaryMax, setSalaryMax] = useState(initial.salary_max?.toString() ?? '')
  const [location, setLocation] = useState(initial.location ?? '')
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [status, setStatus] = useState<ApplicationStatus>(initial.status)
  const [followUp, setFollowUp] = useState(initial.follow_up_date ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await onSubmit({
        company: company.trim(),
        role: role.trim(),
        job_url: orNull(jobUrl),
        date_applied: dateApplied,
        resume_version: orNull(resume),
        salary_min: numOrNull(salaryMin),
        salary_max: numOrNull(salaryMax),
        location: orNull(location),
        notes: orNull(notes),
        status,
        follow_up_date: orNull(followUp),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const label = 'block text-sm font-medium text-slate-700'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          Company *
          <input required maxLength={200} value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} />
        </label>
        <label className={label}>
          Role *
          <input required maxLength={200} value={role} onChange={(e) => setRole(e.target.value)} className={inputClass} />
        </label>
        <label className={label}>
          Job posting link
          <input type="url" placeholder="https://…" value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} className={inputClass} />
        </label>
        <label className={label}>
          Location
          <input maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} />
        </label>
        <label className={label}>
          Date applied *
          <input type="date" required value={dateApplied} onChange={(e) => setDateApplied(e.target.value)} className={inputClass} />
        </label>
        <label className={label}>
          Follow up by
          <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className={inputClass} />
        </label>
        <label className={label}>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)} className={inputClass}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Resume version
          <input maxLength={100} placeholder="e.g. tech-focused" value={resume} onChange={(e) => setResume(e.target.value)} className={inputClass} />
        </label>
        <label className={label}>
          Salary min
          <input type="number" min={0} value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} className={inputClass} />
        </label>
        <label className={label}>
          Salary max
          <input type="number" min={0} value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} className={inputClass} />
        </label>
      </div>

      <label className={label}>
        Notes
        <textarea rows={4} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
      </label>

      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
