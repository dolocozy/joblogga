import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localToday } from '../dates'
import { SETTLE_MS } from '../hooks'
import { server } from '../test/server'
import { makeDetail, renderApp, signIn, url } from '../test/helpers'

beforeEach(() => signIn())
afterEach(() => vi.useRealTimers())

// Lets the "wait for a pause" timer elapse (see useFieldErrors).
const pause = () => act(async () => void vi.advanceTimersByTime(SETTLE_MS + 50))
const typing = () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

describe('add application form', () => {
  it('sends blanks as null, salary as numbers, and defaults date and status', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.post(url('/applications'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeDetail({ id: 7 }), { status: 201 })
      }),
      http.get(url('/applications/7'), () => HttpResponse.json(makeDetail({ id: 7 }))),
    )
    renderApp('/applications/new')

    await user.type(await screen.findByLabelText('Company'), '  Acme  ')
    await user.type(screen.getByLabelText('Role'), 'Engineer')
    await user.type(screen.getByLabelText('Salary min'), '90000')
    await user.type(screen.getByLabelText('Salary max'), '120000')
    await user.click(screen.getByRole('button', { name: 'Add application' }))

    // Redirected to the new application's page.
    expect(await screen.findByRole('heading', { name: /Acme/ })).toBeInTheDocument()
    expect(body).toEqual({
      company: 'Acme', // trimmed
      role: 'Engineer',
      job_url: null,
      date_applied: localToday(),
      resume_version: null,
      salary_min: 90000, // a number, not "90000"
      salary_max: 120000,
      location: null,
      work_mode: null, // left unset unless chosen: nothing is guessed
      notes: null,
      status: 'applied',
      follow_up_date: null,
    })
  })

  it('sends the chosen status, resume version and notes', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.post(url('/applications'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeDetail({ id: 8 }), { status: 201 })
      }),
      http.get(url('/applications/8'), () => HttpResponse.json(makeDetail({ id: 8 }))),
    )
    renderApp('/applications/new')

    await user.type(await screen.findByLabelText('Company'), 'Acme')
    await user.type(screen.getByLabelText('Role'), 'Engineer')
    await user.selectOptions(screen.getByLabelText('Status'), 'screening')
    await user.type(screen.getByLabelText('Resume version'), 'tech-focused')
    await user.type(screen.getByLabelText('Notes'), 'Referred by Sam')
    await user.click(screen.getByRole('button', { name: 'Add application' }))

    await screen.findByRole('heading', { name: /Acme/ })
    expect(body).toMatchObject({ status: 'screening', resume_version: 'tech-focused', notes: 'Referred by Sam' })
  })

  it('does not submit without the required fields, and says what is missing under each one', async () => {
    const user = userEvent.setup()
    let posts = 0
    server.use(
      http.post(url('/applications'), () => {
        posts++
        return HttpResponse.json(makeDetail(), { status: 201 })
      }),
    )
    renderApp('/applications/new')

    await user.click(await screen.findByRole('button', { name: 'Add application' }))

    expect(posts).toBe(0)
    expect(screen.getByText('Enter the company name')).toBeInTheDocument()
    expect(screen.getByText('Enter the role')).toBeInTheDocument()
    expect(screen.getByLabelText('Company')).toBeInvalid()
    expect(screen.getByLabelText('Company')).toHaveFocus() // focus goes to the first problem
  })

  it('shows server validation errors and lets the user fix and retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(url('/applications'), () =>
        HttpResponse.json({ detail: [{ msg: 'Value error, Job link must start with http:// or https://' }] }, { status: 422 }),
      ),
    )
    renderApp('/applications/new')

    await user.type(await screen.findByLabelText('Company'), 'Acme')
    await user.type(screen.getByLabelText('Role'), 'Engineer')
    await user.click(screen.getByRole('button', { name: 'Add application' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Job link must start with http:// or https://')
    expect(screen.getByLabelText('Company')).toHaveValue('Acme') // input is kept
    expect(screen.getByRole('button', { name: 'Add application' })).toBeEnabled()
  })

  it('turns the browser popups off on the form', async () => {
    renderApp('/applications/new')
    await screen.findByLabelText('Company')
    expect(document.querySelector('form')).toHaveAttribute('novalidate')
  })
})

