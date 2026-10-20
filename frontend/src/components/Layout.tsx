import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth'
import ThemeToggle from './ThemeToggle'
import VerifyBanner from './VerifyBanner'
import Wordmark from './Wordmark'

// The header's bottom rule is the line; the current page is a filled square stop sitting on it, so the page is
// marked by a shape and a darker label, not by color alone.
function NavItem({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => `relative flex items-center py-3 text-sm font-semibold ${isActive ? 'text-ink' : 'text-ink-soft hover:text-ink'}`}>
      {({ isActive }) => (
        <>
          {children}
          {isActive && <span aria-hidden className="absolute -bottom-[5px] left-1/2 h-[9px] w-[9px] -translate-x-1/2 rounded-field bg-cobalt" />}
        </>
      )}
    </NavLink>
  )
}

// Shared page frame (header + content area) for every logged-in page.
export default function Layout() {
  const { user, logout } = useAuth()
  return (
    <div className="min-h-screen overflow-x-clip">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-5xl flex-wrap items-stretch gap-x-8 px-4 md:px-6">
          <div className="order-1 flex items-center py-3">
            <Wordmark to="/applications" />
          </div>
          <nav aria-label="Main" className="order-3 flex w-full items-stretch gap-6 md:order-2 md:w-auto">
            <NavItem to="/applications" end>Applications</NavItem>
            <NavItem to="/dashboard">Dashboard</NavItem>
            <NavItem to="/faq">FAQ</NavItem>
          </nav>
          <div className="order-2 ml-auto flex items-center gap-4 py-3 text-sm md:order-3">
            <Link to="/account" className="hidden text-ink-soft underline-offset-2 hover:text-ink hover:underline sm:inline" aria-label={`Account: ${user?.email}`}>
              {user?.email}
            </Link>
            <ThemeToggle />
            <button onClick={logout} className="btn btn-secondary btn-sm whitespace-nowrap">
              Log out
            </button>
          </div>
        </div>
      </header>
      <VerifyBanner />
      <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">
        <Outlet />
      </main>
    </div>
  )
}
