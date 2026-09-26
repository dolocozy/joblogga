import { useState } from 'react'
import { resendVerification } from '../api'
import { useAuth } from '../auth'

// Shown above every logged-in page until the address is verified. Unverified people can
// use the whole app: the email is only used to reset a password, so the cost of not
// verifying is a reset link that may not reach them, and a banner says exactly that.
export default function VerifyBanner() {
  const { user } = useAuth()
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'sent' | 'error'; text?: string }>({ kind: 'idle' })

  if (!user || user.email_verified) return null

  async function resend() {
    setState({ kind: 'sending' })
    try {
      const { detail } = await resendVerification()
      setState({ kind: 'sent', text: detail })
    } catch (err) {
      setState({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong' })
    }
  }

  return (
    <div className="border-b border-rule bg-marker/25">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm md:px-6">
        <p className="min-w-0">
          Please verify your email address. We sent a link to <strong className="break-all">{user.email}</strong>. Without it, a password reset may not
          reach you.
        </p>
        {state.kind === 'sent' ? (
          <p role="status">{state.text}</p>
        ) : (
          <button onClick={resend} disabled={state.kind === 'sending'} className="link whitespace-nowrap font-semibold disabled:opacity-60">
            {state.kind === 'sending' ? 'Sending…' : 'Resend email'}
          </button>
        )}
        {state.kind === 'error' && (
          <p role="alert" className="text-brick-deep">
            {state.text}
          </p>
        )}
      </div>
    </div>
  )
}
