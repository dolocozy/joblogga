import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { makeApplication, manyApplications, mockList, mockUpcoming, renderApp, signIn, url } from '../test/helpers'

beforeEach(() => {
  signIn()
  mockUpcoming()
})

const lastParams = (seen: URL[]) => Object.fromEntries(seen.at(-1)!.searchParams)

describe('list', () => {
  it('shows applications with company, role, location, status and date', async () => {
    mockList([makeApplication({ company: 'Globex', role: 'Analyst', location: 'Remote', status: 'interview' })])
    renderApp('/')

    expect(await screen.findByText('Globex')).toBeInTheDocument()
    expect(screen.getByText('Analyst · Remote')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status for Globex' })).toHaveValue('interview')
    expect(screen.getByText(/showing 1–1 of 1/i)).toBeInTheDocument()
  })

  it('links each row to its detail page', async () => {
    mockList([makeApplication({ id: 42, company: 'Globex' })])
    renderApp('/')
    expect(await screen.findByRole('link', { name: /Globex/ })).toHaveAttribute('href', '/applications/42')
  })

  it('shows a first-run empty state with a link to add one', async () => {
    mockList([])
    renderApp('/')
    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /add your first one/i })).toBeInTheDocument()
  })

  it('shows an error if the list cannot be loaded', async () => {
    server.use(http.get(url('/applications'), () => HttpResponse.json({ detail: 'Server exploded' }, { status: 500 })))
    renderApp('/')
    expect(await screen.findByRole('alert')).toHaveTextContent('Server exploded')
  })
})

describe('filters', () => {
  it('sends the search text, debounced (not one request per keystroke)', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/')
    await screen.findByText(/no applications yet/i)

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'acme')

    await waitFor(() => expect(lastParams(seen).q).toBe('acme'))
    const qs = seen.map((u) => u.searchParams.get('q'))
    expect(qs).not.toContain('a')
    expect(qs).not.toContain('ac')
  })

  it('sends the company filter', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/')
    await screen.findByText(/no applications yet/i)

    await user.type(screen.getByRole('searchbox', { name: 'Company' }), 'glob')

    await waitFor(() => expect(lastParams(seen).company).toBe('glob'))
  })

  it('sends the status filter immediately', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/')
    await screen.findByText(/no applications yet/i)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'rejected')

    await waitFor(() => expect(lastParams(seen).status).toBe('rejected'))
  })

  it('sends the date range', async () => {
    const seen = mockList([])
    renderApp('/')
    await screen.findByText(/no applications yet/i)

    fireEvent.change(screen.getByLabelText('Applied from'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('to'), { target: { value: '2026-02-01' } })

    await waitFor(() => expect(lastParams(seen)).toMatchObject({ date_from: '2026-01-01', date_to: '2026-02-01' }))
  })

  it('warns when the start date is after the end date', async () => {
    mockList([])
    renderApp('/')
    await screen.findByText(/no applications yet/i)

    fireEvent.change(screen.getByLabelText('Applied from'), { target: { value: '2026-05-01' } })
    fireEvent.change(screen.getByLabelText('to'), { target: { value: '2026-02-01' } })

    expect(await screen.findByText(/start date is after the end date/i)).toBeInTheDocument()
  })

  it('shows a "no matches" state when filters exclude everything, and Clear filters resets', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/')
    await screen.findByText(/no applications yet/i)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'offer')
    expect(await screen.findByText(/no applications match your filters/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    await waitFor(() => expect(lastParams(seen).status).toBeUndefined())
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })
})

