import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Offer } from '../api'
import { server } from '../test/server'
import { makeApplication, renderApp, signIn, url } from '../test/helpers'

beforeEach(() => signIn())

function makeOffer(over: Partial<Offer> = {}): Offer {
  return { ...makeApplication({ status: 'offer' }), offer_recorded_on: '2026-05-10', days_to_offer: 40, ...over }
}

function mockOffers(list: Offer[], seen: URL[] = []) {
  server.use(
    http.get(url('/applications/offers'), ({ request }) => {
      seen.push(new URL(request.url))
      return HttpResponse.json(list)
    }),
  )
  return seen
}

const ACME = makeOffer({
  id: 1,
  company: 'Acme',
  role: 'Backend Engineer',
  status: 'offer',
  salary_min: 100000,
  salary_max: 120000,
  salary_currency: 'USD',
  work_mode: 'hybrid',
  location: 'Portland',
  location_display: 'Portland, Oregon, United States',
  interview_round: 4,
  interview_rounds_total: 4,
  date_applied: '2026-03-01',
  offer_recorded_on: '2026-04-10',
  days_to_offer: 40,
  tags: ['dream job'],
  job_url: 'https://jobs.example.com/acme',
  notes: 'Great team.\nLong commute.',
})
const GLOBEX = makeOffer({
  id: 2,
  company: 'Globex',
  role: 'Platform Engineer',
  status: 'offer_declined',
  salary_min: 90000,
  salary_max: 90000,
  salary_currency: 'EUR',
  work_mode: 'remote',
  location: null,
  location_display: null,
  date_applied: '2026-02-01',
  offer_recorded_on: '2026-02-01',
  days_to_offer: 0,
})

const table = async () => within(await screen.findByRole('table', { name: 'Offers side by side' }))
const row = async (label: string) => within((await table()).getByRole('rowheader', { name: label }).closest('tr')!)

