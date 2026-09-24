import { useEffect, useState } from 'react'
import { fetchHealth } from '../api'
import { useAuth } from '../auth'

type ApiState = 'checking' | 'online' | 'offline'

// Placeholder for the real app. Proves the protected route works; the
// applications list will replace this.
export default function Home() {
  const { user, logout } = useAuth()
  const [apiState, setApiState] = useState<ApiState>('checking')

  useEffect(() => {
    fetchHealth()
      .then((h) => setApiState(h.status === 'ok' ? 'online' : 'offline'))
      .catch(() => setApiState('offline'))
  }, [])

  const badge = {
    checking: 'bg-slate-200 text-slate-700',
    online: 'bg-emerald-100 text-emerald-800',
    offline: 'bg-red-100 text-red-800',
  }[apiState]

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <span className="text-xl font-bold text-slate-900">Joblogga</span>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-600">{user?.email}</span>
            <button
              onClick={logout}
              className="rounded-lg border border-slate-300 px-3 py-1 hover:bg-slate-100"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Welcome, you're logged in.</h1>
        <p className="text-slate-600">Your applications will show up here.</p>
        <span className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${badge}`}>
          API: {apiState}
        </span>
      </main>
    </div>
  )
}
