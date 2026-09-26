import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { mockList, mockUpcoming, renderApp, signIn, url } from '../test/helpers'

const TOKEN = 'a'.repeat(43)

function watchConfirm(reply: () => Response = () => HttpResponse.json({ detail: 'Your email address is verified.' })) {
  const bodies: unknown[] = []
  server.use(
    http.post(url('/auth/verify-email/confirm'), async ({ request }) => {
      bodies.push(await request.json())
      return reply()
    }),
  )
  return bodies
}

describe('the verification link', () => {
  it('redeems the token from the address fragment once and says the email is verified', async () => {
    const bodies = watchConfirm()
    renderApp(`/verify-email#token=${TOKEN}`)

    expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeInTheDocument()
    expect(bodies).toEqual([{ token: TOKEN }])
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  })

  it('works for someone who is not logged in on this device', async () => {
    watchConfirm()
    renderApp(`/verify-email#token=${TOKEN}`)
    await screen.findByRole('heading', { name: 'Email verified' })
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
  })

  it('offers the app instead, and refreshes who they are, when they are already logged in', async () => {
    signIn()
    mockList([])
    mockUpcoming()
    let refreshed = 0
    watchConfirm()
    server.use(http.get(url('/auth/me'), () => (refreshed++, HttpResponse.json({ id: 1, email: 'me@example.com', created_at: '2026-01-01T00:00:00Z', email_verified: true }))))
    renderApp(`/verify-email#token=${TOKEN}`)

    expect(await screen.findByRole('link', { name: 'Go to your applications' })).toHaveAttribute('href', '/applications')
    expect(refreshed).toBeGreaterThanOrEqual(2) // once on load, once after verifying
  })

  it('says a spent or expired link did not work and points at the way to get a new one', async () => {
    watchConfirm(() => HttpResponse.json({ detail: 'This verification link is invalid or has expired. Log in to request a new one.' }, { status: 400 }))
    renderApp(`/verify-email#token=${TOKEN}`)

    expect(await screen.findByRole('heading', { name: "This link didn't work" })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('invalid or has expired')
    expect(screen.getByText(/banner at the top of the app/)).toBeInTheDocument()
  })

  it('does not call a network failure a bad link, since the token is not used up', async () => {
    watchConfirm(() => HttpResponse.error())
    renderApp(`/verify-email#token=${TOKEN}`)

    expect(await screen.findByRole('heading', { name: 'Could not reach the server' })).toBeInTheDocument()
    expect(screen.getByText(/has not been used up/)).toBeInTheDocument()
  })

  it('does not call the server when the link has no token', async () => {
    const bodies = watchConfirm()
    renderApp('/verify-email')

    expect(await screen.findByRole('heading', { name: 'This link is incomplete' })).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })
})
