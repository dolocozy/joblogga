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
  it('asks the server to make the account, then says where the verification email went, without logging in', async () => {
    const user = userEvent.setup()
    const calls: string[] = []
    server.use(
      http.post(url('/auth/signup'), () => {
        calls.push('signup')
        return HttpResponse.json({ detail: 'Almost there.' }, { status: 202 })
      }),
      http.post(url('/auth/login'), () => {
        calls.push('login')
        return HttpResponse.json({ access_token: 'fresh' })
      }),
    )
    renderApp('/signup')

    await screen.findByRole('heading', { name: 'Create your account' })
    await fillAndSubmit(user, 'Sign up')

    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('A verification email has been sent to me@example.com')
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(calls).toEqual(['signup'])
    expect(tokenStore.get()).toBeNull()
  })

  it('shows the address as typed (trimmed), not something the server said', async () => {
    const user = userEvent.setup()
    server.use(http.post(url('/auth/signup'), () => HttpResponse.json({ detail: 'x' }, { status: 202 })))
    renderApp('/signup')
    await screen.findByRole('heading', { name: 'Create your account' })

    await user.type(screen.getByLabelText('Email'), '  someone@example.org ')
    await user.type(screen.getByLabelText('Password'), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByRole('status')).toHaveTextContent('someone@example.org')
  })

  it('shows a server error (such as a rate limit) and stays on the form', async () => {
    const user = userEvent.setup()
    server.use(http.post(url('/auth/signup'), () => HttpResponse.json({ detail: 'Too many attempts. Try again in 60 minutes.' }, { status: 429 })))
    renderApp('/signup')

    await screen.findByRole('heading', { name: 'Create your account' })
    await fillAndSubmit(user, 'Sign up')

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
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
