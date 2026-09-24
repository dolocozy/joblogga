import type { ReactNode } from 'react'
import Wordmark from './Wordmark'

// Frame for the stand-alone /login and /signup pages.
export default function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6">
        <Wordmark />
      </div>
      <div className="sheet w-full max-w-sm p-6">{children}</div>
    </main>
  )
}
