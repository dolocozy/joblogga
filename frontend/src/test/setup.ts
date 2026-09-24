import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

// 'error' makes an un-mocked request fail loudly instead of hitting a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

afterEach(() => {
  cleanup() // unmount rendered components
  server.resetHandlers()
  localStorage.clear() // the auth token must not leak between tests
})

afterAll(() => server.close())
