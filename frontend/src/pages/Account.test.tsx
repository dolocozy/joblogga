import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { tokenStore } from '../api'
import { server } from '../test/server'
import { mockList, mockUpcoming, renderApp, signIn, url, USER } from '../test/helpers'

function watchDelete(reply: () => Response = () => new HttpResponse(null, { status: 204 })) {
  const bodies: unknown[] = []
  server.use(
    http.post(url('/auth/delete-account'), async ({ request }) => {
      bodies.push(await request.json())
      return reply()
    }),
  )
  return bodies
}

const openConfirm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Delete my account…' }))
  return screen.findByLabelText('Enter your password to confirm')
}
const confirmButton = () => screen.getByRole('button', { name: 'Permanently delete my account' })

describe('reaching the account page', () => {
  it('is linked from the email in the header', async () => {
    const user = userEvent.setup()
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/applications')

    await user.click(await screen.findByRole('link', { name: `Account: ${USER.email}` }))

    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(screen.getByText('Email address verified.')).toBeInTheDocument()
  })

  it('is for logged-in users only', async () => {
    renderApp('/account')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })
})

describe('deleting the account', () => {
  it('shows nothing destructive until asked, then explains what will go and asks for the password', async () => {
    const user = userEvent.setup()
    signIn()
    renderApp('/account')

    await screen.findByRole('heading', { name: 'Account' })
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Permanently delete my account' })).not.toBeInTheDocument()

    await openConfirm(user)
    expect(screen.getByText(`This will delete ${USER.email} and everything in it, for good.`)).toBeInTheDocument()
    expect(confirmButton()).toBeInTheDocument()
  })

  it('cancelling closes the panel, forgets the password, and sends nothing', async () => {
    const user = userEvent.setup()
    signIn()
    const bodies = watchDelete()
    renderApp('/account')

    await user.type(await openConfirm(user), 'secret-password')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument()

    expect(await openConfirm(user)).toHaveValue('')
    expect(bodies).toHaveLength(0)
  })

  it('will not send an empty password, and says why next to the field', async () => {
    const user = userEvent.setup()
    signIn()
    const bodies = watchDelete()
    renderApp('/account')
    await openConfirm(user)

    await user.click(confirmButton())

    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('sends the password, ends the session, and says so on the login page', async () => {
    const user = userEvent.setup()
    signIn()
    const bodies = watchDelete()
    renderApp('/account')

    await user.type(await openConfirm(user), 'correct-horse-battery')
    await user.click(confirmButton())

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your account and all of its data have been deleted.')
    expect(bodies).toEqual([{ password: 'correct-horse-battery' }])
    expect(tokenStore.get()).toBeNull()
  })

  it('a wrong password shows the server message and leaves them logged in', async () => {
    const user = userEvent.setup()
    signIn()
    watchDelete(() => HttpResponse.json({ detail: 'Incorrect password' }, { status: 403 }))
    renderApp('/account')

    await user.type(await openConfirm(user), 'nope-nope-nope')
    await user.click(confirmButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password')
    expect(tokenStore.get()).toBe('valid-token')
    expect(confirmButton()).toBeEnabled() // they can try again
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
  })

  it('the login notice goes away on the next visit', async () => {
    const user = userEvent.setup()
    signIn()
    watchDelete()
    renderApp('/account')
    await user.type(await openConfirm(user), 'correct-horse-battery')
    await user.click(confirmButton())
    await screen.findByRole('status')

    // A fresh page load has no memory of it.
    document.body.innerHTML = ''
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.queryByText(/have been deleted/)).not.toBeInTheDocument()
  })
})

describe('exporting from the account page', () => {
  it('offers the CSV export so data can be saved first', async () => {
    signIn()
    renderApp('/account')
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  })
})
