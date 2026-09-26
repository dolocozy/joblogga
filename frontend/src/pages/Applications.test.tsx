import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatIsoDate, localToday } from '../dates'
import { saveFile } from '../download'
import { server } from '../test/server'
import { makeApplication, manyApplications, mockList, mockUpcoming, renderApp, signIn, url } from '../test/helpers'

// The real saveFile clicks a hidden link; here we only need to know it was asked to.
vi.mock('../download', () => ({ saveFile: vi.fn() }))

beforeEach(() => {
  signIn()
  mockUpcoming()
  vi.mocked(saveFile).mockClear()
})

const lastParams = (seen: URL[]) => Object.fromEntries(seen.at(-1)!.searchParams)

describe('list', () => {
  it('shows applications with company, role, location, status and date', async () => {
    mockList([makeApplication({ company: 'Globex', role: 'Analyst', location: 'Remote', status: 'interview' })])
    renderApp('/applications')

    expect(await screen.findByText('Globex')).toBeInTheDocument()
    expect(screen.getByText('Analyst, Remote')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Status for Globex' })).toHaveValue('interview')
    expect(screen.getByText(/showing 1–1 of 1/i)).toBeInTheDocument()
  })

  it('links each row to its detail page', async () => {
    mockList([makeApplication({ id: 42, company: 'Globex' })])
    renderApp('/applications')
    expect(await screen.findByRole('link', { name: /Globex/ })).toHaveAttribute('href', '/applications/42')
  })

  it('shows a first-run empty state with a link to add one', async () => {
    mockList([])
    renderApp('/applications')
    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /add your first one/i })).toBeInTheDocument()
  })

  it('shows an error if the list cannot be loaded', async () => {
    server.use(http.get(url('/applications'), () => HttpResponse.json({ detail: 'Server exploded' }, { status: 500 })))
    renderApp('/applications')
    expect(await screen.findByRole('alert')).toHaveTextContent('Server exploded')
  })
})

describe('filters', () => {
  it('sends the search text, debounced (not one request per keystroke)', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/applications')
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
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)

    await user.type(screen.getByRole('searchbox', { name: 'Company' }), 'glob')

    await waitFor(() => expect(lastParams(seen).company).toBe('glob'))
  })

  it('sends the status filter immediately', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'rejected')

    await waitFor(() => expect(lastParams(seen).status).toBe('rejected'))
  })

  it('sends the date range', async () => {
    const seen = mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)

    fireEvent.change(screen.getByLabelText('Applied from'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('to'), { target: { value: '2026-02-01' } })

    await waitFor(() => expect(lastParams(seen)).toMatchObject({ date_from: '2026-01-01', date_to: '2026-02-01' }))
  })

  it('warns when the start date is after the end date', async () => {
    mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)

    fireEvent.change(screen.getByLabelText('Applied from'), { target: { value: '2026-05-01' } })
    fireEvent.change(screen.getByLabelText('to'), { target: { value: '2026-02-01' } })

    expect(await screen.findByText(/start date is after the end date/i)).toBeInTheDocument()
  })

  it('shows a "no matches" state when filters exclude everything, and Clear filters resets', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'offer')
    expect(await screen.findByText(/no applications match your filters/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    await waitFor(() => expect(seen.at(-1)!.searchParams.getAll('status')).toHaveLength(8)) // back to every applied status
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })
})

