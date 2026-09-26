import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { STATUSES, WORK_MODES } from '../api'
import type { ApplicationInput, ApplicationStatus, WorkMode } from '../api'
import { localToday } from '../dates'
import { useFieldErrors } from '../hooks'
import { statusLabel } from '../status'
import { workModeLabel } from '../workMode'
import { httpUrlRule, required, wholeNumberRule } from '../validation'
import Field from './Field'

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
  work_mode: null,
  notes: null,
  status: 'applied',
  follow_up_date: null,
}

// Inputs work with strings; the API wants null for "empty" and numbers for salary.
const orNull = (v: string) => (v.trim() === '' ? null : v.trim())
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

export default function ApplicationForm({ initial = EMPTY, submitLabel, onSubmit }: Props) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`

  const [company, setCompany] = useState(initial.company)
  const [role, setRole] = useState(initial.role)
  const [jobUrl, setJobUrl] = useState(initial.job_url ?? '')
  const [dateApplied, setDateApplied] = useState(initial.date_applied)
  const [resume, setResume] = useState(initial.resume_version ?? '')
  const [salaryMin, setSalaryMin] = useState(initial.salary_min?.toString() ?? '')
  const [salaryMax, setSalaryMax] = useState(initial.salary_max?.toString() ?? '')
  const [location, setLocation] = useState(initial.location ?? '')
  const [workMode, setWorkMode] = useState<WorkMode | ''>(initial.work_mode ?? '')
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [status, setStatus] = useState<ApplicationStatus>(initial.status)
  const [followUp, setFollowUp] = useState(initial.follow_up_date ?? '')
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // The max is checked against the min only once each is a valid number by itself.
  const salaryMaxError =
    wholeNumberRule(salaryMax) ??
    (salaryMin.trim() && salaryMax.trim() && !wholeNumberRule(salaryMin) && Number(salaryMax) < Number(salaryMin)
      ? 'Max salary cannot be lower than min salary'
      : null)

  // Listed in form order, which is the order focus moves to on a failed submit.
  const fields = useFieldErrors(
    {
      company: required('Enter the company name')(company),
      role: required('Enter the role')(role),
      job_url: httpUrlRule(jobUrl),
      date_applied: required('Enter the date you applied')(dateApplied),
      salary_min: wholeNumberRule(salaryMin),
      salary_max: salaryMaxError,
    },
    id,
  )

  // Fields whose value is wrong until it is finished: the link ("h" is not a URL yet)
  // and the salaries (a max of "1" is below a min of 90000 while "100000" is being typed).
  const SETTLED = new Set(['job_url', 'salary_min', 'salary_max'])

  // Wires a text control to its state, revealing its error once it's been used.
  const bind = (name: 'company' | 'role' | 'job_url' | 'date_applied' | 'salary_min' | 'salary_max', set: (v: string) => void) => ({
    onChange: (e: { target: { value: string } }) => {
      set(e.target.value)
      const reveal = SETTLED.has(name) ? fields.settle : fields.visit
      reveal(name)
      // Min and max are checked against each other, so editing one revisits the other.
      if (name === 'salary_min') fields.settle('salary_max')
    },
    onBlur: () => fields.visit(name),
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!fields.validateAll()) return
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
        work_mode: workMode || null,
        notes: orNull(notes),
        status,
        follow_up_date: orNull(followUp),
      })
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    // noValidate: the browser's own validation popups are off; messages appear under the fields instead.
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {serverError && (
        <p role="alert" className="border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick-deep">
          {serverError}
        </p>
      )}

      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field id={id('company')} label="Company" required error={fields.error('company')}>
          {(c) => <input {...c} maxLength={200} value={company} {...bind('company', setCompany)} className="input" />}
        </Field>
        <Field id={id('role')} label="Role" required error={fields.error('role')}>
          {(c) => <input {...c} maxLength={200} value={role} {...bind('role', setRole)} className="input" />}
        </Field>
        <div className="sm:col-span-2">
          <Field id={id('job_url')} label="Job posting link" error={fields.error('job_url')}>
            {(c) => <input {...c} type="url" placeholder="https://" value={jobUrl} {...bind('job_url', setJobUrl)} className="input" />}
          </Field>
        </div>
        <Field id={id('location')} label="Location">
          {(c) => <input {...c} maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} className="input" />}
        </Field>
        <Field id={id('work_mode')} label="Work mode">
          {(c) => (
            <select {...c} value={workMode} onChange={(e) => setWorkMode(e.target.value as WorkMode | '')} className="input">
              {/* Left unset unless the posting says: nothing is guessed. */}
              <option value="">Not specified</option>
              {WORK_MODES.map((m) => (
                <option key={m} value={m}>
                  {workModeLabel[m]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={id('date_applied')} label="Date applied" required error={fields.error('date_applied')}>
          {(c) => <input {...c} type="date" value={dateApplied} {...bind('date_applied', setDateApplied)} className="input" />}
        </Field>
        <Field id={id('follow_up')} label="Follow up by">
          {(c) => <input {...c} type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="input" />}
        </Field>
        <Field id={id('status')} label="Status">
          {(c) => (
            <select {...c} value={status} onChange={(e) => setStatus(e.target.value as ApplicationStatus)} className="input">
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id={id('resume')} label="Resume version">
          {(c) => (
            <input {...c} maxLength={100} placeholder="For example, tech-focused" value={resume} onChange={(e) => setResume(e.target.value)} className="input" />
          )}
        </Field>
        <Field id={id('salary_min')} label="Salary min" error={fields.error('salary_min')}>
          {(c) => <input {...c} inputMode="numeric" value={salaryMin} {...bind('salary_min', setSalaryMin)} className="input figure" />}
        </Field>
        <Field id={id('salary_max')} label="Salary max" error={fields.error('salary_max')}>
          {(c) => <input {...c} inputMode="numeric" value={salaryMax} {...bind('salary_max', setSalaryMax)} className="input figure" />}
        </Field>
      </div>

      <Field id={id('notes')} label="Notes">
        {(c) => <textarea {...c} rows={4} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />}
      </Field>

      <button type="submit" disabled={saving} className="btn btn-primary">
        {saving ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}
