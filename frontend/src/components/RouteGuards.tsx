import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import { useReturnPath } from '../hooks'

export function Splash() {
  return <div className="flex min-h-screen items-center justify-center text-ink-soft">Loading…</div>
}

// Wraps pages that need a logged-in user. This is a UX convenience only: the
// real security is the backend rejecting requests without a valid token.
// Visitors are sent to the landing page (which has the login form) and returned
// to where they were headed after logging in.
export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

// Login/signup pages: send already-logged-in users to the app instead.
export function GuestRoute() {
  const { user, loading } = useAuth()
  const returnPath = useReturnPath()
  if (loading) return <Splash />
  if (user) return <Navigate to={returnPath} replace />
  return <Outlet />
}