describe('the offer comparison', () => {
  it('shows each offer as a column, headed by the company (linked) and the role', async () => {
    mockOffers([ACME, GLOBEX])
    renderApp('/offers')
    const t = await table()
    const headers = t.getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent)).toEqual(['AcmeBackend Engineer', 'GlobexPlatform Engineer'])
    expect(t.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/applications/1')
    expect(t.getByRole('link', { name: 'Globex' })).toHaveAttribute('href', '/applications/2')
  })

  it('puts each value under the right offer: status, salary with currency, work mode, location, rounds, dates', async () => {
    mockOffers([ACME, GLOBEX])
    renderApp('/offers')
    const cells = async (label: string) => (await row(label)).getAllByRole('cell').map((c) => c.textContent)
    expect(await cells('Status')).toEqual(['Offer', 'Offer declined'])
    expect(await cells('Salary')).toEqual(['100,000–120,000 USD', '90,000 EUR'])
    expect(await cells('Work mode')).toEqual(['Hybrid', 'Remote'])
    expect(await cells('Location')).toEqual(['Portland, Oregon, United States', 'Not recorded'])
    expect(await cells('Interview rounds')).toEqual(['Round 4 of 4', 'Not recorded'])
    expect((await cells('Applied'))[0]).toMatch(/Mar 1, 2026/)
    expect((await cells('Applied'))[1]).toMatch(/Feb 1, 2026/)
  })

  it('says how long each offer took, in days after applying, and handles the same-day case', async () => {
    mockOffers([ACME, GLOBEX])
    renderApp('/offers')
    const [acme, globex] = (await row('Offer recorded')).getAllByRole('cell')
    expect(acme).toHaveTextContent('Apr 10, 2026')
    expect(acme).toHaveTextContent('40 days after applying')
    expect(globex).toHaveTextContent('Feb 1, 2026')
    expect(globex).toHaveTextContent('the day you applied')
  })

  it('says "1 day", not "1 days", and shows just the date when the gap is not known', async () => {
    mockOffers([makeOffer({ id: 1, company: 'One', days_to_offer: 1 }), makeOffer({ id: 2, company: 'Unknown', days_to_offer: null })])
    renderApp('/offers')
    const [one, unknown] = (await row('Offer recorded')).getAllByRole('cell')
    expect(one).toHaveTextContent('1 day after applying')
    expect(unknown).not.toHaveTextContent('after applying')
    expect(unknown).toHaveTextContent('May 10, 2026')
  })

  it('shows tags, a safe posting link that opens in a new tab, and the notes with their line breaks', async () => {
    mockOffers([ACME, GLOBEX])
    renderApp('/offers')
    expect((await row('Tags')).getAllByRole('cell')[0]).toHaveTextContent('dream job')
    const link = (await row('Posting')).getByRole('link', { name: 'View posting for Acme' })
    expect(link).toHaveAttribute('href', 'https://jobs.example.com/acme')
    expect(link).toHaveAttribute('target', '_blank')
    const notes = (await row('Notes')).getAllByRole('cell')
    expect(notes[0].textContent).toBe('Great team.\nLong commute.')
    expect(notes[1]).toHaveTextContent('Not recorded')
  })

  it('never renders an unsafe posting link', async () => {
    mockOffers([makeOffer({ id: 1, company: 'Sneaky', job_url: 'javascript:alert(1)' }), GLOBEX])
    renderApp('/offers')
    expect((await row('Posting')).queryByRole('link')).not.toBeInTheDocument()
    expect(document.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('does not make up values: an offer with nothing recorded shows "Not recorded", not a blank or a zero', async () => {
    mockOffers([makeOffer({ id: 1, company: 'Bare', salary_min: null, salary_max: null, work_mode: null, tags: [], notes: null, job_url: null, date_applied: null }), GLOBEX])
    renderApp('/offers')
    for (const label of ['Salary', 'Work mode', 'Location', 'Interview rounds', 'Applied', 'Tags', 'Posting', 'Notes']) {
      expect((await row(label)).getAllByRole('cell')[0]).toHaveTextContent('Not recorded')
    }
  })

  it('warns that amounts are not converted when the offers are in different currencies', async () => {
    mockOffers([ACME, GLOBEX])
    renderApp('/offers')
    expect(await screen.findByRole('note')).toHaveTextContent('different currencies (EUR, USD). Amounts are shown as entered and are not converted')
  })

  it('says nothing about currencies when they match, or when only one offer has a salary', async () => {
    mockOffers([ACME, makeOffer({ id: 3, company: 'Also USD', salary_min: 80000, salary_currency: 'USD' })])
    renderApp('/offers')
    await table()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('ignores the currency of an offer with no salary when deciding whether to warn', async () => {
    mockOffers([ACME, makeOffer({ id: 3, company: 'No salary', salary_min: null, salary_max: null, salary_currency: 'EUR' })])
    renderApp('/offers')
    await table()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('explains what "offer recorded" means, so the dates are not over-read', async () => {
    mockOffers([ACME, GLOBEX])
    renderApp('/offers')
    expect(await screen.findByText(/only as accurate as your updates/)).toBeInTheDocument()
  })
})

describe('how many are compared', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => makeOffer({ id: i + 1, company: `Company ${i + 1}`, role: `Role ${i + 1}` }))

  it('compares up to four at once, the newest first, without asking you to choose when there are four or fewer', async () => {
    mockOffers(many(4))
    renderApp('/offers')
    expect((await table()).getAllByRole('columnheader')).toHaveLength(4)
    expect(screen.queryByRole('group', { name: /Choose up to 4/ })).not.toBeInTheDocument()
  })

  it('with more, shows the newest four and lets you choose, disabling the rest once four are picked', async () => {
    mockOffers(many(6))
    renderApp('/offers')
    const chooser = within(await screen.findByRole('group', { name: 'You have 6 offers. Choose up to 4 to compare.' }))
    expect((await table()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Company 1Role 1', 'Company 2Role 2', 'Company 3Role 3', 'Company 4Role 4'])
    expect(chooser.getByRole('checkbox', { name: 'Company 1, Role 1' })).toBeChecked()
    expect(chooser.getByRole('checkbox', { name: 'Company 5, Role 5' })).not.toBeChecked()
    expect(chooser.getByRole('checkbox', { name: 'Company 5, Role 5' })).toBeDisabled() // four are already chosen
  })

  it('swapping one offer for another works: untick one, tick another', async () => {
    const user = userEvent.setup()
    mockOffers(many(6))
    renderApp('/offers')
    const chooser = within(await screen.findByRole('group', { name: /Choose up to 4/ }))
    await user.click(chooser.getByRole('checkbox', { name: 'Company 2, Role 2' }))
    expect(chooser.getByRole('checkbox', { name: 'Company 5, Role 5' })).toBeEnabled()
    await user.click(chooser.getByRole('checkbox', { name: 'Company 5, Role 5' }))
    expect((await table()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Company 1Role 1', 'Company 3Role 3', 'Company 4Role 4', 'Company 5Role 5'])
  })

  it('can be narrowed to one column, and to none with a prompt', async () => {
    const user = userEvent.setup()
    mockOffers(many(5))
    renderApp('/offers')
    const chooser = within(await screen.findByRole('group', { name: /Choose up to 4/ }))
    for (const n of [2, 3, 4]) await user.click(chooser.getByRole('checkbox', { name: `Company ${n}, Role ${n}` }))
    expect((await table()).getAllByRole('columnheader')).toHaveLength(1)
    await user.click(chooser.getByRole('checkbox', { name: 'Company 1, Role 1' }))
    expect(screen.getByText('Choose at least one offer above.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('with too few offers', () => {
  it.each([
    [[], 'You have no offers yet.'],
    [[ACME], 'You have one offer.'],
  ])('says so, and why there is no table, for %j', async (list, message) => {
    mockOffers(list)
    renderApp('/offers')
    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument()
    expect(screen.getByText(/once two or more applications are at Offer, Offer accepted or Offer declined/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your applications' })).toHaveAttribute('href', '/applications')
  })
})

describe('archived offers', () => {
  it('are left out by default and asked for with the checkbox', async () => {
    const user = userEvent.setup()
    const seen = mockOffers([ACME, GLOBEX])
    renderApp('/offers')
    await table()
    expect(seen.at(-1)!.searchParams.has('archived')).toBe(false)
    await user.click(screen.getByRole('checkbox', { name: 'Include archived offers' }))
    await waitFor(() => expect(seen.at(-1)!.searchParams.get('archived')).toBe('include'))
  })

  it('starts the choice again when the list changes, rather than keeping offers that are no longer there', async () => {
    const user = userEvent.setup()
    const lists = [[ACME, GLOBEX], [ACME, GLOBEX, makeOffer({ id: 3, company: 'Archived Co' })]]
    server.use(http.get(url('/applications/offers'), ({ request }) => HttpResponse.json(new URL(request.url).searchParams.has('archived') ? lists[1] : lists[0])))
    renderApp('/offers')
    await table()
    await user.click(screen.getByRole('checkbox', { name: 'Include archived offers' }))
    await waitFor(async () => expect((await table()).getAllByRole('columnheader')).toHaveLength(3))
  })
})

describe('reaching and loading it', () => {
  it('shows the server message if the offers cannot be loaded', async () => {
    server.use(http.get(url('/applications/offers'), () => HttpResponse.json({ detail: 'Could not load' }, { status: 500 })))
    renderApp('/offers')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load')
  })

  it('is for logged-in users only', async () => {
    localStorage.clear()
    renderApp('/offers')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })
})
