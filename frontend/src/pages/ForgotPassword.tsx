import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { requestPasswordReset } from '../api'
import AuthPage from '../components/AuthPage'
import Field from '../components/Field'
import { useFieldErrors } from '../hooks'
import { emailRule } from '../validation'

export default function ForgotPassword() {
  const base = useId()
  const [email, setEmail] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [reply, setReply] = useState<string | null>(null) // the server's answer, once sent

  const fields = useFieldErrors({ email: emailRule(email) }, (n) => `${base}-${n}`)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!fields.validateAll()) return
    setSubmitting(true)
    try {
      setReply((await requestPasswordReset(email.trim())).detail)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  // The same screen for every address, because the server's answer is the same for every address.
  // It deliberately does not repeat the address back, which would suggest an email was sent to it.
  if (reply !== null) {
    return (
      <AuthPage>
        <div className="space-y-4">
          <h2 className="text-2xl">Check your email</h2>
          <p role="status">{reply}</p>
          <p className="text-sm text-ink-soft">It can take a minute to arrive. If it doesn&apos;t, check your spam folder.</p>
          <Link to="/login" className="link text-sm">
            Back to log in
          </Link>
        </div>
      </AuthPage>
    )
  }

  return (
    <AuthPage>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <h2 className="text-2xl">Reset your password</h2>
        <p className="text-sm text-ink-soft">Enter the email address for your account and we&apos;ll send you a link to choose a new password.</p>

        {serverError && (
          <p role="alert" className="border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick-deep">
            {serverError}
          </p>
        )}

        <Field id={`${base}-email`} label="Email" error={fields.error('email')}>
          {(control) => (
            <input
              {...control}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                fields.settle('email') // an address is invalid until it is finished: wait for a pause
              }}
              onBlur={() => fields.visit('email')}
              className="input"
            />
          )}
        </Field>

        <button type="submit" disabled={submitting} className="btn btn-primary w-full">
          {submitting ? 'Please wait…' : 'Send reset link'}
        </button>

        <p className="text-sm text-ink-soft">
          Remembered it?{' '}
          <Link to="/login" className="link">
            Log in
          </Link>
        </p>
      </form>
    </AuthPage>
  )
}
