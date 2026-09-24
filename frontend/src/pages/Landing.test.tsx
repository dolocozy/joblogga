import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { tokenStore } from '../api'
import { server } from '../test/server'
import { makeDetail, mockList, mockStats, mockUpcoming, renderApp, signIn, url, USER } from '../test/helpers'

function mockLoginSuccess() {
  server.use(
    http.post(url('/auth/login'), () => HttpResponse.json({ access_token: 'fresh-token' })),
    http.get(url('/auth/me'), () => HttpResponse.json(USER)),
  )
}

async function logIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email'), 'me@example.com')
  await user.type(screen.getByLabelText('Password'), 'correct-horse-battery')
  await user.click(screen.getByRole('button', { name: 'Log in' }))
}

describe('landing page at /', () => {
  it('explains what Joblogga is, with the login form on the page', async () => {
    renderApp('/')

    expect(await screen.findByRole('heading', { level: 1, name: 'A logbook for your job search' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What it does' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Who it is for' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How it works' })).toBeInTheDocument()
    // The compact login form is right here, not on a separate page.
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('includes the personal note about being built during a real job search', async () => {
    renderApp('/')
    expect(await screen.findByText(/built joblogga during my own job search/i)).toBeInTheDocument()
  })

  it('links to sign up (twice: header and under the form)', async () => {
    renderApp('/')
    const links = await screen.findAllByRole('link', { name: 'Create an account' })
    expect(links).toHaveLength(2)
    links.forEach((l) => expect(l).toHaveAttribute('href', '/signup'))
  })

  it('shows a sample ledger page, with an overdue follow-up highlighted', async () => {
    renderApp('/')
    const sample = (await screen.findByRole('heading', { name: 'What a page looks like' })).closest('section')!
    expect(within(sample).getByText('Fernhill Health')).toBeInTheDocument()
    const overdue = within(sample).getByText('overdue')
    expect(overdue.previousElementSibling?.tagName).toBe('MARK') // date under the highlighter
    expect(within(sample).getByText(/made-up companies/i)).toBeInTheDocument()
  })

  it('discloses that it is open source and built with Claude Code', async () => {
    renderApp('/')
    const github = await screen.findByRole('link', { name: /view the source on github/i })
    expect(github).toHaveAttribute('href', 'https://github.com/dolocozy/joblogga')
    expect(github).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByText(/built with claude code/i)).toBeInTheDocument()
    expect(screen.getByText(/MIT license/i)).toBeInTheDocument()
  })

  it('takes a logged-in visitor straight to /applications', async () => {
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'A logbook for your job search' })).not.toBeInTheDocument()
  })
})

describe('logging in from the landing page', () => {
  it('lands on /applications by default', async () => {
    const user = userEvent.setup()
    mockLoginSuccess()
    mockList([])
    mockUpcoming()
    renderApp('/')

    await logIn(user)

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
    expect(tokenStore.get()).toBe('fresh-token')
  })

  it('shows a wrong-password error in place', async () => {
    const user = userEvent.setup()
    server.use(http.post(url('/auth/login'), () => HttpResponse.json({ detail: 'Incorrect email or password' }, { status: 401 })))
    renderApp('/')

    await logIn(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
    expect(screen.getByRole('heading', { level: 1, name: 'A logbook for your job search' })).toBeInTheDocument()
  })
})

describe('redirects from protected pages are preserved', () => {
  it('sends a logged-out visitor to the landing page, then back to the page they wanted', async () => {
    const user = userEvent.setup()
    mockLoginSuccess()
    mockStats()
    renderApp('/dashboard')

    // Bounced to the landing page with its login form...
    expect(await screen.findByRole('heading', { level: 1, name: 'A logbook for your job search' })).toBeInTheDocument()
    await logIn(user)

    // ...and after logging in, they get the dashboard, not the default page.
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('returns to a specific application, not just a top-level page', async () => {
    const user = userEvent.setup()
    mockLoginSuccess()
    server.use(http.get(url('/applications/7'), () => HttpResponse.json(makeDetail({ id: 7, company: 'Globex' }))))
    renderApp('/applications/7')

    await logIn(user)

    expect(await screen.findByRole('heading', { name: 'Globex' })).toBeInTheDocument()
  })

  it('works the same when logging in on the /login page', async () => {
    const user = userEvent.setup()
    mockLoginSuccess()
    mockStats()
    // Land on /login carrying a return path, as a bounced visitor would.
    renderApp({ pathname: '/login', state: { from: '/dashboard' } })

    await logIn(user)

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('ignores a return path that points off-site or is malformed', async () => {
    const user = userEvent.setup()
    mockLoginSuccess()
    mockList([])
    mockUpcoming()
    renderApp({ pathname: '/', state: { from: '//evil.example.com/phish' } })

    await logIn(user)

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
  })

  it('explains an expired session on the landing page form', async () => {
    const user = userEvent.setup()
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/applications')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Filter by status' }), 'offer')

    // The page loaded fine; now the server stops accepting the token.
    server.use(http.get(url('/applications'), () => HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 })))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'applied')

    expect(await screen.findByRole('heading', { level: 1, name: 'A logbook for your job search' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/session has expired/i)
  })
})

describe('/login and /signup still work', () => {
  it('/login shows the login form on its own page', async () => {
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'A logbook for your job search' })).not.toBeInTheDocument()
  })

  it('/login sends a logged-in user to /applications', async () => {
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
  })
})
