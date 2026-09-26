import { render } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { API_URL, tokenStore } from '../api'
import type { Application, ApplicationDetail, Stats } from '../api'
import { server } from './server'

export const url = (path: string) => `${API_URL}${path}`

export const USER = { id: 1, email: 'me@example.com', created_at: '2026-01-01T00:00:00Z', email_verified: true }

export function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: 1,
    company: 'Acme',
    role: 'Engineer',
    job_url: null,
    date_applied: '2026-03-01',
    resume_version: null,
    salary_min: null,
    salary_max: null,
    location: null,
    notes: null,
    status: 'applied',
    follow_up_date: null,
    created_at: '2026-03-01T12:00:00Z',
    updated_at: '2026-03-01T12:00:00Z',
    ...overrides,
  }
}

export function makeDetail(overrides: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    ...makeApplication(),
    history: [{ id: 1, from_status: null, to_status: 'applied', changed_at: '2026-03-01T12:00:00Z' }],
    ...overrides,
  }
}

/** Renders the whole app at `route`, like a browser landing on that URL. Pass an
 * object to also supply router state (e.g. a saved return path). */
export function renderApp(route: string | { pathname: string; state?: unknown } = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  )
}

/** Simulates an already-logged-in browser: saved token that /auth/me accepts. */
export function signIn() {
  tokenStore.set('valid-token')
  server.use(http.get(url('/auth/me'), () => HttpResponse.json(USER)))
}

/**
 * Fake `GET /applications` over an in-memory array, honouring limit/offset like
 * the real API. Every request's URL is pushed onto `seen` so tests can assert
 * which query parameters the UI sent.
 */
export function mockList(all: Application[], seen: URL[] = []) {
  server.use(
    http.get(url('/applications'), ({ request }) => {
      const u = new URL(request.url)
      seen.push(u)
      const limit = Number(u.searchParams.get('limit') ?? 50)
      const offset = Number(u.searchParams.get('offset') ?? 0)
      return HttpResponse.json({ items: all.slice(offset, offset + limit), total: all.length })
    }),
  )
  return seen
}

export function mockUpcoming(items: Application[] = []) {
  server.use(http.get(url('/applications/upcoming'), () => HttpResponse.json(items)))
}

/** `count` applications, newest first like the real list. */
export function manyApplications(count: number): Application[] {
  return Array.from({ length: count }, (_, i) =>
    makeApplication({ id: i + 1, company: `Company ${i + 1}`, role: `Role ${i + 1}` }),
  )
}

export function makeStats(overrides: Partial<Stats> = {}): Stats {
  return {
    total: 10,
    by_status: [
      { status: 'applied', count: 2 },
      { status: 'screening', count: 3 },
      { status: 'interview', count: 1 },
      { status: 'offer', count: 1 },
      { status: 'rejected', count: 1 },
      { status: 'withdrawn', count: 2 },
    ],
    response: { responded: 4, eligible: 8, rate: 0.5 },
    per_week: [
      { week_start: '2026-03-02', count: 3 },
      { week_start: '2026-03-09', count: 7 },
    ],
    ...overrides,
  }
}

/** Fake `GET /stats`; records each request URL so tests can check the `weeks` param. */
export function mockStats(stats: Stats = makeStats(), seen: URL[] = []) {
  server.use(
    http.get(url('/stats'), ({ request }) => {
      seen.push(new URL(request.url))
      return HttpResponse.json(stats)
    }),
  )
  return seen
}
