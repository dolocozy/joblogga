import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { unsubscribeReminders } from '../api'
import AuthPage from '../components/AuthPage'
import { tokenFromHash } from '../resetToken'

type Outcome = 'ask' | 'working' | 'done' | 'invalid' | 'unreachable'

// The link in a reminder email is /unsubscribe#token=... The token rides in the fragment like a reset link's, so it
// never reaches a server log. The page asks first and only then switches reminders off: mail programs sometimes
// open every link in a message to scan it, and that must not unsubscribe anyone.
export default function Unsubscribe() {
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(() => tokenFromHash(location.hash))
  const [outcome, setOutcome] = useState<Outcome>('ask')
  const [message, setMessage] = useState('')

  // Take the token out of the address bar and history right away.
  useEffect(() => {
    if (location.hash) navigate({ pathname: location.pathname, search: location.search, hash: '' }, { replace: true, state: location.state })
  }, [location.hash, location.pathname, location.search, location.state, navigate])

  async function stop() {
    if (token === null) return
    setOutcome('working')
    try {
      setMessage((await unsubscribeReminders(token)).detail)
      setOutcome('done')
    } catch (err) {
      const status = err && typeof err === 'object' && 'status' in err ? (err as { status: number }).status : 0
      setMessage(err instanceof Error ? err.message : '')
      setOutcome(status === 0 ? 'unreachable' : 'invalid')
    }
  }

  return (
    <AuthPage>
      <div className="space-y-4">
        {token === null ? (
          <>
            <h2 className="text-2xl">This link is incomplete</h2>
            <p className="text-sm text-ink-soft">The link is missing part of its address. Open it from the email again, or turn reminders off in your account.</p>
          </>
        ) : outcome === 'done' ? (
          <>
            <h2 className="text-2xl">Reminders are off</h2>
            <p role="status">{message}</p>
          </>
        ) : outcome === 'invalid' ? (
          <>
            <h2 className="text-2xl">This link did not work</h2>
            <p role="alert" className="text-sm">
              {message}
            </p>
            <p className="text-sm text-ink-soft">Log in and turn reminders off from your account instead.</p>
          </>
        ) : (
          <>
            <h2 className="text-2xl">Stop reminder emails?</h2>
            <p className="text-sm text-ink-soft">You will no longer get the daily email about follow-ups that are due. You can turn it back on in your account at any time.</p>
            {outcome === 'unreachable' && (
              <p role="alert" className="text-sm">
                {message}
              </p>
            )}
            <button type="button" onClick={stop} disabled={outcome === 'working'} className="btn btn-primary w-full">
              {outcome === 'working' ? 'Stopping…' : 'Stop reminder emails'}
            </button>
          </>
        )}
        <Link to="/account" className="link text-sm">
          Go to your account
        </Link>
      </div>
    </AuthPage>
  )
}
