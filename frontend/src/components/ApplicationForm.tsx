import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchTags, findDuplicates, STATUSES, WORK_MODES } from '../api'
import type { ApplicationInput, ApplicationStatus, DuplicateMatch, WorkMode } from '../api'
import { blankApplication } from '../applicationDefaults'
import { localToday } from '../dates'
import { useFieldErrors } from '../hooks'
import { statusLabel } from '../status'
import { workModeLabel } from '../workMode'
import { duplicateKey } from '../duplicates'
import { showsRoundFields } from '../rounds'
import { httpUrlRule, required, roundRule, wholeNumberRule } from '../validation'
import DuplicateWarning from './DuplicateWarning'
import Field from './Field'
import PlacePicker from './PlacePicker'
import TagsInput from './TagsInput'
import type { InitialPlace, PlaceValue } from './PlacePicker'

interface Props {
  initial?: ApplicationInput
  // The names behind the ids in `initial` (which country and city), for showing them. Blank for a new application.
  initialPlace?: InitialPlace
  submitLabel: string
  // Set when editing: the application's own id, so it never counts as a duplicate of itself.
  editingId?: number
  onSubmit: (input: ApplicationInput) => Promise<void>
}

// Inputs work with strings; the API wants null for "empty" and numbers for salary.
const orNull = (v: string) => (v.trim() === '' ? null : v.trim())
const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