describe('pagination', () => {
  it('shows one page at a time with position and page count', async () => {
    mockList(manyApplications(45))
    renderApp('/applications')

    expect(await screen.findByText('Company 1')).toBeInTheDocument()
    expect(screen.queryByText('Company 21')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1–20 of 45')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  })

  it('moves forward and back, disabling Next on the last page', async () => {
    const user = userEvent.setup()
    const seen = mockList(manyApplications(45))
    renderApp('/applications')
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
    renderApp('/applications')
    await screen.findByText('Company 1')
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  })

  it('returns to page 1 when a filter changes', async () => {
    const user = userEvent.setup()
    const seen = mockList(manyApplications(45))
    renderApp('/applications')
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
    renderApp('/applications')
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
    renderApp('/applications')

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
    renderApp('/applications')
    expect(await screen.findByText('Follow-ups due soon')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status for Globex' }), 'rejected')

    await waitFor(() => expect(screen.queryByText('Follow-ups due soon')).not.toBeInTheDocument())
  })

  it('shows the error and keeps the old status when the change fails', async () => {
    const user = userEvent.setup()
    mockList([makeApplication({ id: 5, company: 'Globex', status: 'applied' })])
    server.use(http.patch(url('/applications/5'), () => HttpResponse.json({ detail: 'Nope' }, { status: 500 })))
    renderApp('/applications')

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Status for Globex' }), 'offer')

    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    expect(screen.getByRole('combobox', { name: 'Status for Globex' })).toHaveValue('applied')
    expect(screen.getByRole('combobox', { name: 'Status for Globex' })).toBeEnabled()
  })
})

describe('CSV export', () => {
  const CSV = 'Company,Role\r\nGlobex,Analyst\r\n'
  const mockExport = (seen: URL[] = []) => {
    server.use(
      http.get(url('/applications/export.csv'), ({ request }) => {
        seen.push(new URL(request.url))
        return new HttpResponse(CSV, { headers: { 'Content-Type': 'text/csv' } })
      }),
    )
    return seen
  }

  it('is offered once there are applications', async () => {
    mockList([makeApplication({ company: 'Globex' })])
    renderApp('/applications')
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  })

  it('is not offered on a brand-new account with nothing to export', async () => {
    mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument()
  })

  it('downloads a dated file containing the exported data', async () => {
    const user = userEvent.setup()
    mockList([makeApplication({ company: 'Globex' })])
    mockExport()
    renderApp('/applications')

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))

    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1))
    const [blob, filename] = vi.mocked(saveFile).mock.calls[0]
    expect(filename).toBe(`joblogga-applications-${localToday()}.csv`)
    expect(await blob.text()).toBe(CSV)
  })

  it('exports everything, even while filters are applied', async () => {
    const user = userEvent.setup()
    mockList([makeApplication({ company: 'Globex' })])
    const seen = mockExport()
    renderApp('/applications')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Filter by status' }), 'applied')
    await screen.findByText('Globex')

    await user.click(screen.getByRole('button', { name: 'Export CSV' }))

    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0].search).toBe('') // no filters sent: it is a backup, not a report
  })

  it('stays available when the filters currently show no rows', async () => {
    const user = userEvent.setup()
    mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by status' }), 'offer')

    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  })

  it('shows progress and blocks a second click while the file is being prepared', async () => {
    const user = userEvent.setup()
    mockList([makeApplication({ company: 'Globex' })])
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    server.use(
      http.get(url('/applications/export.csv'), async () => {
        await gate
        return new HttpResponse(CSV, { headers: { 'Content-Type': 'text/csv' } })
      }),
    )
    renderApp('/applications')

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))

    const busy = await screen.findByRole('button', { name: 'Exporting…' })
    expect(busy).toBeDisabled()
    release()
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeEnabled()
  })

  it('shows the error and downloads nothing when the export fails', async () => {
    const user = userEvent.setup()
    mockList([makeApplication({ company: 'Globex' })])
    server.use(http.get(url('/applications/export.csv'), () => HttpResponse.json({ detail: 'Export failed' }, { status: 500 })))
    renderApp('/applications')

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Export failed')
    expect(saveFile).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled() // can retry
  })
})

