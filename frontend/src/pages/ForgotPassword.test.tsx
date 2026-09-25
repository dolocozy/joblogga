import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SETTLE_MS } from '../hooks'
import { server } from '../test/server'
import { renderApp, url } from '../test/helpers'

const REPLY = 'If an account exists for that email, a reset link is on its way. It works for 30 minutes.'
afterEach(() => vi.useRealTimers())

function watchRequests(reply: () => Response = () => HttpResponse.json({ detail: REPLY }, { status: 202 })) {
  const bodies: unknown[] = []
  server.use(
    http.post(url('/auth/password-reset/request'), async ({ request }) => {
      bodies.push(await request.json())
      return reply()
    }),
  )
  return bodies
}

const email = () => screen.getByLabelText('Email')
const send = () => screen.getByRole('button', { name: 'Send reset link' })

describe('finding the page', () => {
  it.each(['/login', '/'])('the login form on %s links to it', async (route) => {
    renderApp(route)
    const link = await screen.findByRole('link', { name: 'Forgot your password?' })
    expect(link).toHaveAttribute('href', '/forgot-password')
  })
})

describe('asking for a reset link', () => {
  it('sends the address (trimmed) and shows the server reply, not the form', async () => {
    const user = userEvent.setup()
    const bodies = watchRequests()
    renderApp('/forgot-password')
    await screen.findByRole('heading', { name: 'Reset your password' })

    await user.type(email(), '  me@example.com  ')
    await user.click(send())

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(REPLY)
    expect(bodies).toEqual([{ email: 'me@example.com' }])
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('does not repeat the address back, which would suggest an email was sent to it', async () => {
    const user = userEvent.setup()
    watchRequests()
    renderApp('/forgot-password')
    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com')
    await user.click(send())

    await screen.findByRole('heading', { name: 'Check your email' })
    expect(document.body).not.toHaveTextContent('nobody@example.com')
  })

  it('looks exactly the same for every address (the server answers every address the same)', async () => {
    const user = userEvent.setup()
    watchRequests()
    const shown: string[] = []
    for (const address of ['exists@example.com', 'ghost@example.com']) {
      const { unmount } = renderApp('/forgot-password')
      await user.type(await screen.findByLabelText('Email'), address)
      await user.click(send())
      await screen.findByRole('heading', { name: 'Check your email' })
      shown.push(document.body.textContent ?? '')
      unmount()
    }
    expect(shown[0]).toBe(shown[1])
  })

  it('offers a way back to the login page', async () => {
    const user = userEvent.setup()
    watchRequests()
    renderApp('/forgot-password')
    await user.type(await screen.findByLabelText('Email'), 'me@example.com')
    await user.click(send())
    expect(await screen.findByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login')
  })

  it('will not send an empty or invalid address, and says why', async () => {
    const user = userEvent.setup()
    const bodies = watchRequests()
    renderApp('/forgot-password')
    await screen.findByLabelText('Email')

    await user.click(send())
    expect(screen.getByText('Enter your email address')).toBeInTheDocument()
    expect(email()).toHaveFocus()

    await user.type(email(), 'not-an-email')
    await user.click(send())
    expect(screen.getByText('Enter an email address like name@example.com')).toBeInTheDocument()
    expect(bodies).toEqual([])
  })

  it('does not nag while the address is still being typed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/forgot-password')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@exam')
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(SETTLE_MS + 50))
    expect(screen.getByText(/enter an email address/i)).toBeInTheDocument()
  })

  it('shows the too-many-requests message and lets them try again later', async () => {
    const user = userEvent.setup()
    watchRequests(() => HttpResponse.json({ detail: 'Too many attempts. Try again in 60 minutes.' }, { status: 429 }))
    renderApp('/forgot-password')
    await user.type(await screen.findByLabelText('Email'), 'me@example.com')
    await user.click(send())

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 60 minutes.')
    expect(send()).toBeEnabled()
    expect(email()).toHaveValue('me@example.com')
  })

  it('says when the server cannot be reached', async () => {
    const user = userEvent.setup()
    server.use(http.post(url('/auth/password-reset/request'), () => HttpResponse.error()))
    renderApp('/forgot-password')
    await user.type(await screen.findByLabelText('Email'), 'me@example.com')
    await user.click(send())
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i)
  })
})
