import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { tokenStore } from './api'
import { server } from './test/server'
import { makeApplication, mockList, mockUpcoming, renderApp, signIn, url, USER } from './test/helpers'

const loginHeading = () => screen.findByRole('heading', { name: 'Log in' })

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, button: string) {
  await user.type(screen.getByLabelText('Email'), 'me@example.com')
  await user.type(screen.getByLabelText('Password'), 'correct-horse-battery')
  await user.click(screen.getByRole('button', { name: button }))
}

describe('route protection', () => {
  it('sends a logged-out visitor from a protected page to the login page', async () => {
    renderApp('/')
    expect(await loginHeading()).toBeInTheDocument()
  })

  it('lets a logged-in user in, and shows who they are', async () => {
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.getByText(USER.email)).toBeInTheDocument()
  })

  it('sends a logged-in user away from the login page', async () => {
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
  })

  it('discards a saved token the server rejects (401) and shows login', async () => {
    tokenStore.set('expired-token')
    server.use(http.get(url('/auth/me'), () => HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })))
    renderApp('/')
    expect(await loginHeading()).toBeInTheDocument()
    expect(tokenStore.get()).toBeNull()
  })

  it('keeps the saved token when the server is merely unreachable', async () => {
    // A network blip must not log you out; only an explicit 401 does.
    tokenStore.set('still-good')
    server.use(http.get(url('/auth/me'), () => HttpResponse.error()))
    renderApp('/')
    expect(await loginHeading()).toBeInTheDocument()
    expect(tokenStore.get()).toBe('still-good')
  })
})

describe('session expiry', () => {
  it('sends the user to login with an explanation when the token expires mid-session', async () => {
    const user = userEvent.setup()
    signIn()
    mockList([makeApplication({ id: 5, company: 'Globex' })])
    mockUpcoming()
    server.use(http.patch(url('/applications/5'), () => HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })))
    renderApp('/')

    // The token was fine on load; the server rejects it when they act.
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status for Globex' }), 'offer')

    expect(await loginHeading()).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/session has expired/i)
    expect(tokenStore.get()).toBeNull()
  })

  it('does not show the expiry notice on a normal visit to the login page', async () => {
    renderApp('/login')
    await loginHeading()
    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument()
  })

  it('clears the notice after logging back in', async () => {
    const user = userEvent.setup()
    signIn()
    mockList([makeApplication({ id: 5, company: 'Globex' })])
    mockUpcoming()
    server.use(http.patch(url('/applications/5'), () => HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })))
    renderApp('/')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status for Globex' }), 'offer')
    await loginHeading()

    server.use(
      http.post(url('/auth/login'), () => HttpResponse.json({ access_token: 'renewed' })),
      http.get(url('/auth/me'), () => HttpResponse.json(USER)),
    )
    await fillAndSubmit(user, 'Log in')

    // Back on the page they were on, and a later logout doesn't resurrect the notice.
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Log out' }))
    await loginHeading()
    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument()
  })
})

describe('login', () => {
  it('logs in, stores the token, and lands on the applications page', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(url('/auth/login'), () => HttpResponse.json({ access_token: 'new-token' })),
      http.get(url('/auth/me'), () => HttpResponse.json(USER)),
    )
    mockList([])
    mockUpcoming()
    renderApp('/login')

    await loginHeading()
    await fillAndSubmit(user, 'Log in')

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
    expect(tokenStore.get()).toBe('new-token')
  })

  it('shows the server error and stays on the page for wrong credentials', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(url('/auth/login'), () => HttpResponse.json({ detail: 'Incorrect email or password' }, { status: 401 })),
    )
    renderApp('/login')

    await loginHeading()
    await fillAndSubmit(user, 'Log in')

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(tokenStore.get()).toBeNull()
    // The button is usable again so they can retry.
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })

  it('tells the user when the backend is unreachable', async () => {
    const user = userEvent.setup()
    server.use(http.post(url('/auth/login'), () => HttpResponse.error()))
    renderApp('/login')

    await loginHeading()
    await fillAndSubmit(user, 'Log in')

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach the server/i)
  })
})

describe('signup', () => {
  it('creates the account, logs in automatically, and lands on the app', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    server.use(
      http.post(url('/auth/signup'), () => {
        calls.push('signup')
        return HttpResponse.json(USER, { status: 201 })
      }),
      http.post(url('/auth/login'), () => {
        calls.push('login')
        return HttpResponse.json({ access_token: 'fresh' })
      }),
      http.get(url('/auth/me'), () => HttpResponse.json(USER)),
    )
    mockList([])
    mockUpcoming()
    renderApp('/signup')

    await screen.findByRole('heading', { name: 'Create your account' })
    await fillAndSubmit(user, 'Sign up')

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
    expect(calls).toEqual(['signup', 'login'])
  })

  it('shows a duplicate-email error', async () => {
    const user = userEvent.setup()
    server.use(http.post(url('/auth/signup'), () => HttpResponse.json({ detail: 'Email already registered' }, { status: 409 })))
    renderApp('/signup')

    await screen.findByRole('heading', { name: 'Create your account' })
    await fillAndSubmit(user, 'Sign up')

    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered')
  })
})

describe('logout', () => {
  it('clears the token and returns to the login page', async () => {
    const user = userEvent.setup()
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'Log out' }))

    expect(await loginHeading()).toBeInTheDocument()
    expect(tokenStore.get()).toBeNull()
  })
})