describe('add application: inline validation', () => {
  const fieldMessage = (label: string) => screen.getByLabelText(label).getAttribute('aria-describedby')

  it('starts with no errors, and marks the required fields', async () => {
    renderApp('/applications/new')
    await screen.findByLabelText('Company')
    expect(screen.getByLabelText('Company')).not.toBeInvalid()
    expect(screen.getByLabelText('Role')).not.toBeInvalid()
    expect(screen.getAllByText('required')).toHaveLength(3) // company, role, date applied
  })

  it('flags an empty required field when you leave it', async () => {
    const user = userEvent.setup()
    renderApp('/applications/new')

    await user.click(await screen.findByLabelText('Company'))
    await user.tab()

    expect(screen.getByText('Enter the company name')).toBeInTheDocument()
    expect(screen.getByLabelText('Role')).not.toBeInvalid() // untouched fields stay quiet
  })

  it('clears a required-field error as soon as you type', async () => {
    const user = userEvent.setup()
    renderApp('/applications/new')
    await user.click(await screen.findByLabelText('Company'))
    await user.tab()
    expect(screen.getByText('Enter the company name')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Company'), 'A')

    expect(screen.queryByText('Enter the company name')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Company')).not.toBeInvalid()
  })

  it('treats a company of only spaces as empty', async () => {
    const user = userEvent.setup()
    renderApp('/applications/new')
    await user.type(await screen.findByLabelText('Company'), '   ')
    expect(screen.getByText('Enter the company name')).toBeInTheDocument()
  })

  it('rejects a job link that is not http(s), once you pause typing', async () => {
    const user = typing()
    renderApp('/applications/new')
    const link = await screen.findByLabelText('Job posting link')

    await user.type(link, 'javascript:alert(1)')
    expect(screen.queryByText(/start the link/i)).not.toBeInTheDocument()
    await pause()
    expect(screen.getByText('Start the link with http:// or https://')).toBeInTheDocument()

    await user.clear(link)
    await user.type(link, 'https://example.com/job')
    expect(screen.queryByText(/start the link/i)).not.toBeInTheDocument()
  })

  it('does not complain about a link while it is being typed', async () => {
    const user = typing()
    renderApp('/applications/new')
    const link = await screen.findByLabelText('Job posting link')

    for (const char of 'https://exam') {
      await user.type(link, char) // "h", "ht", "htt"... are all unfinished
      expect(screen.queryByText(/start the link/i)).not.toBeInTheDocument()
    }
    await user.type(link, 'ple.com')
    await pause()
    expect(screen.queryByText(/start the link/i)).not.toBeInTheDocument()
  })

  it('requires the date applied', async () => {
    renderApp('/applications/new')
    const date = await screen.findByLabelText('Date applied')

    fireEvent.change(date, { target: { value: '' } })

    expect(screen.getByText('Enter the date you applied')).toBeInTheDocument()
  })

  it('only accepts whole numbers for salary', async () => {
    const user = typing()
    renderApp('/applications/new')

    await user.type(await screen.findByLabelText('Salary min'), '90k')
    await pause()

    expect(screen.getByText('Enter a whole number, 0 or more')).toBeInTheDocument()
    expect(fieldMessage('Salary min')).toBeTruthy()
  })

  it('checks max salary against min salary, whichever one you edit last', async () => {
    const user = typing()
    renderApp('/applications/new')
    const min = await screen.findByLabelText('Salary min')
    const max = screen.getByLabelText('Salary max')

    await user.type(min, '90000')
    await user.type(max, '70000')
    await pause()
    expect(screen.getByText('Max salary cannot be lower than min salary')).toBeInTheDocument()

    // Lowering the min fixes it; the max message updates without touching the max.
    await user.clear(min)
    await user.type(min, '60000')
    expect(screen.queryByText(/cannot be lower/i)).not.toBeInTheDocument()
  })

  it('does not say the max is too low while a larger number is still being typed', async () => {
    const user = typing()
    renderApp('/applications/new')
    await user.type(await screen.findByLabelText('Salary min'), '90000')
    const max = screen.getByLabelText('Salary max')

    for (const digit of '100000') {
      await user.type(max, digit) // "1", "10", "100"... are each below 90000
      expect(screen.queryByText(/cannot be lower/i)).not.toBeInTheDocument()
    }
    await pause()
    expect(screen.queryByText(/cannot be lower/i)).not.toBeInTheDocument() // 100000 is fine
  })

  it('does not compare salaries when the min is not a number yet', async () => {
    const user = typing()
    renderApp('/applications/new')
    await user.type(await screen.findByLabelText('Salary min'), 'abc')
    await user.type(screen.getByLabelText('Salary max'), '5')
    await pause()

    expect(screen.queryByText(/cannot be lower/i)).not.toBeInTheDocument()
  })

  it('on a failed submit, shows all errors and focuses the first problem field', async () => {
    const user = userEvent.setup()
    let posts = 0
    server.use(
      http.post(url('/applications'), () => {
        posts++
        return HttpResponse.json(makeDetail(), { status: 201 })
      }),
    )
    renderApp('/applications/new')
    await user.type(await screen.findByLabelText('Company'), 'Acme')
    await user.type(screen.getByLabelText('Role'), 'Engineer')
    await user.type(screen.getByLabelText('Job posting link'), 'nope')
    await user.type(screen.getByLabelText('Salary min'), 'x')

    await user.click(screen.getByRole('button', { name: 'Add application' }))

    expect(posts).toBe(0)
    expect(screen.getByLabelText('Job posting link')).toHaveFocus() // first bad field, in form order
    expect(screen.getByText('Start the link with http:// or https://')).toBeInTheDocument()
    expect(screen.getByText('Enter a whole number, 0 or more')).toBeInTheDocument()
  })

  it('submits once everything is valid', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.post(url('/applications'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeDetail({ id: 9 }), { status: 201 })
      }),
      http.get(url('/applications/9'), () => HttpResponse.json(makeDetail({ id: 9 }))),
    )
    renderApp('/applications/new')
    await user.type(await screen.findByLabelText('Company'), 'Acme')
    await user.type(screen.getByLabelText('Role'), 'Engineer')
    await user.type(screen.getByLabelText('Job posting link'), 'https://example.com/j')
    await user.type(screen.getByLabelText('Salary min'), '50000')
    await user.type(screen.getByLabelText('Salary max'), '60000')
    await user.click(screen.getByRole('button', { name: 'Add application' }))

    await screen.findByRole('heading', { name: /Acme/ })
    expect(body).toMatchObject({ job_url: 'https://example.com/j', salary_min: 50000, salary_max: 60000 })
  })
})


