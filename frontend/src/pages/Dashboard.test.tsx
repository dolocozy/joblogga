import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { server } from '../test/server'
import { makeStats, mockList, mockStats, mockUpcoming, renderApp, signIn, url } from '../test/helpers'

beforeEach(() => signIn())

const heroValue = async () => (await screen.findByText('Response rate')).nextElementSibling as HTMLElement

describe('response rate', () => {
  it('shows the rate as a rounded percentage with the counts behind it', async () => {
    mockStats(makeStats({ response: { responded: 19, eligible: 23, rate: 19 / 23 } }))
    renderApp('/dashboard')

    expect(await heroValue()).toHaveTextContent('83%') // 82.6 rounds up
    expect(screen.getByText('19 of 23 heard back')).toBeInTheDocument()
  })

  it('shows a dash, not 0%, when nothing is eligible yet', async () => {
    mockStats(makeStats({ total: 3, response: { responded: 0, eligible: 0, rate: null } }))
    renderApp('/dashboard')

    expect(await heroValue()).toHaveTextContent('—')
    expect(screen.getByText('Nothing to measure yet')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('shows a genuine 0% when applications are eligible but nobody has replied', async () => {
    mockStats(makeStats({ response: { responded: 0, eligible: 5, rate: 0 } }))
    renderApp('/dashboard')

    expect(await heroValue()).toHaveTextContent('0%')
    expect(screen.getByText('0 of 5 heard back')).toBeInTheDocument()
  })

  it('explains the definition, including that Withdrawn is left out', async () => {
    mockStats()
    renderApp('/dashboard')
    const note = await screen.findByText(/counts screening, interview, offer and rejected/i)
    expect(note).toHaveTextContent(/withdrawn applications are left out entirely/i)
  })
})

describe('summary tiles', () => {
  it('shows totals, open applications (applied + screening + interview), and offers', async () => {
    mockStats(makeStats()) // total 10; applied 2, screening 3, interview 1, offer 1
    renderApp('/dashboard')
    await heroValue() // wait for the stats to load

    // Scoped to the page body: the header nav also has an "Applications" link.
    const page = within(screen.getByRole('main'))
    const tile = (label: string) => page.getByText(label, { selector: 'p' }).nextElementSibling
    expect(tile('Applications')).toHaveTextContent('10')
    expect(tile('Still open')).toHaveTextContent('6') // 2 + 3 + 1
    expect(tile('Offers')).toHaveTextContent('1')
  })
})

describe('time range', () => {
  it('starts at 12 weeks and asks the API for that window', async () => {
    const seen = mockStats()
    renderApp('/dashboard')

    await heroValue()
    expect(seen[0].searchParams.get('weeks')).toBe('12')
    expect(screen.getByRole('button', { name: '12 weeks' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('re-queries for the chosen range and marks it pressed', async () => {
    const user = userEvent.setup()
    const seen = mockStats()
    renderApp('/dashboard')
    await heroValue()

    await user.click(screen.getByRole('button', { name: '4 weeks' }))
    await waitFor(() => expect(seen.at(-1)!.searchParams.get('weeks')).toBe('4'))
    expect(screen.getByRole('button', { name: '4 weeks' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '12 weeks' })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: 'All time' }))
    await waitFor(() => expect(seen.at(-1)!.searchParams.has('weeks')).toBe(false))
  })

  it('does nothing when the current range is clicked again (and is not left dimmed)', async () => {
    const user = userEvent.setup()
    const seen = mockStats()
    renderApp('/dashboard')
    await heroValue()

    await user.click(screen.getByRole('button', { name: '12 weeks' }))

    expect(seen).toHaveLength(1)
    // No new request means nothing would ever clear a "loading" flag, so the
    // page must not have been put into it.
    expect(screen.getByText('Response rate').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'false')
  })

  it('keeps the previous numbers on screen, dimmed, while a new range loads', async () => {
    const user = userEvent.setup()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let calls = 0
    server.use(
      http.get(url('/stats'), async () => {
        calls++
        if (calls === 1) return HttpResponse.json(makeStats({ response: { responded: 1, eligible: 2, rate: 0.5 } }))
        await gate // hold the second response open
        return HttpResponse.json(makeStats({ response: { responded: 3, eligible: 4, rate: 0.75 } }))
      }),
    )
    renderApp('/dashboard')
    expect(await heroValue()).toHaveTextContent('50%')

    await user.click(screen.getByRole('button', { name: '26 weeks' }))

    // No skeleton or blank frame: the old value is still there, marked busy.
    expect(await heroValue()).toHaveTextContent('50%')
    expect(screen.getByText('Response rate').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true')

    release()
    await waitFor(async () => expect(await heroValue()).toHaveTextContent('75%'))
    expect(screen.getByText('Response rate').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'false')
  })

  it('ignores a slow response that a newer choice has outdated', async () => {
    const user = userEvent.setup()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    server.use(
      http.get(url('/stats'), async ({ request }) => {
        const weeks = new URL(request.url).searchParams.get('weeks')
        if (weeks === '4') {
          await gate // the 4-week answer arrives last
          return HttpResponse.json(makeStats({ response: { responded: 1, eligible: 10, rate: 0.1 } }))
        }
        if (weeks === null) return HttpResponse.json(makeStats({ response: { responded: 9, eligible: 10, rate: 0.9 } }))
        return HttpResponse.json(makeStats({ response: { responded: 5, eligible: 10, rate: 0.5 } }))
      }),
    )
    renderApp('/dashboard')
    await heroValue()

    await user.click(screen.getByRole('button', { name: '4 weeks' })) // slow
    await user.click(screen.getByRole('button', { name: 'All time' })) // fast, and the latest choice
    await waitFor(async () => expect(await heroValue()).toHaveTextContent('90%'))

    release() // the stale 4-week response now arrives
    await new Promise((r) => setTimeout(r, 50))
    expect(await heroValue()).toHaveTextContent('90%') // still the All time numbers
    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('empty and error states', () => {
  it('invites a wider range when the chosen period has no applications', async () => {
    mockStats(makeStats({ total: 0, response: { responded: 0, eligible: 0, rate: null }, per_week: [] }))
    renderApp('/dashboard')
    expect(await screen.findByText(/no applications in this period/i)).toBeInTheDocument()
  })

  it('links to adding an application when there are none at all', async () => {
    const user = userEvent.setup()
    mockStats(makeStats({ total: 0, response: { responded: 0, eligible: 0, rate: null }, per_week: [] }))
    renderApp('/dashboard')
    await screen.findByText(/no applications in this period/i)

    await user.click(screen.getByRole('button', { name: 'All time' }))

    expect(await screen.findByRole('link', { name: /add your first one/i })).toHaveAttribute('href', '/applications/new')
  })

  it('shows the error when stats cannot be loaded', async () => {
    server.use(http.get(url('/stats'), () => HttpResponse.json({ detail: 'Stats unavailable' }, { status: 500 })))
    renderApp('/dashboard')
    expect(await screen.findByRole('alert')).toHaveTextContent('Stats unavailable')
  })
})

describe('charts and their table twins', () => {
  it('labels each chart for screen readers, naming the busiest week', async () => {
    mockStats() // weeks: Mar 2 -> 3, Mar 9 -> 7
    renderApp('/dashboard')

    const weekly = await screen.findByRole('img', { name: /applications per week/i })
    expect(weekly).toHaveAccessibleName(/busiest week: week of mar 9, 2026 with 7/i)
    expect(screen.getByRole('img', { name: /by status/i })).toHaveAccessibleName(/applied: 2.*withdrawn: 2/i)
  })

  it('lists every weekly value in a table, newest week first', async () => {
    const user = userEvent.setup()
    mockStats()
    renderApp('/dashboard')
    const card = (await screen.findByRole('heading', { name: 'Applications per week' })).closest('section')!

    await user.click(within(card).getByRole('button', { name: 'View as table' }))

    const rows = within(within(card).getByRole('table')).getAllByRole('row').slice(1) // skip header
    expect(rows.map((r) => r.textContent)).toEqual(['Mar 9, 20267', 'Mar 2, 20263'])
  })

  it('lists every status, including zeros, in pipeline order', async () => {
    const user = userEvent.setup()
    mockStats(
      makeStats({
        by_status: [
          { status: 'applied', count: 5 },
          { status: 'screening', count: 0 },
          { status: 'interview', count: 0 },
          { status: 'offer', count: 0 },
          { status: 'rejected', count: 0 },
          { status: 'withdrawn', count: 0 },
        ],
      }),
    )
    renderApp('/dashboard')
    const card = (await screen.findByRole('heading', { name: 'Where applications stand' })).closest('section')!

    await user.click(within(card).getByRole('button', { name: 'View as table' }))

    const rows = within(within(card).getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual(['Applied5', 'Screening0', 'Interview0', 'Offer0', 'Rejected0', 'Withdrawn0'])
  })

  it('toggles back to the chart', async () => {
    const user = userEvent.setup()
    mockStats()
    renderApp('/dashboard')
    const card = (await screen.findByRole('heading', { name: 'Applications per week' })).closest('section')!

    await user.click(within(card).getByRole('button', { name: 'View as table' }))
    expect(within(card).getByRole('button', { name: 'View chart' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(card).getByRole('button', { name: 'View chart' }))

    expect(within(card).queryByRole('table')).not.toBeInTheDocument()
    expect(within(card).getByRole('img', { name: /bar chart/i })).toBeInTheDocument()
  })
})

describe('navigation', () => {
  it('is reachable from the header on other pages', async () => {
    const user = userEvent.setup()
    mockList([])
    mockUpcoming()
    mockStats()
    renderApp('/')

    await user.click(await screen.findByRole('link', { name: 'Dashboard' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('requires login', async () => {
    localStorage.clear()
    renderApp('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })
})
