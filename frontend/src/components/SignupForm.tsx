import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { useFieldErrors, useSlowAfter } from '../hooks'
import { emailRequiredRule, newPasswordRule } from '../validation'
import Field from './Field'

export default function SignupForm() {
  const { signup } = useAuth()
  const navigate = useNavigate()

  const base = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const slow = useSlowAfter(submitting)

  const fields = useFieldErrors({ email: emailRequiredRule(email), password: newPasswordRule(password) }, (n) => `${base}-${n}`)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!fields.validateAll()) return
    setSubmitting(true)
    try {
      await signup(email.trim(), password)
      navigate('/applications', { replace: true })
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <h2 className="text-2xl">Create your account</h2>

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

      {/* The rule is shown up front as a hint, and becomes the error message
          (with a running count) as soon as the password breaks it. */}
      <Field id={`${base}-password`} label="Password" hint="At least 8 characters." error={fields.error('password')}>
        {(control) => (
          <input
            {...control}
            type="password"
            autoComplete="new-password"
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
        {submitting ? 'Please wait…' : 'Sign up'}
      </button>

      <p className="text-sm text-ink-soft">
        Already have an account?{' '}
        <Link to="/login" className="link">
          Log in
        </Link>
      </p>
    </form>
  )
}