describe('work mode on the form', () => {
  const submitWith = async (choose?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>) => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    server.use(
      http.post(url('/applications'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeDetail({ id: 9 }), { status: 201 })
      }),
      http.get(url('/applications/9'), () => HttpResponse.json(makeDetail({ id: 9 }))),
    )
    renderApp('/applications/new')
    await user.type(await screen.findByLabelText('Company'), 'Acme')
    await user.type(screen.getByLabelText('Role'), 'Engineer')
    await choose?.(user)
    await user.click(screen.getByRole('button', { name: 'Add application' }))
    await screen.findByRole('heading', { name: /Acme/ })
    return body as Record<string, unknown> | null
  }

  it('starts on "Not specified" and offers Remote, Hybrid and In person', async () => {
    renderApp('/applications/new')
    const select = await screen.findByLabelText('Work mode')
    expect(select).toHaveValue('')
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(['Not specified', 'Remote', 'Hybrid', 'In person'])
  })

  it.each([
    ['remote', 'Remote'],
    ['hybrid', 'Hybrid'],
    ['in_person', 'In person'],
  ])('sends %s when %s is chosen', async (value, label) => {
    const body = await submitWith((user) => user.selectOptions(screen.getByLabelText('Work mode'), label))
    expect(body).toMatchObject({ work_mode: value })
  })

  it('sends null when it is left alone', async () => {
    expect(await submitWith()).toMatchObject({ work_mode: null })
  })
})
