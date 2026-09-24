import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as api from './api'
import type { User } from './api'

interface AuthContextValue {
  user: User | null
  // True until we've checked whether a saved token is still valid. Without
  // this, a logged-in user would flash the login page on every refresh.
  loading: boolean
  // True after a logged-in session ended on the server side (e.g. token expired),
  // so the login page can explain why the user is back there.
  sessionExpired: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => api.tokenStore.get() !== null)
  const [sessionExpired, setSessionExpired] = useState(false)

  // Any request that comes back 401 while logged in ends the session: dropping
  // `user` makes ProtectedRoute redirect to the login page.
  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      setUser(null)
      setSessionExpired(true)
    })
    return () => api.setUnauthorizedHandler(null)
  }, [])

  // On first load, if a token is saved, ask the server who it belongs to.
  // The server is the source of truth: an expired or invalid token gets a 401
  // and we clear it rather than trusting whatever is in localStorage.
  useEffect(() => {
    if (!api.tokenStore.get()) return
    api
      .fetchMe()
      .then(setUser)
      .catch((err) => {
        // Only discard the token if the server said it's bad. A network error
        // shouldn't log you out.
        if (err instanceof api.ApiError && err.status === 401) api.tokenStore.clear()
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const { access_token } = await api.login(email, password)
    api.tokenStore.set(access_token)
    setUser(await api.fetchMe())
    setSessionExpired(false)
  }, [])

  const signup = useCallback(
    async (email: string, password: string) => {
      await api.signup(email, password)
      await login(email, password)
    },
    [login],
  )

  const logout = useCallback(() => {
    api.tokenStore.clear()
    setUser(null)
    setSessionExpired(false)
  }, [])

  const value = useMemo(
    () => ({ user, loading, sessionExpired, login, signup, logout }),
    [user, loading, sessionExpired, login, signup, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
