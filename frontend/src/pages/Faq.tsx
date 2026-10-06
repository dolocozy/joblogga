import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { FAQS } from '../faq'
import SiteFooter from '../components/SiteFooter'
import ThemeToggle from '../components/ThemeToggle'
import Wordmark from '../components/Wordmark'

// A public page, in the same frame as the landing page: the wordmark, a Theme button, the shared footer.
export default function Faq() {
  const { user } = useAuth()
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-8">
        <Wordmark />
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user ? (
            <Link to="/applications" className="btn btn-secondary btn-sm">
              Your applications
            </Link>
          ) : (
            <Link to="/login" className="btn btn-secondary btn-sm">
              Log in
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-8">
        <div className="max-w-2xl">
          <h1 className="text-4xl">Frequently asked questions</h1>
          <div className="mt-8 border-b border-rule">
            {FAQS.map(({ question, answer }) => (
              <details key={question} className="border-t border-rule py-4">
                <summary className="cursor-pointer font-semibold">{question}</summary>
                <p className="mt-3 text-ink-soft">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