describe('follow-up column', () => {
  it('highlights an overdue follow-up on an open application, with the word "overdue"', async () => {
    mockList([makeApplication({ id: 1, company: 'Globex', status: 'screening', follow_up_date: '2000-01-01' })])
    renderApp('/applications')

    const row = (await screen.findByText('Globex')).closest('li')!
    const mark = row.querySelector('mark')
    expect(mark).toHaveTextContent('Jan 1, 2000')
    expect(row).toHaveTextContent(/overdue/i)
  })

  it('does not flag a follow-up that is still in the future, or has no date', async () => {
    mockList([
      makeApplication({ id: 1, company: 'Future', follow_up_date: '2999-01-01' }),
      makeApplication({ id: 2, company: 'Nodate', follow_up_date: null }),
    ])
    renderApp('/applications')
    await screen.findByText('Future')

    expect(document.querySelector('mark')).toBeNull()
    expect(screen.getByText('Nodate').closest('li')).toHaveTextContent('None')
  })

  it('never calls a closed application overdue: rejected, withdrawn, or an offer already decided', async () => {
    mockList([
      makeApplication({ id: 1, company: 'Nope', status: 'rejected', follow_up_date: '2000-01-01' }),
      makeApplication({ id: 2, company: 'Left', status: 'withdrawn', follow_up_date: '2000-01-01' }),
      makeApplication({ id: 3, company: 'Took', status: 'offer_accepted', follow_up_date: '2000-01-01' }),
      makeApplication({ id: 4, company: 'Passed', status: 'offer_declined', follow_up_date: '2000-01-01' }),
    ])
    renderApp('/applications')
    await screen.findByText('Nope')

    expect(document.querySelector('mark')).toBeNull()
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument()
  })
})

describe('follow-up reminders panel', () => {
  it('flags overdue follow-ups and links to the application', async () => {
    mockList([])
    mockUpcoming([
      makeApplication({ id: 9, company: 'Overdue Inc', follow_up_date: '2000-01-01' }),
      makeApplication({ id: 10, company: 'Future LLC', follow_up_date: '2999-01-01' }),
    ])
    renderApp('/applications')

    const panel = (await screen.findByText('Follow-ups due soon')).closest('section')!
    const rows = within(panel).getAllByRole('listitem')
    expect(within(rows[0]).getByRole('link')).toHaveAttribute('href', '/applications/9')
    expect(rows[0]).toHaveTextContent(/overdue/i)
    expect(rows[1]).not.toHaveTextContent(/overdue/i)
  })

  it('is hidden when there is nothing due', async () => {
    mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)
    expect(screen.queryByText('Follow-ups due soon')).not.toBeInTheDocument()
  })
})

describe('work mode on the list', () => {
  it('shows it after the location, as part of the same phrase', async () => {
    mockList([makeApplication({ id: 1, company: 'Globex', role: 'Analyst', location: 'Portland', work_mode: 'hybrid' })])
    renderApp('/applications')
    expect(await screen.findByText('Analyst, Portland, Hybrid')).toBeInTheDocument()
  })

  it.each([
    ['remote', 'Analyst, Remote'],
    ['in_person', 'Analyst, In person'],
  ] as const)('shows %s even with no location', async (mode, text) => {
    mockList([makeApplication({ role: 'Analyst', location: null, work_mode: mode })])
    renderApp('/applications')
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('shows nothing for an application with no work mode, not a placeholder', async () => {
    mockList([makeApplication({ role: 'Analyst', location: 'Portland', work_mode: null })])
    renderApp('/applications')
    expect(await screen.findByText('Analyst, Portland')).toBeInTheDocument()
    expect(screen.queryByText(/not specified/i, { selector: 'span' })).not.toBeInTheDocument()
  })
})

describe('the work mode filter', () => {
  it('starts on all modes and sends nothing', async () => {
    const seen = mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)

    expect(screen.getByRole('combobox', { name: 'Filter by work mode' })).toHaveValue('')
    expect(lastParams(seen)).not.toHaveProperty('work_mode')
  })

  it('offers every mode and sends the chosen one straight away', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)
    const select = screen.getByRole('combobox', { name: 'Filter by work mode' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All modes', 'Remote', 'Hybrid', 'In person'])

    await user.selectOptions(select, 'Hybrid')

    await waitFor(() => expect(lastParams(seen).work_mode).toBe('hybrid'))
  })

  it('goes back to the first page when it changes, like the other filters', async () => {
    const user = userEvent.setup()
    const seen = mockList(manyApplications(45))
    renderApp('/applications')
    await screen.findByText('Company 1')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastParams(seen).offset).toBe('20'))

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by work mode' }), 'Remote')

    await waitFor(() => expect(lastParams(seen)).toMatchObject({ work_mode: 'remote', offset: '0' }))
  })

  it('counts as an active filter: says nothing matched, and Clear filters resets it', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by work mode' }), 'Remote')
    expect(await screen.findByText('No applications match your filters.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('combobox', { name: 'Filter by work mode' })).toHaveValue('')
    await waitFor(() => expect(lastParams(seen)).not.toHaveProperty('work_mode'))
  })

  it('also applies on the board, where the status filter does not', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/applications?view=board')
    await screen.findByText(/no applications yet/i)

    expect(screen.queryByRole('combobox', { name: 'Filter by status' })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by work mode' }), 'Remote')

    await waitFor(() => expect(lastParams(seen)).toMatchObject({ work_mode: 'remote', limit: '200' }))
  })
})

