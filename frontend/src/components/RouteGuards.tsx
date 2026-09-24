import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'

function FullPageMessage({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-500">{text}</div>
  )
}

// Wraps pages that need a logged-in user. This is a UX convenience only: the
// real security is the backend rejecting requests without a valid token.
export function ProtectedRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageMessage text="Loading…" />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

// Login/signup pages: send already-logged-in users to the app instead.
export function GuestRoute() {
  const { user, loading } = useAuth()
  if (loading) return <FullPageMessage text="Loading…" />
  if (user) return <Navigate to="/" replace />
  return <Outlet />
}
