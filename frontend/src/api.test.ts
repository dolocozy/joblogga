import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  deleteApplication,
  exportApplicationsCsv,
  fetchMe,
  fetchUpcoming,
  listApplications,
  login,
  setUnauthorizedHandler,
  signup,
  tokenStore,
} from './api'
import { server } from './test/server'
import { url } from './test/helpers'

describe('request helper', () => {
  it('sends the saved token as a Bearer header', async () => {
    tokenStore.set('abc123')
    let auth: string | null = null
    server.use(
      http.get(url('/auth/me'), ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({ id: 1, email: 'a@b.co', created_at: '' })
      }),
    )
    await fetchMe()
    expect(auth).toBe('Bearer abc123')
  })

  it('sends no Authorization header when logged out', async () => {
    let auth: string | null = 'unset'
    server.use(
      http.post(url('/auth/login'), ({ request }) => {
        auth = request.headers.get('authorization')
        return HttpResponse.json({ access_token: 't' })
      }),
    )
    await login('a@b.co', 'password123')
    expect(auth).toBeNull()
  })

  it('uses a string `detail` as the error message', async () => {
    server.use(http.post(url('/auth/signup'), () => HttpResponse.json({ detail: 'Email already registered' }, { status: 409 })))
    const err = await signup('a@b.co', 'password123').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('Email already registered')
  })

  it('flattens FastAPI validation errors (a list) into readable text', async () => {
    server.use(
      http.post(url('/auth/signup'), () =>
        HttpResponse.json(
          { detail: [{ msg: 'Value error, Password must be at least 8 characters' }, { msg: 'Second problem' }] },
          { status: 422 },
        ),
      ),
    )
    const err = await signup('a@b.co', 'x').catch((e) => e)
    expect(err.message).toBe('Password must be at least 8 characters. Second problem')
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    server.use(http.get(url('/auth/me'), () => new HttpResponse('boom', { status: 500 })))
    const err = await fetchMe().catch((e) => e)
    expect(err.status).toBe(500)
    expect(err.message).toBe('Request failed (500)')
  })

  it('reports an unreachable server as status 0 with a helpful message', async () => {
    server.use(http.get(url('/auth/me'), () => HttpResponse.error()))
    const err = await fetchMe().catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
    expect(err.message).toMatch(/could not reach the server/i)
  })

  it('handles 204 No Content without trying to parse JSON', async () => {
    server.use(http.delete(url('/applications/5'), () => new HttpResponse(null, { status: 204 })))
    await expect(deleteApplication(5)).resolves.toBeUndefined()
  })
})

describe('listApplications', () => {
  it('only sends filters that are set', async () => {
    let seen: URL | null = null
    server.use(
      http.get(url('/applications'), ({ request }) => {
        seen = new URL(request.url)
        return HttpResponse.json({ items: [], total: 0 })
      }),
    )
    await listApplications({ q: 'acme', company: '', status: 'offer', date_from: undefined, limit: 20, offset: 0 })
    expect(Object.fromEntries(seen!.searchParams)).toEqual({ q: 'acme', status: 'offer', limit: '20', offset: '0' })
  })
})

describe('expired sessions', () => {
  afterEach(() => setUnauthorizedHandler(null))

  it('a 401 on an authenticated request clears the token and notifies the app', async () => {
    tokenStore.set('expired')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    server.use(http.get(url('/applications/upcoming'), () => HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })))

    await fetchUpcoming().catch(() => {})

    expect(tokenStore.get()).toBeNull()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('a wrong-password 401 from the login form is just an error, not a session end', async () => {
    tokenStore.set('stale-token-still-in-storage')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    server.use(http.post(url('/auth/login'), () => HttpResponse.json({ detail: 'Incorrect email or password' }, { status: 401 })))

    await login('a@b.co', 'wrong-password').catch(() => {})

    expect(handler).not.toHaveBeenCalled()
  })

  it('a 401 with no token (logged out) does not trigger the handler', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    server.use(http.get(url('/auth/me'), () => HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })))

    await fetchMe().catch(() => {})

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('exportApplicationsCsv', () => {
  it('fetches the export with the login token and returns the file contents', async () => {
    tokenStore.set('abc123')
    let auth: string | null = null
    server.use(
      http.get(url('/applications/export.csv'), ({ request }) => {
        auth = request.headers.get('authorization')
        return new HttpResponse('Company,Role\r\nAcme,Engineer\r\n', { headers: { 'Content-Type': 'text/csv' } })
      }),
    )

    const blob = await exportApplicationsCsv()

    expect(auth).toBe('Bearer abc123')
    expect(await blob.text()).toBe('Company,Role\r\nAcme,Engineer\r\n')
  })

  it('ends the session if the token has expired, like any other request', async () => {
    tokenStore.set('expired')
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    server.use(http.get(url('/applications/export.csv'), () => HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })))

    await expect(exportApplicationsCsv()).rejects.toMatchObject({ status: 401 })

    expect(tokenStore.get()).toBeNull()
    expect(handler).toHaveBeenCalledTimes(1)
    setUnauthorizedHandler(null)
  })

  it('reports a server error with its message', async () => {
    server.use(http.get(url('/applications/export.csv'), () => HttpResponse.json({ detail: 'Export failed' }, { status: 500 })))
    await expect(exportApplicationsCsv()).rejects.toThrow('Export failed')
  })
})
