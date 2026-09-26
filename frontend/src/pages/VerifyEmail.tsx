import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { verifyEmail } from '../api'
import AuthPage from '../components/AuthPage'
import { useAuth } from '../auth'
import { tokenFromHash } from '../resetToken'

type Outcome = 'checking' | 'verified' | 'bad-link' | 'incomplete' | 'unreachable'

// The link in the verification email is /verify-email#token=... Like a reset link, the
// token rides in the fragment, so it never reaches a server log or a Referer header.
export default function VerifyEmail() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()

  const [token] = useState(() => tokenFromHash(location.hash))
  const [outcome, setOutcome] = useState<Outcome>(token === null ? 'incomplete' : 'checking')
  const [message, setMessage] = useState('')
  // A link works once. React's development mode runs effects twice; without this the
  // second request would find the token spent and report a good link as bad.
  const started = useRef(false)

  // Take the token out of the address bar and history right away.
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true, state: location.state })
  }, [location.hash, location.pathname, location.search, location.state, navigate])

  useEffect(() => {
    if (token === null || started.current) return
    started.current = true
    verifyEmail(token)
      .then(async () => {
        setOutcome('verified')
        await refreshUser().catch(() => {}) // if they are logged in here, the banner goes away
      })
      .catch((err) => {
        const status = err && typeof err === 'object' && 'status' in err ? (err as { status: number }).status : 0
        setMessage(err instanceof Error ? err.message : '')
        setOutcome(status === 0 ? 'unreachable' : 'bad-link')
      })
  }, [token, refreshUser])

  return (
    <AuthPage>
      <div className="space-y-4">
        {outcome === 'checking' && (
          <>
            <h2 className="text-2xl">Verifying your email</h2>
            <p role="status" className="text-ink-soft">
              One moment…
            </p>
          </>
        )}
        {outcome === 'verified' && (
          <>
            <h2 className="text-2xl">Email verified</h2>
            <p role="status">Thanks. Your email address is confirmed.</p>
            <Link to={user ? '/applications' : '/login'} className="btn btn-primary w-full">
              {user ? 'Go to your applications' : 'Log in'}
            </Link>
          </>
        )}
        {outcome === 'bad-link' && (
          <>
            <h2 className="text-2xl">This link didn&apos;t work</h2>
            <p role="alert" className="text-sm">
              {message || 'This verification link is invalid or has expired.'}
            </p>
            <p className="text-sm text-ink-soft">Log in and use the banner at the top of the app to send yourself a new one.</p>
            <Link to={user ? '/applications' : '/login'} className="link text-sm">
              {user ? 'Go to your applications' : 'Log in'}
            </Link>
          </>
        )}
        {outcome === 'unreachable' && (
          <>
            <h2 className="text-2xl">Could not reach the server</h2>
            <p role="alert" className="text-sm">
              {message}
            </p>
            <p className="text-sm text-ink-soft">Your link has not been used up. Open it from your email again in a moment.</p>
          </>
        )}
        {outcome === 'incomplete' && (
          <>
            <h2 className="text-2xl">This link is incomplete</h2>
            <p className="text-sm text-ink-soft">The link is missing part of its address. Open it from your email again.</p>
            <Link to="/login" className="link text-sm">
              Log in
            </Link>
          </>
        )}
      </div>
    </AuthPage>
  )
}
