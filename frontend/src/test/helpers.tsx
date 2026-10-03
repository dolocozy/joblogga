import { render } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'
import { API_URL, tokenStore } from '../api'
import type { Application, ApplicationDetail, Stats } from '../api'
import { server } from './server'

export const url = (path: string) => `${API_URL}${path}`

export const USER = { id: 1, email: 'me@example.com', created_at: '2026-01-01T00:00:00Z', email_verified: true, reminder_emails: false }

export function makeApplication(overrides: Partial<Application> = {}): Application {
  const app: Application = {
    id: 1,
    company: 'Acme',
    role: 'Engineer',
    job_url: null,
    date_applied: '2026-03-01',
    resume_version: null,
    salary_min: null,
    salary_max: null,
    location: null,
    location_display: null,
    country: null,
    city: null,
    work_mode: null,
    tags: [],
    notes: null,
    interview_round: null,
    interview_rounds_total: null,
    archived: false,
    archived_at: null,
    status: 'applied',
    follow_up_date: null,
    created_at: '2026-03-01T12:00:00Z',
    updated_at: '2026-03-01T12:00:00Z',
    ...overrides,
  }
  // Typed text reads as itself, like the server's location_display, unless a test sets the display explicitly.
  return { ...app, location_display: overrides.location_display !== undefined ? overrides.location_display : app.location }
}

export function makeDetail(overrides: Partial<ApplicationDetail> = {}): ApplicationDetail {
  return {
    ...makeApplication(overrides),
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
      { status: 'offer_accepted', count: 0 },
      { status: 'offer_declined', count: 0 },
      { status: 'rejected', count: 1 },
      { status: 'withdrawn', count: 2 },
    ],
    response: { responded: 4, eligible: 8, rate: 0.5 },
    per_week: [
      { week_start: '2026-03-02', count: 3 },
      { week_start: '2026-03-09', count: 7 },
    ],
    no_reply: { days: 30, count: 0 },
    stages: [
      { status: 'applied', finished: 6, mean_days: 7.5, median_days: 6, in_progress: 2, in_progress_mean_days: 12 },
      { status: 'screening', finished: 3, mean_days: 4, median_days: 3, in_progress: 1, in_progress_mean_days: 2 },
      { status: 'interview', finished: 0, mean_days: null, median_days: null, in_progress: 1, in_progress_mean_days: 20 },
      { status: 'offer', finished: 0, mean_days: null, median_days: null, in_progress: 0, in_progress_mean_days: null },
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

/** Real-looking city rows, including the ambiguous names the picker exists to tell apart. */
export const CITIES = [
  { id: 108, name: 'Springfield', state_id: 15, state: 'Illinois', country_id: 6 },
  { id: 109, name: 'Springfield', state_id: 16, state: 'Missouri', country_id: 6 },
  { id: 110, name: 'Springfield', state_id: 17, state: 'Ohio', country_id: 6 },
  { id: 100, name: 'Toronto', state_id: 10, state: 'Ontario', country_id: 1 },
  { id: 105, name: 'Zürich', state_id: 13, state: 'Zürich', country_id: 4 },
]

/** Fake `GET /geo/cities`: names starting with q, in the country, each with its state and full label. Records each query. */
export function mockCities(seen: URL[] = []) {
  const country = (id: number) => ({ 1: 'Canada', 4: 'Switzerland', 6: 'United States' })[id]
  server.use(
    http.get(url('/geo/cities'), ({ request }) => {
      const u = new URL(request.url)
      seen.push(u)
      const q = (u.searchParams.get('q') ?? '').toLowerCase()
      const norm = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
      const hits = CITIES.filter((c) => c.country_id === Number(u.searchParams.get('country_id')) && norm(c.name).startsWith(norm(q)))
      return HttpResponse.json(hits.map((c) => ({ id: c.id, name: c.name, state_id: c.state_id, state: c.state, label: `${c.name}, ${c.state}, ${country(c.country_id)}` })))
    }),
  )
  return seen
}

/** Fake `GET /geo/states` for the state filter. */
export function mockStates(byCountry: Record<number, { id: number; name: string }[]>, seen: URL[] = []) {
  server.use(
    http.get(url('/geo/states'), ({ request }) => {
      const u = new URL(request.url)
      seen.push(u)
      return HttpResponse.json(byCountry[Number(u.searchParams.get('country_id'))] ?? [])
    }),
  )
  return seen
}

/** An application with a picked place, as the API returns it: the city with its state, the country, and the generated text. */
export function withPlace(cityId: number, overrides: Partial<Application> = {}): Partial<Application> {
  const c = CITIES.find((x) => x.id === cityId)!
  const country = { 1: 'Canada', 4: 'Switzerland', 6: 'United States' }[c.country_id]!
  const label = `${c.name}, ${c.state}, ${country}`
  return {
    country: { id: c.country_id, name: country },
    city: { id: c.id, name: c.name, state: { id: c.state_id, name: c.state } },
    location: label,
    location_display: label,
    ...overrides,
  }
}
