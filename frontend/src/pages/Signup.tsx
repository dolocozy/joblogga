import { useNavigate } from 'react-router-dom'
import AuthForm from '../components/AuthForm'
import { useAuth } from '../auth'

export default function Signup() {
  const { signup } = useAuth()
  const navigate = useNavigate()

  return (
    <AuthForm
      title="Create your account"
      submitLabel="Sign up"
      passwordAutoComplete="new-password"
      onSubmit={async (email, password) => {
        await signup(email, password)
        navigate('/', { replace: true })
      }}
      footerText="Already have an account?"
      footerLinkText="Log in"
      footerLinkTo="/login"
    />
  )
}
