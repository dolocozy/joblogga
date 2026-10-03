import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { API_URL } from '../api'

// A fake backend. Apart from the health check (the landing page pings it to wake a
// sleeping server), it starts with no handlers: each test declares exactly the
// endpoints it expects, and any other request fails the test (see setup.ts).
// A few real-looking countries, so any page that offers a country picker or filter can load them.
export const COUNTRIES = [
  { id: 1, name: 'Canada', iso2: 'CA' },
  { id: 4, name: 'Switzerland', iso2: 'CH' },
  { id: 6, name: 'United States', iso2: 'US' },
]

export const server = setupServer(
  http.get(`${API_URL}/health`, () => HttpResponse.json({ status: 'ok' })),
  http.get(`${API_URL}/geo/countries`, () => HttpResponse.json(COUNTRIES)),
  // Saving an application first asks whether it duplicates one; by default nothing does. Tests that care override it.
  http.get(`${API_URL}/applications/duplicates`, () => HttpResponse.json([])),
  // The form suggests tags you have used, and the list can filter by them; by default there are none.
  http.get(`${API_URL}/applications/tags`, () => HttpResponse.json([])),
)
