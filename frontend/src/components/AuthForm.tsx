import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

interface Props {
  title: string
  submitLabel: string
  onSubmit: (email: string, password: string) => Promise<void>
  footerText: string
  footerLinkText: string
  footerLinkTo: string
  passwordAutoComplete: 'current-password' | 'new-password'
  notice?: string // neutral info shown above the form, e.g. "session expired"
}

export default function AuthForm(props: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await props.onSubmit(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setSubmitting(false)
    }
    // On success the route guard navigates away, so no need to reset `submitting`.
  }

  const input =
    'w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500'

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4">
      <h1 className="text-3xl font-bold text-slate-900 mb-6">Joblogga</h1>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4"
      >
        <h2 className="text-xl font-semibold text-slate-900">{props.title}</h2>

        {props.notice && !error && (
          <p role="status" className="rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">
            {props.notice}
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 text-red-700 text-sm px-3 py-2">
            {error}
          </p>
        )}

        <label className="block text-sm font-medium text-slate-700">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${input} mt-1`}
          />
        </label>

        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete={props.passwordAutoComplete}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${input} mt-1`}
          />
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-indigo-600 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting ? 'Please wait…' : props.submitLabel}
        </button>

        <p className="text-sm text-slate-600 text-center">
          {props.footerText}{' '}
          <Link to={props.footerLinkTo} className="text-indigo-600 hover:underline">
            {props.footerLinkText}
          </Link>
        </p>
      </form>
    </main>
  )
}
