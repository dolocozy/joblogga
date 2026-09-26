import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth'
import Layout from './components/Layout'
import { GuestRoute, ProtectedRoute } from './components/RouteGuards'
import Account from './pages/Account'
import ApplicationDetail from './pages/ApplicationDetail'
import Applications from './pages/Applications'
import ForgotPassword from './pages/ForgotPassword'
import Home from './pages/Home'
import Login from './pages/Login'
import NewApplication from './pages/NewApplication'
import ResetPassword from './pages/ResetPassword'
import Signup from './pages/Signup'
import VerifyEmail from './pages/VerifyEmail'

// Loaded on demand: the dashboard pulls in the charting library, which is most of
// the app's weight, so people who never open it never download it.
const Dashboard = lazy(() => import('./pages/Dashboard'))

// The router is supplied by the caller (BrowserRouter in main.tsx, MemoryRouter
// in tests), so the same routes can be exercised without a real browser URL.
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        {/* Open to everyone, logged in or not: a reset link must work whichever browser session it lands in. */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/applications" element={<Applications />} />
            <Route
              path="/dashboard"
              element={
                <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
                  <Dashboard />
                </Suspense>
              }
            />
            <Route path="/account" element={<Account />} />
            <Route path="/applications/new" element={<NewApplication />} />
            <Route path="/applications/:id" element={<ApplicationDetail />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}
