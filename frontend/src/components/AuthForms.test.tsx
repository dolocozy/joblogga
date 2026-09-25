import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SETTLE_MS } from '../hooks'
import { server } from '../test/server'
import { mockList, mockUpcoming, renderApp, url, USER } from '../test/helpers'

const email = () => screen.getByLabelText('Email')
const password = () => screen.getByLabelText('Password')

// Records requests to an endpoint so tests can assert whether a submit went out.
function watch(path: string, reply: () => Response) {
  const bodies: unknown[] = []
  server.use(
    http.post(url(path), async ({ request }) => {
      bodies.push(await request.json())
      return reply()
    }),
  )
  return bodies
}

// Lets the "wait for a pause" timer elapse (see useFieldErrors).
const pause = () => act(async () => void vi.advanceTimersByTime(SETTLE_MS + 50))

afterEach(() => vi.useRealTimers())

describe('inline validation replaces the browser popups', () => {
  it.each(['/login', '/signup'])('%s turns native validation off and stays quiet until used', async (route) => {
    renderApp(route)
    await screen.findByLabelText('Email')

    // noValidate means the browser never shows its own tooltip.
    expect(document.querySelector('form')).toHaveAttribute('novalidate')
    // A fresh form has no errors on it.
    expect(email()).not.toBeInvalid()
    expect(password()).not.toBeInvalid()
    // The password has no native length rule to trigger a popup either.
    expect(password()).not.toHaveAttribute('minlength')
  })

  // --- the email field no longer judges the format ---------------------------

  it.each(['/login', '/signup'])('%s never shows a format message, however long you wait or wherever focus goes', async (route) => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp(route)
    await screen.findByLabelText('Email')

    await user.type(email(), 'not-an-email')
    await act(async () => void vi.advanceTimersByTime(5000)) // a long pause
    await user.tab() // leaving the field

    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/name@example\.com/i)).not.toBeInTheDocument()
    // Not marked invalid by the app. (The browser's own check would call it a type mismatch, but noValidate
    // means the browser shows nothing for it.)
    expect(email()).not.toHaveAttribute('aria-invalid')
    expect(document.querySelector('form')).toHaveAttribute('novalidate')
  })

  it.each(['/login', '/signup'])('%s does not judge any half-typed address either', async (route) => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp(route)
    await screen.findByLabelText('Email')

    for (const char of 'me@example.') {
      await user.type(email(), char)
      expect(screen.queryByText(/enter an email address|name@example/i)).not.toBeInTheDocument()
    }
    await user.type(email(), 'com')
    await pause()
    expect(screen.queryByText(/enter an email address|name@example/i)).not.toBeInTheDocument()
  })

  const SERVER_SAYS = 'value is not a valid email address: An email address must have an @-sign.'
  const invalidEmailReply = () =>
    HttpResponse.json({ detail: [{ type: 'value_error', loc: ['body', 'email'], msg: SERVER_SAYS }] }, { status: 422 })

  it.each([
    ['/login', '/auth/login', 'Log in'],
    ['/signup', '/auth/signup', 'Sign up'],
  ])('%s sends a malformed address to the server on submit, and shows the server\'s answer', async (route, endpoint, button) => {
    const user = userEvent.setup()
    const bodies = watch(endpoint, invalidEmailReply)
    renderApp(route)
    await screen.findByLabelText('Email')

    await user.type(email(), 'not-an-email')
    await user.type(password(), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: button }))

    expect(await screen.findByRole('alert')).toHaveTextContent(SERVER_SAYS)
    expect(bodies).toHaveLength(1) // it was not blocked on the client
    expect(bodies[0]).toMatchObject({ email: 'not-an-email' })
    expect(screen.getByRole('button', { name: button })).toBeEnabled() // and they can correct it and go again
    expect(email()).toHaveValue('not-an-email')
  })

  // --- an EMPTY email is still asked for, with the same settled timing --------

  it('reports an emptied field once you pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'a')
    await user.clear(email())
    expect(screen.queryByText('Enter your email address')).not.toBeInTheDocument()
    await pause()

    expect(screen.getByText('Enter your email address')).toBeInTheDocument()
  })

  it('shows that, not sooner than 0.4s and not later than 1.5s after you stop', async () => {
    // Literal times, not SETTLE_MS: this pins what a person experiences.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'a')
    await user.clear(email())
    await act(async () => void vi.advanceTimersByTime(400))
    expect(screen.queryByText('Enter your email address')).not.toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(1100)) // 1.5s in total
    expect(screen.getByText('Enter your email address')).toBeInTheDocument()
  })

  it('a pending wait is dropped if something was typed in the meantime', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'a')
    await user.clear(email()) // empty: a wait begins
    await user.type(email(), 'b') // filled again before it ended
    await pause()

    expect(screen.queryByText('Enter your email address')).not.toBeInTheDocument()
  })

  it('goes the moment you type something', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/signup')
    await screen.findByLabelText('Email')
    await user.click(email())
    await user.tab() // left it empty: shown at once
    expect(screen.getByText('Enter your email address')).toBeInTheDocument()

    await user.type(email(), 'm')

    expect(screen.queryByText('Enter your email address')).not.toBeInTheDocument()
  })

  it('an empty field is reported at once on submit, and nothing is sent', async () => {
    const user = userEvent.setup()
    const bodies = watch('/auth/login', invalidEmailReply)
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(screen.getByText('Enter your email address')).toBeInTheDocument()
    expect(email()).toHaveFocus()
    expect(bodies).toEqual([])
  })

  it('ties each message to its field for screen readers', async () => {
    const user = userEvent.setup()
    renderApp('/signup')
    await screen.findByLabelText('Email')
    // The rule is a hint before there is anything to correct.
    expect(password()).toHaveAccessibleDescription('At least 8 characters.')

    await user.type(password(), 'abc')

    expect(password()).toHaveAttribute('aria-invalid', 'true')
    expect(password()).toHaveAccessibleDescription('Use at least 8 characters (3 so far)')
  })
})

