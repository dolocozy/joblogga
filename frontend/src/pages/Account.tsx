import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { exportApplicationsCsv } from '../api'
import { useAuth } from '../auth'
import Field from '../components/Field'
import { localToday } from '../dates'
import { saveFile } from '../download'
import { useFieldErrors } from '../hooks'
import { loginPasswordRule } from '../validation'

export default function Account() {
  const { user, deleteAccount } = useAuth()
  const base = useId()

  const [confirming, setConfirming] = useState(false)
  const [password, setPassword] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

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
