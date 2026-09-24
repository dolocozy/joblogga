import { setupServer } from 'msw/node'

// A fake backend. It starts with no handlers: each test declares exactly the
// endpoints it expects, and any other request fails the test (see setup.ts).
export const server = setupServer()
