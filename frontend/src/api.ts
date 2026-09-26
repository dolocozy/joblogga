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

// Sends a request with the saved token attached and turns failures into ApiErrors.
// Everything that talks to the API goes through here, so an expired session is
// handled in one place. Returns the raw response for the caller to read.
async function send(path: string, options: RequestInit = {}): Promise<Response> {
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
  return res
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await send(path, options)
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
  // False until the owner opens the link we emailed. Only a banner depends on it.
  email_verified: boolean
}

export const fetchHealth = () => request<HealthResponse>('/health')

// The free hosting tier puts the API to sleep when idle and takes up to a minute
// to wake it. Calling this as soon as the landing page opens starts that wake-up
// while the visitor is still reading, so login is quick by the time they use it.
// Failures are ignored: it is only a nudge.
export function warmUpServer() {
  fetchHealth().catch(() => {})
}

// Signup answers the same way for every address and does not log anyone in: the account
// is created behind the scenes and a verification link is emailed. The person logs in after.
export const signup = (email: string, password: string) =>
  request<{ detail: string }>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) })

export const verifyEmail = (token: string) =>
  request<{ detail: string }>('/auth/verify-email/confirm', { method: 'POST', body: JSON.stringify({ token }) })

export const resendVerification = () => request<{ detail: string }>('/auth/verify-email/resend', { method: 'POST' })

export const login = (email: string, password: string) =>
  request<{ access_token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

export const fetchMe = () => request<User>('/auth/me')

// Permanent. The password is asked for again so a borrowed session is not enough.
export const deleteAccount = (password: string) =>
  request<void>('/auth/delete-account', { method: 'POST', body: JSON.stringify({ password }) })

// Password reset. The server answers a reset request the same way whether or not the
// address has an account, and so does this app: it never says which.
export const requestPasswordReset = (email: string) =>
  request<{ detail: string }>('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) })

export const confirmPasswordReset = (token: string, password: string) =>
  request<{ detail: string }>('/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify({ token, password }) })

// --- applications -----------------------------------------------------------

// In pipeline order. Offer accepted / Offer declined are the two endings that follow an offer
// (declining is your decision, not a rejection); Rejected and Withdrawn end an application earlier.
export const STATUSES = ['applied', 'screening', 'interview', 'offer', 'offer_accepted', 'offer_declined', 'rejected', 'withdrawn'] as const
export type ApplicationStatus = (typeof STATUSES)[number]

// Where the job is done. Optional: many postings do not say, and nothing forces a guess.
export const WORK_MODES = ['remote', 'hybrid', 'in_person'] as const
export type WorkMode = (typeof WORK_MODES)[number]

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
  work_mode: WorkMode | null // null = not specified
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
  work_mode: WorkMode | null
  notes: string | null
  status: ApplicationStatus
  follow_up_date: string | null
}

export interface ApplicationFilters {
  q?: string
  company?: string
  status?: ApplicationStatus
  work_mode?: WorkMode
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

// --- dashboard stats --------------------------------------------------------

export interface Stats {
  total: number
  by_status: { status: ApplicationStatus; count: number }[]
  response: {
    responded: number
    eligible: number
    rate: number | null // 0..1, or null when nothing is eligible yet
  }
  per_week: { week_start: string; count: number }[] // week_start is a Monday
  // Applications still at Applied `days` days after they were sent. "Ghosted" is worked out, not a status.
  no_reply: { days: number; count: number }
}

// `weeks` limits every figure to the last N weeks; null means all time.
export const fetchStats = (weeks: number | null) =>
  request<Stats>(`/stats${weeks ? `?weeks=${weeks}` : ''}`)

// The whole logbook as a CSV file, for backup or a spreadsheet. The endpoint needs
// the login token, so this can't be a plain link: we fetch it and hand the bytes
// to the browser as a download.
export async function exportApplicationsCsv(): Promise<Blob> {
  const res = await send('/applications/export.csv')
  return res.blob()
}
