import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { useFieldErrors, useSlowAfter } from '../hooks'
import { emailRule, loginPasswordRule } from '../validation'
import Field from './Field'

// Used on the landing page and on /login.
export default function LoginForm() {
  const { login, sessionExpired } = useAuth()
  const base = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const slow = useSlowAfter(submitting)

  const fields = useFieldErrors({ email: emailRule(email), password: loginPasswordRule(password) }, (n) => `${base}-${n}`)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!fields.validateAll()) return
    setSubmitting(true)
    try {
      // No navigation here: logging in sets the user, and the route this form
      // lives on (landing page or /login) then redirects to the right place.
      await login(email.trim(), password)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    // noValidate turns off the browser's own validation popups; the messages
    // under each field replace them.
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <h2 className="text-2xl">Log in</h2>

      {sessionExpired && !serverError && (
        <p role="status" className="border-l-2 border-marker bg-marker/20 px-3 py-2 text-sm">
          Your session has expired. Please log in again.
        </p>
      )}
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

      <Field id={`${base}-password`} label="Password" error={fields.error('password')}>
        {(control) => (
          <input
            {...control}
            type="password"
            autoComplete="current-password"
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

      {slow && (
        <p role="status" className="text-sm text-ink-soft">
          Waking the server. The first request after a quiet spell can take up to a minute.
        </p>
      )}

      <button type="submit" disabled={submitting} className="btn btn-primary w-full">
        {submitting ? 'Please wait…' : 'Log in'}
      </button>

      <p className="text-sm text-ink-soft">
        New here?{' '}
        <Link to="/signup" className="link">
          Create an account
        </Link>
      </p>
    </form>
  )
}
