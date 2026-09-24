// Base URL of the FastAPI backend. Vite exposes env vars prefixed with VITE_
// to browser code; in production this points at the deployed API.
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

const TOKEN_KEY = 'joblogga_token'

// The JWT lives in localStorage so a page refresh doesn't log you out.
// Trade-off: any script running on the page can read it (XSS), whereas an
// httpOnly cookie can't be read by JS but needs CSRF protection and a
// same-site setup. For this app localStorage is the simpler, common choice.
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

// AuthProvider registers this so an expired session can be handled in one place
// instead of every page having to notice 401s itself.
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// FastAPI returns `detail` as a string for our own errors, or as a list of
// field problems for validation errors (422). Flatten both into one message.
function errorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((d: { msg?: string }) => (d.msg ?? '').replace(/^Value error, /, ''))
      .filter(Boolean)
      .join('. ')
  }
  return fallback
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('Content-Type', 'application/json')
  const token = tokenStore.get()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Is the backend running?')
  }

  if (!res.ok) {
    // A 401 on a request that carried a token means the session is over (expired
    // or revoked). Wrong-password 401s from the login form don't count: those are
    // an ordinary error to show next to the form.
    if (res.status === 401 && token && !path.startsWith('/auth/login')) {
      tokenStore.clear()
      onUnauthorized?.()
    }
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, errorMessage(body?.detail, `Request failed (${res.status})`))
  }
  // 204 No Content (e.g. after DELETE) has no body to parse.
  if (res.status === 204) return undefined as T
  return res.json()
}

export interface HealthResponse {
  status: string
}

export interface User {
  id: number
  email: string
  created_at: string
}

export const fetchHealth = () => request<HealthResponse>('/health')

export const signup = (email: string, password: string) =>
  request<User>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) })

export const login = (email: string, password: string) =>
  request<{ access_token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

export const fetchMe = () => request<User>('/auth/me')

// --- applications -----------------------------------------------------------

export const STATUSES = ['applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn'] as const
export type ApplicationStatus = (typeof STATUSES)[number]

export interface Application {
  id: number
  company: string
  role: string
  job_url: string | null
  date_applied: string // YYYY-MM-DD
  resume_version: string | null
  salary_min: number | null
  salary_max: number | null
  location: string | null
  notes: string | null
  status: ApplicationStatus
  follow_up_date: string | null // YYYY-MM-DD
  created_at: string
  updated_at: string
}

export interface StatusChange {
  id: number
  from_status: ApplicationStatus | null
  to_status: ApplicationStatus
  changed_at: string
}

export interface ApplicationDetail extends Application {
  history: StatusChange[]
}

// What the form sends. Optional fields are null when left blank.
export interface ApplicationInput {
  company: string
  role: string
  job_url: string | null
  date_applied: string
  resume_version: string | null
  salary_min: number | null
  salary_max: number | null
  location: string | null
  notes: string | null
  status: ApplicationStatus
  follow_up_date: string | null
}

export interface ApplicationFilters {
  q?: string
  company?: string
  status?: ApplicationStatus
  date_from?: string // YYYY-MM-DD
  date_to?: string
  limit?: number
  offset?: number
}

export function listApplications(filters: ApplicationFilters = {}) {
  const params = new URLSearchParams()
  // Skip unset/empty values so the URL only carries filters actually in use.
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return request<{ items: Application[]; total: number }>(`/applications${qs ? `?${qs}` : ''}`)
}

export const fetchUpcoming = () => request<Application[]>('/applications/upcoming')

export const getApplication = (id: number) => request<ApplicationDetail>(`/applications/${id}`)

export const createApplication = (input: ApplicationInput) =>
  request<ApplicationDetail>('/applications', { method: 'POST', body: JSON.stringify(input) })

// PATCH: send only the fields to change (the form sends all of them; the
// quick status dropdown on the list sends just `status`).
export const updateApplication = (id: number, input: Partial<ApplicationInput>) =>
  request<ApplicationDetail>(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(input) })

export const deleteApplication = (id: number) =>
  request<void>(`/applications/${id}`, { method: 'DELETE' })