describe('signup password rule', () => {
  it('starts as a hint and becomes a live count as you type', async () => {
    const user = userEvent.setup()
    renderApp('/signup')
    await screen.findByLabelText('Email')
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument()

    await user.type(password(), 'abc')
    expect(screen.getByText('Use at least 8 characters (3 so far)')).toBeInTheDocument()

    await user.type(password(), 'de')
    expect(screen.getByText('Use at least 8 characters (5 so far)')).toBeInTheDocument()
    expect(screen.queryByText(/3 so far/)).not.toBeInTheDocument() // updated, not stacked
  })

  it('clears the error, and shows the hint again, at exactly 8 characters', async () => {
    const user = userEvent.setup()
    renderApp('/signup')
    await screen.findByLabelText('Email')

    await user.type(password(), '1234567')
    expect(screen.getByText(/7 so far/)).toBeInTheDocument()
    await user.type(password(), '8')

    expect(screen.queryByText(/so far/)).not.toBeInTheDocument()
    expect(password()).not.toBeInvalid()
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument()
  })

  it('rejects a password over the 72-byte limit, counting bytes not characters', async () => {
    const user = userEvent.setup()
    renderApp('/signup')
    await screen.findByLabelText('Email')

    // 40 emoji is 40 characters but 160 bytes.
    await user.click(password())
    await user.paste('😀'.repeat(40))

    expect(screen.getByText(/at most 72 bytes/i)).toBeInTheDocument()
  })

  it('asks for a password if it is emptied after typing', async () => {
    const user = userEvent.setup()
    renderApp('/signup')
    await screen.findByLabelText('Email')

    await user.type(password(), 'a')
    await user.clear(password())

    expect(screen.getByText('Choose a password')).toBeInTheDocument()
  })
})

