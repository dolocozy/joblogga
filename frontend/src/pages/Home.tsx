import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { Splash } from '../components/RouteGuards'
import { useReturnPath } from '../hooks'
import Landing from './Landing'

// "/" is the public landing page; people who are already logged in go straight to
// the app. Someone who just logged in here after being bounced from a protected
// page goes back to that page, not to the default one.
export default function Home() {
  const { user, loading } = useAuth()
  const returnPath = useReturnPath()
  if (loading) return <Splash />
  if (user) return <Navigate to={returnPath} replace />
  return <Landing />
}
