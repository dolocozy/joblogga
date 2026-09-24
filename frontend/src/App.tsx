import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth'
import Layout from './components/Layout'
import { GuestRoute, ProtectedRoute } from './components/RouteGuards'
import ApplicationDetail from './pages/ApplicationDetail'
import Applications from './pages/Applications'
import Login from './pages/Login'
import NewApplication from './pages/NewApplication'
import Signup from './pages/Signup'

// The router is supplied by the caller (BrowserRouter in main.tsx, MemoryRouter
// in tests), so the same routes can be exercised without a real browser URL.
export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<GuestRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Applications />} />
            <Route path="/applications/new" element={<NewApplication />} />
            <Route path="/applications/:id" element={<ApplicationDetail />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}
