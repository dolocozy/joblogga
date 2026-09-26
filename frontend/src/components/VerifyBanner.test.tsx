import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { tokenStore } from '../api'
import { server } from '../test/server'
import { mockList, mockUpcoming, renderApp, url, USER } from '../test/helpers'

function signInAs(verified: boolean) {
  tokenStore.set('valid-token')
  server.use(http.get(url('/auth/me'), () => HttpResponse.json({ ...USER, email_verified: verified })))
  mockList([])
  mockUpcoming()
}

describe('the verify-your-email banner', () => {
  it('is shown to an unverified user, with their address, on the logged-in pages', async () => {
    signInAs(false)
    renderApp('/applications')

    expect(await screen.findByText(/Please verify your email address/)).toBeInTheDocument()
    expect(screen.getAllByText(USER.email).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Resend email' })).toBeInTheDocument()
  })

  it('does not stop them using the app', async () => {
    signInAs(false)
    renderApp('/applications')

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('is absent for a verified user', async () => {
    signInAs(true)
    renderApp('/applications')

    await screen.findByRole('heading', { name: 'Applications' })
    expect(screen.queryByText(/Please verify your email address/)).not.toBeInTheDocument()
  })

  it('resends on request and confirms', async () => {
    const user = userEvent.setup()
    signInAs(false)
    let sent = 0
    server.use(http.post(url('/auth/verify-email/resend'), () => (sent++, HttpResponse.json({ detail: "We've sent a new verification link to your email address." }, { status: 202 }))))
    renderApp('/applications')

    await user.click(await screen.findByRole('button', { name: 'Resend email' }))

    expect(await screen.findByRole('status')).toHaveTextContent("We've sent a new verification link")
    expect(sent).toBe(1)
    expect(screen.queryByRole('button', { name: 'Resend email' })).not.toBeInTheDocument() // no second click by mistake
  })

  it('shows the rate-limit message and lets them try again later', async () => {
    const user = userEvent.setup()
    signInAs(false)
    server.use(http.post(url('/auth/verify-email/resend'), () => HttpResponse.json({ detail: 'Too many attempts. Try again in 60 minutes.' }, { status: 429 })))
    renderApp('/applications')

    await user.click(await screen.findByRole('button', { name: 'Resend email' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
    expect(screen.getByRole('button', { name: 'Resend email' })).toBeEnabled()
  })
})