describe('pagination', () => {
  it('shows one page at a time with position and page count', async () => {
    mockList(manyApplications(45))
    renderApp('/')

    expect(await screen.findByText('Company 1')).toBeInTheDocument()
    expect(screen.queryByText('Company 21')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1–20 of 45')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  it('moves forward and back, disabling Next on the last page', async () => {
    const user = userEvent.setup()
    const seen = mockList(manyApplications(45))
    renderApp('/')
    await screen.findByText('Company 1')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Company 21')).toBeInTheDocument()
    expect(lastParams(seen)).toMatchObject({ limit: '20', offset: '20' })

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Company 45')).toBeInTheDocument()
    expect(screen.getByText('Showing 41–45 of 45')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('Company 21')).toBeInTheDocument()
  })

  it('hides pagination controls when everything fits on one page', async () => {
    mockList(manyApplications(5))
    renderApp('/')
    await screen.findByText('Company 1')
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  })

  it('returns to page 1 when a filter changes', async () => {
    const user = userEvent.setup()
    const seen = mockList(manyApplications(45))
    renderApp('/')
    await screen.findByText('Company 1')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Company 21')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'applied')

    await waitFor(() => expect(lastParams(seen)).toMatchObject({ status: 'applied', offset: '0' }))
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument()
  })

  it('steps back when the current page no longer exists', async () => {
    // e.g. you deleted the last item on page 2 in another tab.
    const user = userEvent.setup()
    const all = manyApplications(45)
    const seen: URL[] = []
    server.use(
      http.get(url('/applications'), ({ request }) => {
        const u = new URL(request.url)
        seen.push(u)
        const offset = Number(u.searchParams.get('offset'))
        if (offset === 20) return HttpResponse.json({ items: [], total: 20 }) // page 2 vanished
        return HttpResponse.json({ items: all.slice(offset, offset + 20), total: offset === 0 && seen.length > 1 ? 20 : 45 })
      }),
    )
    renderApp('/')
    await screen.findByText('Company 1')

    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(lastParams(seen).offset).toBe('0'))
    expect(await screen.findByText('Company 1')).toBeInTheDocument()
  })
})

describe('quick status change', () => {
  it('sends only the new status, then refreshes the list', async () => {
    const user = userEvent.setup()
    const all = [makeApplication({ id: 5, company: 'Globex', status: 'applied' })]
    const bodies: unknown[] = []
    mockList(all)
    server.use(
      http.patch(url('/applications/5'), async ({ request }) => {
        const body = (await request.json()) as { status: 'interview' }
        bodies.push(body)
        all[0] = { ...all[0], status: body.status }
        return HttpResponse.json({ ...all[0], history: [] })
      }),
    )
    renderApp('/')

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status for Globex' }), 'interview')

    expect(bodies).toEqual([{ status: 'interview' }])
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Status for Globex' })).toHaveValue('interview'))
  })

  it('refreshes the reminders panel too (a rejected application drops off it)', async () => {
    const user = userEvent.setup()
    const all = [makeApplication({ id: 5, company: 'Globex', follow_up_date: '2000-01-01' })]
    mockList(all)
    let upcoming = [all[0]]
    server.use(
      http.get(url('/applications/upcoming'), () => HttpResponse.json(upcoming)),
      http.patch(url('/applications/5'), () => {
        all[0] = { ...all[0], status: 'rejected' }
        upcoming = [] // the API excludes closed applications
        return HttpResponse.json({ ...all[0], history: [] })
      }),
    )
    renderApp('/')
    expect(await screen.findByText('Follow-ups due soon')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status for Globex' }), 'rejected')

    await waitFor(() => expect(screen.queryByText('Follow-ups due soon')).not.toBeInTheDocument())
  })

  it('shows the error and keeps the old status when the change fails', async () => {
    const user = userEvent.setup()
    mockList([makeApplication({ id: 5, company: 'Globex', status: 'applied' })])
    server.use(http.patch(url('/applications/5'), () => HttpResponse.json({ detail: 'Nope' }, { status: 500 })))
    renderApp('/')

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status for Globex' }), 'offer')

    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    expect(screen.getByRole('combobox', { name: 'Status for Globex' })).toHaveValue('applied')
    expect(screen.getByRole('combobox', { name: 'Status for Globex' })).toBeEnabled()
  })
})

describe('follow-up reminders panel', () => {
  it('flags overdue follow-ups and links to the application', async () => {
    mockList([])
    mockUpcoming([
      makeApplication({ id: 9, company: 'Overdue Inc', follow_up_date: '2000-01-01' }),
      makeApplication({ id: 10, company: 'Future LLC', follow_up_date: '2999-01-01' }),
    ])
    renderApp('/')

    const panel = (await screen.findByText('Follow-ups due soon')).closest('section')!
    const rows = within(panel).getAllByRole('listitem')
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/applications/9')
    expect(rows[0]).toHaveTextContent('Overdue')
    expect(rows[1]).not.toHaveTextContent('Overdue')
  })

  it('is hidden when there is nothing due', async () => {
    mockList([])
    renderApp('/')
    await screen.findByText(/no applications yet/i)
    expect(screen.queryByText('Follow-ups due soon')).not.toBeInTheDocument()
  })
})
