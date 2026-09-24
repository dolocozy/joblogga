import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth'
import Wordmark from './Wordmark'

// The current page is marked with an underline, not just a color change.
const navLink = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 pb-0.5 text-sm font-semibold ${isActive ? 'border-pine text-ink' : 'border-transparent text-ink-soft hover:text-ink'}`

// Shared page frame (header + content area) for every logged-in page.
export default function Layout() {
  const { user, logout } = useAuth()
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-6">
            <Wordmark to="/applications" />
            <nav aria-label="Main" className="flex items-center gap-5">
              <NavLink to="/applications" end className={navLink}>
                Applications
              </NavLink>
              <NavLink to="/dashboard" className={navLink}>
                Dashboard
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-ink-soft sm:inline">{user?.email}</span>
            <button onClick={logout} className="btn btn-secondary btn-sm">
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <Outlet />
      </main>
    </div>
  )
}
