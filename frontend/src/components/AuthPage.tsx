import type { ReactNode } from 'react'
import ThemeToggle from './ThemeToggle'
import Wordmark from './Wordmark'

// Frame for the stand-alone /login and /signup pages.
export default function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mb-6">
        <Wordmark />
      </div>
      <div className="sheet w-full max-w-sm p-6">{children}</div>
    </main>
  )
}
