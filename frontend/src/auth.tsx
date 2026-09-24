import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as api from './api'
import type { User } from './api'

interface AuthContextValue {
  user: User | null
  // True until we've checked whether a saved token is still valid. Without
  // this, a logged-in user would flash the login page on every refresh.
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => api.tokenStore.get() !== null)

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
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, signup, logout }),
    [user, loading, login, signup, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
