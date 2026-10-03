import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { renderApp, url } from '../test/helpers'

const TOKEN = '7.' + 'a'.repeat(43)

function watch(reply: () => Response = () => HttpResponse.json({ detail: 'You will not get follow-up reminder emails any more.' })) {
  const bodies: unknown[] = []
  server.use(http.post(url('/auth/unsubscribe-reminders'), async ({ request }) => (bodies.push(await request.json()), reply())))
  return bodies
}

describe('the unsubscribe link in a reminder email', () => {
  it('works for someone who is not logged in, and asks before doing anything', async () => {
    const bodies = watch()
    renderApp(`/unsubscribe#token=${TOKEN}`)

    expect(await screen.findByRole('heading', { name: 'Stop reminder emails?' })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 200))
    expect(bodies).toHaveLength(0) // opening the link (or a mail scanner doing so) changes nothing
  })

  it('switches reminders off when asked, sending the token from the address fragment', async () => {
    const user = userEvent.setup()
    const bodies = watch()
    renderApp(`/unsubscribe#token=${TOKEN}`)
    await user.click(await screen.findByRole('button', { name: 'Stop reminder emails' }))

    expect(await screen.findByRole('heading', { name: 'Reminders are off' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('will not get follow-up reminder emails')
    expect(bodies).toEqual([{ token: TOKEN }])
  })

  it('takes the token out of the address bar as soon as it has read it', async () => {
    watch()
    renderApp(`/unsubscribe#token=${TOKEN}`)
    await screen.findByRole('heading', { name: 'Stop reminder emails?' })
    await waitFor(() => expect(window.location.hash).not.toContain('token'))
  })

  it('says a link that did not work, with the way out', async () => {
    const user = userEvent.setup()
    watch(() => HttpResponse.json({ detail: 'This unsubscribe link is not valid.' }, { status: 400 }))
    renderApp(`/unsubscribe#token=${TOKEN}`)
    await user.click(await screen.findByRole('button', { name: 'Stop reminder emails' }))

    expect(await screen.findByRole('heading', { name: 'This link did not work' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('not valid')
    expect(screen.getByText(/turn reminders off from your account instead/)).toBeInTheDocument()
  })

  it('does not call a network failure an invalid link, and lets them try again', async () => {
    const user = userEvent.setup()
    watch(() => HttpResponse.error())
    renderApp(`/unsubscribe#token=${TOKEN}`)
    await user.click(await screen.findByRole('button', { name: 'Stop reminder emails' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
    expect(screen.getByRole('button', { name: 'Stop reminder emails' })).toBeEnabled()
  })

  it('says so, and calls nothing, when the link has no token', async () => {
    const bodies = watch()
    renderApp('/unsubscribe')
    expect(await screen.findByRole('heading', { name: 'This link is incomplete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop reminder emails' })).not.toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('always offers the account page as the other way', async () => {
    watch()
    renderApp(`/unsubscribe#token=${TOKEN}`)
    expect(await screen.findByRole('link', { name: 'Go to your account' })).toHaveAttribute('href', '/account')
  })
})