describe('the posting link on the list', () => {
  it('is one click from the row, opening the posting in a new tab without leaving the logbook', async () => {
    mockList([makeApplication({ id: 7, company: 'Globex', job_url: 'https://jobs.example.com/globex/7' })])
    renderApp('/applications')

    const link = await screen.findByRole('link', { name: 'View posting for Globex' })
    expect(link).toHaveAttribute('href', 'https://jobs.example.com/globex/7')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('is a separate link from the one to the detail page, which still works', async () => {
    mockList([makeApplication({ id: 7, company: 'Globex', job_url: 'https://jobs.example.com/globex/7' })])
    renderApp('/applications')

    const detail = await screen.findByRole('link', { name: /^Globex/ })
    expect(detail).toHaveAttribute('href', '/applications/7')
    expect(detail).not.toContainElement(screen.getByRole('link', { name: 'View posting for Globex' })) // never nested
  })

  it('appears only on applications that have a link, and leaves no dead link on the others', async () => {
    mockList([
      makeApplication({ id: 1, company: 'Has', job_url: 'https://jobs.example.com/1' }),
      makeApplication({ id: 2, company: 'Lacks', job_url: null }),
    ])
    renderApp('/applications')
    await screen.findByText('Lacks')

    expect(screen.getAllByRole('link', { name: /View posting/ })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'View posting for Has' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'View posting for Lacks' })).not.toBeInTheDocument()
  })

  it('never renders a javascript: link, even if one somehow reached the database', async () => {
    mockList([makeApplication({ id: 1, company: 'Sneaky', job_url: 'javascript:alert(1)' })])
    renderApp('/applications')
    await screen.findByText('Sneaky')

    expect(screen.queryByRole('link', { name: /View posting/ })).not.toBeInTheDocument()
    expect(document.querySelector('a[href^="javascript"]')).toBeNull()
  })
})

