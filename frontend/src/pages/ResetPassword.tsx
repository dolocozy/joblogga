import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, confirmPasswordReset } from '../api'
import AuthPage from '../components/AuthPage'
import Field from '../components/Field'
import { useFieldErrors } from '../hooks'
import { tokenFromHash } from '../resetToken'
import { matches, newPasswordRule } from '../validation'

export default function ResetPassword() {
  const location = useLocation()
  const navigate = useNavigate()
  const base = useId()

  // Read the token once, into memory...
  const [token] = useState(() => tokenFromHash(location.hash))
  // ...then take it out of the address bar and the history entry, so it can't be
  // bookmarked, shared by accident, or seen over someone's shoulder afterwards.
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true, state: location.state })
  }, [location.hash, location.pathname, location.search, location.state, navigate])

  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [linkIsBad, setLinkIsBad] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const fields = useFieldErrors({ password: newPasswordRule(password), again: matches(password)(again) }, (n) => `${base}-${n}`)

  if (token === null) {
    return (
      <AuthPage>
        <div className="space-y-4">
          <h2 className="text-2xl">This link is incomplete</h2>
          <p className="text-sm text-ink-soft">
            The reset link is missing part of its address. Open the link from your email again, or ask for a new one.
          </p>
          <Link to="/forgot-password" className="link text-sm">
            Request a new link
          </Link>
        </div>
      </AuthPage>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    setLinkIsBad(false)
    if (!fields.validateAll()) return
    setSubmitting(true)
    try {
      await confirmPasswordReset(token!, password)
      // Not logged in automatically: they choose to log in with the new password.
      navigate('/login', { replace: true, state: { notice: 'Your password has been updated. Log in with your new password.' } })
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setLinkIsBad(err instanceof ApiError && err.status === 400) // the server says the link is bad, expired or used
      setSubmitting(false)
    }
  }

  return (
    <AuthPage>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <h2 className="text-2xl">Choose a new password</h2>

        {serverError && (
          <div role="alert" className="border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick-deep">
            <p>{serverError}</p>
            {linkIsBad && (
              <Link to="/forgot-password" className="link mt-1 inline-block">
                Request a new link
              </Link>
            )}
          </div>
        )}

        <Field id={`${base}-password`} label="New password" hint="At least 8 characters." error={fields.error('password')}>
          {(control) => (
            <input
              {...control}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                fields.visit('password') // a running count the person wants to watch
                if (again) fields.settle('again') // a changed password can newly (mis)match the repeat
              }}
              onBlur={() => fields.visit('password')}
              className="input"
            />
          )}
        </Field>

        <Field id={`${base}-again`} label="Repeat new password" error={fields.error('again')}>
          {(control) => (
            <input
              {...control}
              type="password"
              autoComplete="new-password"
              value={again}
              onChange={(e) => {
                setAgain(e.target.value)
                fields.settle('again') // "ab" doesn't match "abcdef" yet: wait for a pause
              }}
              onBlur={() => fields.visit('again')}
              className="input"
            />
          )}
        </Field>

        <button type="submit" disabled={submitting} className="btn btn-primary w-full">
          {submitting ? 'Please wait…' : 'Update password'}
        </button>
      </form>
    </AuthPage>
  )
}
