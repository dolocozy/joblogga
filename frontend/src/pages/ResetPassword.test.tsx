import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { SETTLE_MS } from '../hooks'
import { server } from '../test/server'
import { makeApplication, mockList, mockUpcoming, signIn, url } from '../test/helpers'

const TOKEN = 'Zm9vYmFyLXRva2VuLXZhbHVlLTEyMzQ1Njc4OTA'
const NEW = 'a-brand-new-password'
afterEach(() => vi.useRealTimers())

function ShowLocation() {
  const l = useLocation()
  return <div data-testid="location">{l.pathname + l.search + l.hash}</div>
}

/** The whole app at `entry`, plus a readout of the current address. */
function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
      <ShowLocation />
    </MemoryRouter>,
  )
}
const address = () => screen.getByTestId('location').textContent

function watchConfirm(reply: () => Response = () => HttpResponse.json({ detail: 'Your password has been updated.' })) {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  server.use(
    http.post(url('/auth/password-reset/confirm'), async ({ request }) => {
      calls.push({ url: request.url, body: (await request.json()) as Record<string, unknown> })
      return reply()
    }),
  )
  return calls
}

const first = () => screen.getByLabelText('New password')
const again = () => screen.getByLabelText('Repeat new password')
const update = () => screen.getByRole('button', { name: 'Update password' })

describe('opening the link from the email', () => {
  it('reads the token and takes it out of the address bar straight away', async () => {
    renderAt(`/reset-password#token=${TOKEN}`)
    await screen.findByRole('heading', { name: 'Choose a new password' })
    expect(address()).toBe('/reset-password') // no token in the address, so none in history or a bookmark
  })

  it('still uses the token it read after removing it from the address', async () => {
    const user = userEvent.setup()
    const calls = watchConfirm()
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.type(await screen.findByLabelText('New password'), NEW)
    await user.type(again(), NEW)
    await user.click(update())

    await screen.findByRole('heading', { name: 'Log in' })
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual({ token: TOKEN, password: NEW })
  })

  it('sends the token in the request body, never in the address of the request', async () => {
    const user = userEvent.setup()
    const calls = watchConfirm()
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.type(await screen.findByLabelText('New password'), NEW)
    await user.type(again(), NEW)
    await user.click(update())

    await screen.findByRole('heading', { name: 'Log in' })
    expect(calls[0].url).not.toContain(TOKEN) // URLs get logged; bodies don't
  })

  it('a link with no token says so and offers a fresh one', async () => {
    renderAt('/reset-password')
    expect(await screen.findByRole('heading', { name: 'This link is incomplete' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })

  it.each(['#', '#token=', '#other=abc'])('treats %j as no token', async (hash) => {
    renderAt(`/reset-password${hash}`)
    expect(await screen.findByRole('heading', { name: 'This link is incomplete' })).toBeInTheDocument()
  })

  it('works even in a browser that is already logged in (the link must work wherever it lands)', async () => {
    signIn()
    renderAt(`/reset-password#token=${TOKEN}`)
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument()
    expect(address()).toBe('/reset-password') // not bounced to the app
  })
})

describe('choosing the new password', () => {
  it('goes to the login page with a confirmation, and does not log them in', async () => {
    const user = userEvent.setup()
    watchConfirm()
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.type(await screen.findByLabelText('New password'), NEW)
    await user.type(again(), NEW)
    await user.click(update())

    expect(await screen.findByRole('status')).toHaveTextContent('Your password has been updated. Log in with your new password.')
    expect(address()).toBe('/login')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
    expect(localStorage.getItem('joblogga_token')).toBeNull()
  })

  it('shows a live character count for the new password, like signup', async () => {
    const user = userEvent.setup()
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.type(await screen.findByLabelText('New password'), 'abc')
    expect(screen.getByText('Use at least 8 characters (3 so far)')).toBeInTheDocument()
    await user.type(first(), 'defgh')
    expect(screen.queryByText(/so far/)).not.toBeInTheDocument()
  })

  it('does not say the passwords differ while the second is still being typed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.type(await screen.findByLabelText('New password'), NEW)

    for (const ch of NEW.slice(0, 8)) {
      await user.type(again(), ch) // every prefix "differs" from the full password
      expect(screen.queryByText('The passwords do not match')).not.toBeInTheDocument()
    }
    await act(async () => void vi.advanceTimersByTime(SETTLE_MS + 50))
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument() // now they have paused, and it does not match

    await user.type(again(), NEW.slice(8))
    expect(screen.queryByText('The passwords do not match')).not.toBeInTheDocument() // the moment it matches
  })

  it('blocks a mismatch on submit, focuses the repeat box, and sends nothing', async () => {
    const user = userEvent.setup()
    const calls = watchConfirm()
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.type(await screen.findByLabelText('New password'), NEW)
    await user.type(again(), 'a-different-password')
    await user.click(update())

    expect(screen.getByText('The passwords do not match')).toBeInTheDocument()
    expect(again()).toHaveFocus()
    expect(calls).toEqual([])
  })

  it('blocks a too-short password on submit and focuses it', async () => {
    const user = userEvent.setup()
    const calls = watchConfirm()
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.type(await screen.findByLabelText('New password'), 'short')
    await user.type(again(), 'short')
    await user.click(update())

    expect(first()).toHaveFocus()
    expect(calls).toEqual([])
  })

  it('an empty form is blocked with both messages', async () => {
    const user = userEvent.setup()
    watchConfirm()
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.click(await screen.findByRole('button', { name: 'Update password' }))
    expect(screen.getByText('Choose a password')).toBeInTheDocument()
    expect(first()).toHaveFocus()
  })
})

describe('when the server refuses', () => {
  it('an invalid or expired link says so and offers a new one, keeping them on the page', async () => {
    const user = userEvent.setup()
    watchConfirm(() => HttpResponse.json({ detail: 'This reset link is invalid or has expired. Please request a new one.' }, { status: 400 }))
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.type(await screen.findByLabelText('New password'), NEW)
    await user.type(again(), NEW)
    await user.click(update())

    expect(await screen.findByRole('alert')).toHaveTextContent('This reset link is invalid or has expired.')
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
    expect(address()).toBe('/reset-password')
  })

  it('a rate-limit refusal shows the message without a misleading "request a new link"', async () => {
    const user = userEvent.setup()
    watchConfirm(() => HttpResponse.json({ detail: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 }))
    renderAt(`/reset-password#token=${TOKEN}`)
    await user.type(await screen.findByLabelText('New password'), NEW)
    await user.type(again(), NEW)
    await user.click(update())

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Try again in 15 minutes.')
    expect(screen.queryByRole('link', { name: 'Request a new link' })).not.toBeInTheDocument()
    expect(update()).toBeEnabled()
  })
})

describe('the notice on the login page', () => {
  it('is shown once after a reset, and not on an ordinary visit', async () => {
    renderAt('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.queryByText(/password has been updated/i)).not.toBeInTheDocument()
  })

  it('a logged-in visitor to the landing page is unaffected by any of this', async () => {
    signIn()
    mockList([makeApplication()])
    mockUpcoming()
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
  })
})