describe('saved jobs', () => {
  const statusParams = (seen: URL[]) => seen.at(-1)!.searchParams.getAll('status')

  it('the list is the jobs you have applied to: it asks for every status except Saved', async () => {
    const seen = mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)

    expect(statusParams(seen)).toEqual(['applied', 'screening', 'interview', 'offer', 'offer_accepted', 'offer_declined', 'rejected', 'withdrawn'])
    const options = within(screen.getByRole('combobox', { name: 'Filter by status' })).getAllByRole('option')
    expect(options.map((o) => o.textContent)).not.toContain('Saved')
  })

  it('has a Saved view beside List and Board, kept in the address so a refresh stays there', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)
    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: 'Saved' }))

    expect(screen.getByRole('button', { name: 'Saved' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(statusParams(seen)).toEqual(['saved']))
  })

  it('opens straight onto the saved jobs from ?view=saved', async () => {
    const seen = mockList([])
    renderApp('/applications?view=saved')
    await screen.findByText(/no saved jobs yet/i)
    expect(statusParams(seen)).toEqual(['saved'])
  })

  it('has no status or date filters there, since saved jobs have neither an applied date nor other statuses', async () => {
    mockList([])
    renderApp('/applications?view=saved')
    await screen.findByText(/no saved jobs yet/i)

    expect(screen.queryByRole('combobox', { name: 'Filter by status' })).not.toBeInTheDocument()
    expect(screen.queryByText('Applied from')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Filter by work mode' })).toBeInTheDocument() // the rest still apply
  })

  it('does not send a date range that was set on the list once you are on Saved', async () => {
    const user = userEvent.setup()
    const seen = mockList([])
    renderApp('/applications')
    await screen.findByText(/no applications yet/i)
    fireEvent.change(screen.getByLabelText('Applied from'), { target: { value: '2026-01-01' } })
    await waitFor(() => expect(seen.at(-1)!.searchParams.get('date_from')).toBe('2026-01-01'))

    await user.click(screen.getByRole('button', { name: 'Saved' }))

    await waitFor(() => expect(statusParams(seen)).toEqual(['saved']))
    expect(seen.at(-1)!.searchParams.has('date_from')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument() // an invisible filter is not "active"
  })

  it('shows each saved job with the date it was saved, not an applied date', async () => {
    mockList([makeApplication({ id: 1, company: 'Wish Co', status: 'saved', date_applied: null, created_at: '2026-02-10T12:00:00Z' })])
    renderApp('/applications?view=saved')

    const row = (await screen.findByText('Wish Co')).closest('li')!
    expect(row).toHaveTextContent(formatIsoDate('2026-02-10T12:00:00Z'))
    expect(within(row).getByRole('combobox', { name: 'Status for Wish Co' })).toHaveValue('saved')
    expect(screen.getAllByText('Apply by').length).toBeGreaterThan(0) // the follow-up column is called what it means here
    expect(screen.queryByText('Follow up')).not.toBeInTheDocument()
  })

  it('"Mark applied" moves the job to Applied in one click and it leaves the saved view', async () => {
    const user = userEvent.setup()
    const patches: unknown[] = []
    let all = [makeApplication({ id: 5, company: 'Wish Co', status: 'saved' as const, date_applied: null })]
    server.use(
      http.get(url('/applications'), () => HttpResponse.json({ items: all.filter((a) => a.status === 'saved'), total: all.filter((a) => a.status === 'saved').length })),
      http.patch(url('/applications/5'), async ({ request }) => {
        patches.push(await request.json())
        all = all.map((a) => ({ ...a, status: 'applied' as const, date_applied: '2026-05-05' }))
        return HttpResponse.json({ ...all[0], history: [] })
      }),
    )
    renderApp('/applications?view=saved')

    await user.click(await screen.findByRole('button', { name: 'Mark Wish Co as applied' }))

    expect(patches).toEqual([{ status: 'applied' }]) // the server fills in today's date
    expect(await screen.findByText(/no saved jobs yet/i)).toBeInTheDocument()
  })

  it('offers "Mark applied" only in the saved view', async () => {
    mockList([makeApplication({ id: 1, company: 'Acme', status: 'applied' })])
    renderApp('/applications')
    await screen.findByText('Acme')
    expect(screen.queryByRole('button', { name: /Mark .* as applied/ })).not.toBeInTheDocument()
  })

  it('the add button becomes "Save a job", which opens the form already on Saved', async () => {
    mockList([])
    renderApp('/applications?view=saved')
    await screen.findByText(/no saved jobs yet/i)
    expect(screen.getByRole('link', { name: 'Save a job' })).toHaveAttribute('href', '/applications/new?status=saved')
    expect(screen.getByRole('link', { name: 'Save it here' })).toHaveAttribute('href', '/applications/new?status=saved')
  })

  it('the board has a Saved column first', async () => {
    mockList([makeApplication({ id: 1, company: 'Wish Co', status: 'saved', date_applied: null, created_at: '2026-02-10T12:00:00Z' })])
    renderApp('/applications?view=board')

    const column = await screen.findByRole('region', { name: /^Saved,/ })
    expect(column).toHaveAccessibleName('Saved, 1')
    expect(within(column).getByText(/^Saved /, { selector: 'p' })).toHaveTextContent(formatIsoDate('2026-02-10T12:00:00Z'))
  })
})