describe('submitting', () => {
  it('blocks an invalid submit, shows every error, and focuses the first bad field', async () => {
    const user = userEvent.setup()
    const bodies = watch('/auth/signup', () => HttpResponse.json(USER, { status: 201 }))
    renderApp('/signup')
    await screen.findByLabelText('Email')

    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(bodies).toHaveLength(0)
    expect(screen.getByText('Enter your email address')).toBeInTheDocument()
    expect(screen.getByText('Choose a password')).toBeInTheDocument()
    expect(email()).toHaveFocus()
  })

  it('focuses the password when only the password is bad', async () => {
    const user = userEvent.setup()
    watch('/auth/signup', () => HttpResponse.json(USER, { status: 201 }))
    renderApp('/signup')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@example.com')
    await user.type(password(), 'short')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(password()).toHaveFocus()
  })

  it('does not enforce a length on login (only signup sets that rule)', async () => {
    const user = userEvent.setup()
    const bodies = watch('/auth/login', () => HttpResponse.json({ detail: 'Incorrect email or password' }, { status: 401 }))
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@example.com')
    await user.type(password(), 'abc')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    // The short password went to the server, which is the judge of it.
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password')
    expect(bodies).toEqual([{ email: 'me@example.com', password: 'abc' }])
  })

  it('trims stray spaces around the email before sending', async () => {
    const user = userEvent.setup()
    const bodies = watch('/auth/login', () => HttpResponse.json({ detail: 'Incorrect email or password' }, { status: 401 }))
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), '  me@example.com  ')
    await user.type(password(), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    await screen.findByRole('alert')
    expect(bodies).toEqual([{ email: 'me@example.com', password: 'correct-horse-battery' }])
  })

  it('a valid signup goes through and lands in the app', async () => {
    const user = userEvent.setup()
    watch('/auth/signup', () => HttpResponse.json(USER, { status: 201 }))
    server.use(
      http.post(url('/auth/login'), () => HttpResponse.json({ access_token: 'tok' })),
      http.get(url('/auth/me'), () => HttpResponse.json(USER)),
    )
    mockList([])
    mockUpcoming()
    renderApp('/signup')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@example.com')
    await user.type(password(), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
  })
})

describe('a slow server (free hosting sleeps when idle)', () => {
  afterEach(() => vi.useRealTimers())

  async function submitWithHangingServer(route: string, button: string) {
    // Fake timers that still let real time flow, so the request machinery works.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    server.use(
      http.post(url(route === '/login' ? '/auth/login' : '/auth/signup'), async () => {
        await gate
        return HttpResponse.json({ detail: 'Incorrect email or password' }, { status: 401 })
      }),
    )
    renderApp(route)
    await screen.findByLabelText('Email')
    await user.type(email(), 'me@example.com')
    await user.type(password(), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: button }))
    return { release }
  }

  it.each([
    ['/login', 'Log in'],
    ['/signup', 'Sign up'],
  ])('%s explains the wait once it has gone on a few seconds', async (route, button) => {
    const { release } = await submitWithHangingServer(route, button)
    expect(screen.queryByText(/waking the server/i)).not.toBeInTheDocument() // not straight away

    await act(async () => {
      vi.advanceTimersByTime(3100)
    })

    expect(screen.getByText(/waking the server/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled()

    release()
    await screen.findByRole('alert') // finishes; the note goes away
    expect(screen.queryByText(/waking the server/i)).not.toBeInTheDocument()
  })
})

describe('when the server says too many attempts (429)', () => {
  const TOO_MANY = 'Too many attempts. Try again in 15 minutes.'
  const tooMany = () => HttpResponse.json({ detail: TOO_MANY }, { status: 429, headers: { 'Retry-After': '900' } })

  it('login shows the wait message and can be retried later', async () => {
    const user = userEvent.setup()
    watch('/auth/login', tooMany)
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@example.com')
    await user.type(password(), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(TOO_MANY)
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled() // not stuck
    expect(email()).toHaveValue('me@example.com') // input kept
  })

  it('signup shows it too', async () => {
    const user = userEvent.setup()
    watch('/auth/signup', tooMany)
    renderApp('/signup')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@example.com')
    await user.type(password(), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(TOO_MANY)
  })

  it('is not mistaken for an expired session', async () => {
    const user = userEvent.setup()
    watch('/auth/login', tooMany)
    renderApp('/')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@example.com')
    await user.type(password(), 'correct-horse-battery')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    await screen.findByRole('alert')
    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument()
  })
})
