import { useLocation, useNavigate } from 'react-router-dom'
import AuthForm from '../components/AuthForm'
import { useAuth } from '../auth'

export default function Login() {
  const { login, sessionExpired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // If a protected page bounced us here, return to it after logging in.
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  return (
    <AuthForm
      title="Log in"
      submitLabel="Log in"
      passwordAutoComplete="current-password"
      notice={sessionExpired ? 'Your session has expired. Please log in again.' : undefined}
      onSubmit={async (email, password) => {
        await login(email, password)
        navigate(from, { replace: true })
      }}
      footerText="New here?"
      footerLinkText="Create an account"
      footerLinkTo="/signup"
    />
  )
}
