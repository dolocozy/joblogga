import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { forgetCountries, forgetCurrencies } from '../api'
import { server } from './server'

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks. With no
// layout engine every size is 0, so charts draw nothing in tests; we assert on
// the numbers (tiles) and the table view instead.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// 'error' makes an un-mocked request fail loudly instead of hitting a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  cleanup() // unmount rendered components
  server.resetHandlers()
  forgetCurrencies()
  forgetCountries() // the country list is cached for the life of a page; each test is a new page
  localStorage.clear() // the auth token must not leak between tests
})

afterAll(() => server.close())