export default function ApplicationForm({ initial = blankApplication(), initialPlace, submitLabel, editingId, onSubmit }: Props) {
  const base = useId()
  const id = (name: string) => `${base}-${name}`

  const [company, setCompany] = useState(initial.company)
  const [role, setRole] = useState(initial.role)
  const [jobUrl, setJobUrl] = useState(initial.job_url ?? '')
  const [dateApplied, setDateApplied] = useState(initial.date_applied ?? '')
  const [resume, setResume] = useState(initial.resume_version ?? '')
  const [salaryMin, setSalaryMin] = useState(initial.salary_min?.toString() ?? '')
  const [salaryMax, setSalaryMax] = useState(initial.salary_max?.toString() ?? '')
  // The picker reports what to send; until it does, what the application already has.
  const [place, setPlace] = useState<PlaceValue>({ country_id: initial.country_id, city_id: initial.city_id, location: initial.location })
  const [workMode, setWorkMode] = useState<WorkMode | ''>(initial.work_mode ?? '')
  const [tags, setTags] = useState<string[]>(initial.tags)
  // Tags used before, offered as suggestions. A courtesy: if they cannot be fetched, typing a tag still works.
  const [knownTags, setKnownTags] = useState<string[]>([])
  useEffect(() => {
    fetchTags()
      .then((list) => setKnownTags(list.map((t) => t.tag)))
      .catch(() => {})
  }, [])
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [round, setRound] = useState(initial.interview_round?.toString() ?? '')
  const [roundsTotal, setRoundsTotal] = useState(initial.interview_rounds_total?.toString() ?? '')
  const [status, setStatus] = useState<ApplicationStatus>(initial.status)
  const [followUp, setFollowUp] = useState(initial.follow_up_date ?? '')
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Existing applications with this company and role, once found. Shown as a warning; never blocks the save.
  const [duplicates, setDuplicates] = useState<DuplicateMatch[] | null>(null)
  const [checking, setChecking] = useState(false)
  // The company and role the person has already said "anyway" to, so they are not asked twice.
  const [confirmedKey, setConfirmedKey] = useState<string | null>(null)

  // The max is checked against the min only once each is a valid number by itself.
  const salaryMaxError =
    wholeNumberRule(salaryMax) ??
    (salaryMin.trim() && salaryMax.trim() && !wholeNumberRule(salaryMin) && Number(salaryMax) < Number(salaryMin)
      ? 'Max salary cannot be lower than min salary'
      : null)

  // The total may not be below the round, checked once each is a valid number by itself.
  const roundsTotalError =
    roundRule(roundsTotal) ??
    (round.trim() && roundsTotal.trim() && !roundRule(round) && Number(round) > Number(roundsTotal) ? 'The total cannot be lower than the round' : null)

  // Listed in form order, which is the order focus moves to on a failed submit.
  const fields = useFieldErrors(
    {
      company: required('Enter the company name')(company),
      role: required('Enter the role')(role),
      job_url: httpUrlRule(jobUrl),
      // A saved job has no applied date yet, so none is asked for.
      date_applied: status === 'saved' ? null : required('Enter the date you applied')(dateApplied),
      salary_min: wholeNumberRule(salaryMin),
      salary_max: salaryMaxError,
      interview_round: roundRule(round),
      interview_rounds_total: roundsTotalError,
    },
    id,
  )

  // Fields whose value is wrong until it is finished: the link ("h" is not a URL yet)
  // and the salaries (a max of "1" is below a min of 90000 while "100000" is being typed).
  const SETTLED = new Set(['job_url', 'salary_min', 'salary_max', 'interview_round', 'interview_rounds_total'])

  // Wires a text control to its state, revealing its error once it's been used.
  const bind = (name: 'company' | 'role' | 'job_url' | 'date_applied' | 'salary_min' | 'salary_max' | 'interview_round' | 'interview_rounds_total', set: (v: string) => void) => ({
    onChange: (e: { target: { value: string } }) => {
      set(e.target.value)
      const reveal = SETTLED.has(name) ? fields.settle : fields.visit
      reveal(name)
      // Min and max are checked against each other, so editing one revisits the other.
      if (name === 'salary_min') fields.settle('salary_max')
      if (name === 'interview_round') fields.settle('interview_rounds_total')
    },
    onBlur: () => fields.visit(name),
  })

  // Leaving Saved means the job has now been applied to: offer today's date rather than an empty box.
  function changeStatus(next: ApplicationStatus) {
    setStatus(next)
    if (next !== 'saved' && dateApplied === '') setDateApplied(localToday())
  }

  // Editing only asks again if the company or role was actually changed: saving notes on an application that
  // legitimately has a twin should not nag every time.
  const currentKey = duplicateKey(company, role)
  const changedFromSaved = editingId === undefined || currentKey !== duplicateKey(initial.company, initial.role)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!fields.validateAll()) return
    if (changedFromSaved && confirmedKey !== currentKey) {
      setChecking(true)
      try {
        const found = await findDuplicates(company.trim(), role.trim(), editingId)
        if (found.length > 0) {
          setDuplicates(found)
          return
        }
      } catch {
        // The check is a courtesy: if it cannot be made, saving goes ahead rather than being held up by it.
      } finally {
        setChecking(false)
      }
    }
    await save()
  }

  async function save() {
    setSaving(true)
    try {
      await onSubmit({
        company: company.trim(),
        role: role.trim(),
        job_url: orNull(jobUrl),
        date_applied: dateApplied || null,
        resume_version: orNull(resume),
        salary_min: numOrNull(salaryMin),
        salary_max: numOrNull(salaryMax),
        ...place,
        work_mode: workMode || null,
        tags,
        notes: orNull(notes),
        interview_round: numOrNull(round),
        interview_rounds_total: numOrNull(roundsTotal),
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
          {(c) => <input {...c} maxLength={200} value={company} {...bind('company', (v) => (setDuplicates(null), setCompany(v)))} className="input" />}
        </Field>
        <Field id={id('role')} label="Role" required error={fields.error('role')}>
          {(c) => <input {...c} maxLength={200} value={role} {...bind('role', (v) => (setDuplicates(null), setRole(v)))} className="input" />}
        </Field>
        <div className="sm:col-span-2">
          <Field id={id('job_url')} label="Job posting link" error={fields.error('job_url')}>
            {(c) => <input {...c} type="url" placeholder="https://" value={jobUrl} {...bind('job_url', setJobUrl)} className="input" />}
          </Field>
        </div>
        <PlacePicker idBase={id('place')} initial={initialPlace ?? { country: null, city: null, location: initial.location }} onChange={setPlace} />
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
        {status !== 'saved' && (
          <Field id={id('date_applied')} label="Date applied" required error={fields.error('date_applied')}>
            {(c) => <input {...c} type="date" value={dateApplied} {...bind('date_applied', setDateApplied)} className="input" />}
          </Field>
        )}
        <Field id={id('follow_up')} label="Follow up by">
          {(c) => <input {...c} type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="input" />}
        </Field>
        <Field id={id('status')} label="Status">
          {(c) => (
            <select {...c} value={status} onChange={(e) => changeStatus(e.target.value as ApplicationStatus)} className="input">
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
        {showsRoundFields(status, round.trim() !== '' || roundsTotal.trim() !== '') && (
          <>
            <Field id={id('interview_round')} label="Interview round" hint="Which round you are in." error={fields.error('interview_round')}>
              {(c) => <input {...c} inputMode="numeric" value={round} {...bind('interview_round', setRound)} className="input figure" />}
            </Field>
            <Field id={id('interview_rounds_total')} label="Total rounds" hint="If you know how many." error={fields.error('interview_rounds_total')}>
              {(c) => <input {...c} inputMode="numeric" value={roundsTotal} {...bind('interview_rounds_total', setRoundsTotal)} className="input figure" />}
            </Field>
          </>
        )}
      </div>

      <Field id={id('tags')} label="Tags" hint="Your own labels, like referral or dream job. Press Enter or a comma to add one.">
        {(c) => <TagsInput control={c} value={tags} onChange={setTags} suggestions={knownTags} />}
      </Field>

      <Field id={id('notes')} label="Notes">
        {(c) => <textarea {...c} rows={4} maxLength={10000} value={notes} onChange={(e) => setNotes(e.target.value)} className="input" />}
      </Field>

      {duplicates && (
        <DuplicateWarning
          matches={duplicates}
          confirmLabel={editingId === undefined ? 'Add anyway' : 'Save anyway'}
          busy={saving}
          onConfirm={() => {
            setConfirmedKey(currentKey)
            setDuplicates(null)
            void save()
          }}
          onDismiss={() => setDuplicates(null)}
        />
      )}

      {!duplicates && (
        <button type="submit" disabled={saving || checking} className="btn btn-primary">
          {saving ? 'Saving…' : checking ? 'Checking…' : submitLabel}
        </button>
      )}
    </form>
  )
}
