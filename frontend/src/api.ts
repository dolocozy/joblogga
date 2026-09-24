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
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, errorMessage(body?.detail, `Request failed (${res.status})`))
  }
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
