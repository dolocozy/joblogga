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

  it('shows an email error as you type, once you pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/signup')
    await screen.findByLabelText('Email')

    await user.type(email(), 'not-an-email')
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument() // still typing: nothing yet

    await pause()
    expect(screen.getByText('Enter an email address like name@example.com')).toBeInTheDocument()
    expect(email()).toBeInvalid()

    // Once shown it follows the value, and goes the moment it is valid, with no wait.
    await user.clear(email())
    await user.type(email(), 'me@example.com')
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
    expect(email()).not.toBeInvalid()
  })

  it.each(['/login', '/signup'])('%s does not nag while an address is still being typed', async (route) => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp(route)
    await screen.findByLabelText('Email')

    // Every prefix of an address is an unfinished, so invalid, address.
    for (const char of 'me@example.') {
      await user.type(email(), char)
      expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
    }
    // ...and finishing it never shows an error at all.
    await user.type(email(), 'com')
    await pause()
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
    expect(email()).toHaveValue('me@example.com')
  })

  it('is quick enough to notice, and slow enough not to nag: shown between 0.4 and 1.5 seconds after you stop', async () => {
    // Literal times, not SETTLE_MS: this pins what a person experiences.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@ex')
    await act(async () => void vi.advanceTimersByTime(400))
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
    await act(async () => void vi.advanceTimersByTime(1100)) // 1.5s in total
    expect(screen.getByText(/enter an email address/i)).toBeInTheDocument()
  })

  it('needs a real pause: every keystroke restarts the wait', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@')
    await act(async () => void vi.advanceTimersByTime(SETTLE_MS - 200))
    await user.type(email(), 'ex') // typing again, 600ms in
    await act(async () => void vi.advanceTimersByTime(SETTLE_MS - 200))
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument() // 1200ms since the first key, but only 600 since the last

    await act(async () => void vi.advanceTimersByTime(300))
    expect(screen.getByText(/enter an email address/i)).toBeInTheDocument()
  })

  it('hides an error you were shown while you type again, and brings it back after the next pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@')
    await pause()
    expect(screen.getByText(/enter an email address/i)).toBeInTheDocument() // told once

    await user.type(email(), 'ex') // typing again: no flicker through every keystroke
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
    await user.type(email(), 'ample') // still unfinished
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()

    await pause()
    expect(screen.getByText(/enter an email address/i)).toBeInTheDocument() // back, since it is still not an address
    await user.type(email(), '.com')
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
  })

  it('an error shown by a failed submit also steps aside while you fix it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/login')
    await screen.findByLabelText('Email')
    await user.type(email(), 'nope')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(screen.getByText(/enter an email address/i)).toBeInTheDocument()

    await user.type(email(), '@')

    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
  })

  it('shows the error at once when you leave a half-typed address', async () => {
    const user = userEvent.setup()
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@exa')
    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
    await user.tab()

    expect(screen.getByText('Enter an email address like name@example.com')).toBeInTheDocument()
  })

  it('a pending wait is dropped if the address became valid in the meantime', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.type(email(), 'me@example.co') // not finished
    await user.type(email(), 'm') // finished, before the pause ended
    await pause()

    expect(screen.queryByText(/enter an email address/i)).not.toBeInTheDocument()
  })

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

  it('shows an error when a field is left empty (on blur)', async () => {
    const user = userEvent.setup()
    renderApp('/login')
    await screen.findByLabelText('Email')

    await user.click(email())
    await user.tab() // leave it empty

    expect(screen.getByText('Enter your email address')).toBeInTheDocument()
    // The password wasn't touched, so it says nothing yet.
    expect(screen.queryByText('Enter your password')).not.toBeInTheDocument()
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
