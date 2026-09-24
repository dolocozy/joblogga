import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { API_URL } from '../api'

// A fake backend. Apart from the health check (the landing page pings it to wake a
// sleeping server), it starts with no handlers: each test declares exactly the
// endpoints it expects, and any other request fails the test (see setup.ts).
export const server = setupServer(http.get(`${API_URL}/health`, () => HttpResponse.json({ status: 'ok' })))
