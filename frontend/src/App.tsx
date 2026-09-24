import { useEffect, useState } from 'react'
import { fetchHealth } from './api'

type ApiState = 'checking' | 'online' | 'offline'

export default function App() {
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
    <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold text-slate-900">Joblogga</h1>
      <p className="text-slate-600">Track every application, from applied to offer.</p>
      <span className={`rounded-full px-3 py-1 text-sm font-medium ${badge}`}>
        API: {apiState}
      </span>
    </main>
  )
}
