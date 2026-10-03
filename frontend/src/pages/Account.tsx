import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { exportApplicationsCsv, importApplications } from '../api'
import type { ImportResult } from '../api'
import { useAuth } from '../auth'
import Field from '../components/Field'
import ImportSummary from '../components/ImportSummary'
import { localToday } from '../dates'
import { saveFile } from '../download'
import { useFieldErrors } from '../hooks'
import { loginPasswordRule } from '../validation'

export default function Account() {
  const { user, deleteAccount, setReminderEmails } = useAuth()
  const base = useId()

  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const [savingReminders, setSavingReminders] = useState(false)
  const [remindersError, setRemindersError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [imported, setImported] = useState<ImportResult | null>(null)

  const fields = useFieldErrors({ password: loginPasswordRule(password) }, (n) => `${base}-${n}`)

  async function exportCsv() {
    setExporting(true)
    setExportError(null)
    try {
      saveFile(await exportApplicationsCsv(), `joblogga-applications-${localToday()}.csv`)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Could not export')
    } finally {
      setExporting(false)
    }
  }

  async function toggleReminders(on: boolean) {
    setSavingReminders(true)
    setRemindersError(null)
    try {
      await setReminderEmails(on)
    } catch (err) {
      setRemindersError(err instanceof Error ? err.message : 'Could not change that setting')
    } finally {
      setSavingReminders(false)
    }
  }

  async function runImport(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setImporting(true)
    setImportError(null)
    setImported(null)
    try {
      setImported(await importApplications(file, skipDuplicates))
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Could not import that file')
    } finally {
      setImporting(false)
    }
  }

  function cancel() {
    setConfirming(false)
    setPassword('')
    setServerError(null)
  }

  async function handleDelete(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!fields.validateAll()) return
    setDeleting(true)
    try {
      // On success the session ends and the app returns to the login page (see AuthProvider).
      await deleteAccount(password)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-xl space-y-10">
      <h1 className="text-3xl">Account</h1>

      <section aria-labelledby={`${base}-you`} className="space-y-1">
        <h2 id={`${base}-you`} className="text-xl">
          Signed in as
        </h2>
        <p className="break-all">{user?.email}</p>
        <p className="text-sm text-ink-soft">{user?.email_verified ? 'Email address verified.' : 'Email address not verified yet.'}</p>
      </section>

      <section aria-labelledby={`${base}-reminders`} id="reminders" className="space-y-3">
        <h2 id={`${base}-reminders`} className="text-xl">
          Email reminders
        </h2>
        <p className="text-sm text-ink-soft">
          Get one email a day, around 13:00 UTC, listing your open applications whose follow-up date is today or has passed. It is only sent when something is
          due, it keeps coming each day until you change that date or close the application, and archived and closed applications are left out.
        </p>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={user?.reminder_emails ?? false}
            disabled={savingReminders}
            onChange={(e) => toggleReminders(e.target.checked)}
            className="mt-1"
          />
          <span className="font-semibold">Email me when follow-ups are due</span>
        </label>
        <p role="status" className="text-sm">
          {user?.reminder_emails ? 'Reminders are on.' : 'Reminders are off. Nothing is sent unless you turn them on.'}
        </p>
        {user?.reminder_emails && !user.email_verified && (
          <p className="border-l-2 border-marker bg-marker/20 px-3 py-2 text-sm">
            Your email address is not verified yet, so no reminders will be sent until it is. Use the link in the verification email, or the banner at the top of the page to send it again.
          </p>
        )}
        {remindersError && (
          <p role="alert" className="text-sm text-brick">
            {remindersError}
          </p>
        )}
      </section>

      <section aria-labelledby={`${base}-data`} className="space-y-3">
        <h2 id={`${base}-data`} className="text-xl">
          Your data
        </h2>
        <p className="text-sm text-ink-soft">Download everything in your logbook as a spreadsheet file.</p>
        <button type="button" onClick={exportCsv} disabled={exporting} className="btn btn-secondary">
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
        {exportError && (
          <p role="alert" className="text-sm text-brick">
            {exportError}
          </p>
        )}
      </section>

      <section aria-labelledby={`${base}-import`} className="space-y-3">
        <h2 id={`${base}-import`} className="text-xl">
          Import from a CSV
        </h2>
        <p className="text-sm text-ink-soft">
          Add applications from a spreadsheet saved as CSV. A file exported from Joblogga imports back as it was. Any file needs a Company and a Role
          column; everything else is optional, and dates should be written YYYY-MM-DD. Rows that cannot be imported are skipped and listed, never silently dropped.
        </p>
        <form onSubmit={runImport} className="space-y-3">
          <Field id={`${base}-file`} label="CSV file">
            {(c) => (
              <input
                {...c}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null)
                  setImported(null)
                  setImportError(null)
                }}
                className="block w-full text-sm file:mr-3 file:rounded-button file:border file:border-ink file:bg-transparent file:px-3 file:py-1 file:text-sm file:font-semibold"
              />
            )}
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} className="mt-1" />
            <span>Skip rows that match an application I already have (same company and role). Recommended: importing the same file twice then adds nothing.</span>
          </label>
          <button type="submit" disabled={!file || importing} className="btn btn-secondary">
            {importing ? 'Importing…' : 'Import'}
          </button>
        </form>
        {importError && (
          <p role="alert" className="border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick-deep">
            {importError}
          </p>
        )}
        {imported && <ImportSummary result={imported} />}
      </section>

      <section aria-labelledby={`${base}-delete`} className="space-y-3 border-t border-rule pt-8">
        <h2 id={`${base}-delete`} className="text-xl">
          Delete account
        </h2>
        <p className="text-sm text-ink-soft">
          Permanently removes your account, every application, and its status history. There is no undo and we keep no copy. You may want to export your data first.
        </p>

        {!confirming ? (
          <button type="button" onClick={() => setConfirming(true)} className="btn btn-secondary">
            Delete my account…
          </button>
        ) : (
          <form onSubmit={handleDelete} noValidate role="group" aria-label="Confirm account deletion" className="sheet space-y-4 border-l-2 border-l-brick p-4">
            <p className="font-semibold">This will delete {user?.email} and everything in it, for good.</p>

            {serverError && (
              <p role="alert" className="border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick-deep">
                {serverError}
              </p>
            )}

            <Field id={`${base}-password`} label="Enter your password to confirm" error={fields.error('password')}>
              {(control) => (
                <input
                  {...control}
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    fields.visit('password')
                  }}
                  onBlur={() => fields.visit('password')}
                  className="input"
                />
              )}
            </Field>

            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={deleting} className="btn btn-destructive">
                {deleting ? 'Deleting…' : 'Permanently delete my account'}
              </button>
              <button type="button" onClick={cancel} disabled={deleting} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
