import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localToday } from '../dates'
import { server } from '../test/server'
import { makeDetail, mockCities, mockList, mockUpcoming, renderApp, signIn, url, withPlace } from '../test/helpers'

beforeEach(() => signIn())

function mockGet(detail = makeDetail({ id: 3 })) {
  server.use(http.get(url(`/applications/${detail.id}`), () => HttpResponse.json(detail)))
}

describe('loading and display', () => {
  it('shows the application in an editable form', async () => {
    mockGet(makeDetail({ id: 3, company: 'Globex', role: 'Analyst', location: 'Remote', status: 'interview', resume_version: 'tech-focused' }))
    renderApp('/applications/3')

    expect(await screen.findByRole('heading', { name: /Globex/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Company')).toHaveValue('Globex')
    expect(screen.getByLabelText('Place, typed')).toHaveValue('Remote') // typed before places could be picked, so it opens as typed text
    expect(screen.getByLabelText('Status')).toHaveValue('interview')
    expect(screen.getByLabelText('Resume version')).toHaveValue('tech-focused')
  })

  it('shows the work mode beside the role, the place on its own line, and the mode selected in the form', async () => {
    mockGet(makeDetail({ id: 3, role: 'Analyst', location: 'Portland', work_mode: 'hybrid' }))
    renderApp('/applications/3')

    expect(await screen.findByText('Analyst, Hybrid')).toBeInTheDocument()
    expect(screen.getAllByText('Portland').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Work mode')).toHaveValue('hybrid')
  })

  it('shows nothing extra, and "Not specified" in the form, when there is no work mode', async () => {
    mockGet(makeDetail({ id: 3, role: 'Analyst', location: null, work_mode: null }))
    renderApp('/applications/3')

    expect(await screen.findByText('Analyst')).toBeInTheDocument()
    expect(screen.getByLabelText('Work mode')).toHaveValue('')
  })

  it('saves a changed work mode, and can put it back to not specified', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, work_mode: 'remote' }))
    server.use(
      http.patch(url('/applications/3'), async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return HttpResponse.json(makeDetail({ id: 3, work_mode: body.work_mode as never, updated_at: `2026-04-0${bodies.length}T00:00:00Z` }))
      }),
    )
    renderApp('/applications/3')

    await user.selectOptions(await screen.findByLabelText('Work mode'), 'In person')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('status')
    await user.selectOptions(screen.getByLabelText('Work mode'), 'Not specified')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByRole('status')
    expect(bodies.map((b) => b.work_mode)).toEqual(['in_person', null])
  })

  it('lists status history, newest first', async () => {
    mockGet(
      makeDetail({
        id: 3,
        status: 'interview',
        history: [
          { id: 1, from_status: null, to_status: 'applied', changed_at: '2026-03-01T12:00:00Z' },
          { id: 2, from_status: 'applied', to_status: 'interview', changed_at: '2026-03-08T12:00:00Z' },
        ],
      }),
    )
    renderApp('/applications/3')

    const history = (await screen.findByText('Status history')).closest('section')!
    const entries = within(history).getAllByRole('listitem')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toHaveTextContent('Moved from Applied to Interview')
    expect(entries[1]).toHaveTextContent('Started as Applied')
  })

  it('shows "not found" for a missing application', async () => {
    server.use(http.get(url('/applications/99'), () => HttpResponse.json({ detail: 'Application not found' }, { status: 404 })))
    renderApp('/applications/99')
    expect(await screen.findByText(/application not found/i)).toBeInTheDocument()
  })

  it('shows "not found" for a non-numeric id without calling the API', async () => {
    // No handler registered: any request would fail the test.
    renderApp('/applications/abc')
    expect(await screen.findByText(/application not found/i)).toBeInTheDocument()
  })
})

describe('job link safety', () => {
  it('renders an https link that opens safely in a new tab', async () => {
    mockGet(makeDetail({ id: 3, job_url: 'https://example.com/jobs/1' }))
    renderApp('/applications/3')

    const link = await screen.findByRole('link', { name: /view posting/i })
    expect(link).toHaveAttribute('href', 'https://example.com/jobs/1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('never renders a javascript: URL as a link, even if the API returned one', async () => {
    mockGet(makeDetail({ id: 3, job_url: 'javascript:alert(1)' }))
    renderApp('/applications/3')

    await screen.findByRole('heading', { name: /Acme/ })
    expect(screen.queryByRole('link', { name: /view posting/i })).not.toBeInTheDocument()
  })
})

describe('editing', () => {
  it('saves changes with a PATCH and confirms', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    mockGet(makeDetail({ id: 3, notes: 'old' }))
    server.use(
      http.patch(url('/applications/3'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeDetail({ id: 3, notes: 'new notes', updated_at: '2026-03-02T00:00:00Z' }))
      }),
    )
    renderApp('/applications/3')

    const notes = await screen.findByLabelText('Notes')
    await user.clear(notes)
    await user.type(notes, 'new notes')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.')
    expect(body).toMatchObject({ notes: 'new notes', company: 'Acme' })
    expect(screen.getByLabelText('Notes')).toHaveValue('new notes')
  })

  it('clears an optional field by sending null', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> | null = null
    mockGet(makeDetail({ id: 3, location: 'Remote' }))
    server.use(
      http.patch(url('/applications/3'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json(makeDetail({ id: 3, location: null, updated_at: '2026-03-02T00:00:00Z' }))
      }),
    )
    renderApp('/applications/3')

    await user.clear(await screen.findByLabelText('Place, typed'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await screen.findByRole('status')
    expect(body).toMatchObject({ location: null })
  })

  it('shows a save error without losing what was typed', async () => {
    const user = userEvent.setup()
    mockGet(makeDetail({ id: 3 }))
    server.use(
      http.patch(url('/applications/3'), () =>
        HttpResponse.json({ detail: 'salary_min cannot be greater than salary_max' }, { status: 422 }),
      ),
    )
    renderApp('/applications/3')

    const notes = await screen.findByLabelText('Notes')
    await user.type(notes, 'keep me')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('salary_min cannot be greater')
    expect(screen.getByLabelText('Notes')).toHaveValue('keep me')
  })
})

describe('deleting', () => {
  it('asks for confirmation, deletes, and returns to the list', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let deleted = false
    mockGet(makeDetail({ id: 3, company: 'Globex' }))
    server.use(
      http.delete(url('/applications/3'), () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    mockList([])
    mockUpcoming()
    renderApp('/applications/3')

    await user.click(await screen.findByRole('button', { name: 'Delete application' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Globex'))
    expect(await screen.findByRole('heading', { name: 'Applications' })).toBeInTheDocument()
    expect(deleted).toBe(true)
    confirm.mockRestore()
  })

  it('does nothing if the user cancels the confirmation', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    let deleted = false
    mockGet(makeDetail({ id: 3 }))
    server.use(
      http.delete(url('/applications/3'), () => {
        deleted = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp('/applications/3')

    await user.click(await screen.findByRole('button', { name: 'Delete application' }))

    expect(deleted).toBe(false)
    expect(screen.getByRole('heading', { name: /Acme/ })).toBeInTheDocument()
    confirm.mockRestore()
  })
})

describe('a saved job', () => {
  const SAVED = () => makeDetail({ id: 3, company: 'Wish Co', status: 'saved', date_applied: null, history: [{ id: 1, from_status: null, to_status: 'saved', changed_at: '2026-03-01T12:00:00Z' }] })

  it('offers to mark it applied, with the date already set to today', async () => {
    mockGet(SAVED())
    renderApp('/applications/3')

    const panel = await screen.findByRole('form', { name: 'Mark as applied' })
    expect(within(panel).getByLabelText('Date applied')).toHaveValue(localToday())
    expect(panel).toHaveTextContent(/left out of your response rate/)
  })

  it('marking it applied sends the status and the date, and the page becomes an ordinary application', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(SAVED())
    server.use(
      http.patch(url('/applications/3'), async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(makeDetail({ id: 3, company: 'Wish Co', status: 'applied', date_applied: localToday(), updated_at: '2026-04-01T00:00:00Z' }))
      }),
    )
    renderApp('/applications/3')

    await user.click(await screen.findByRole('button', { name: 'Mark as applied' }))

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Mark as applied' })).not.toBeInTheDocument())
    expect(bodies).toEqual([{ status: 'applied', date_applied: localToday() }])
    expect(screen.getByLabelText('Status')).toHaveValue('applied')
    expect(screen.getByLabelText('Date applied')).toHaveValue(localToday())
  })

  it('the date can be changed first, for something applied to earlier', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(SAVED())
    server.use(
      http.patch(url('/applications/3'), async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(makeDetail({ id: 3, status: 'applied', date_applied: '2026-03-04', updated_at: '2026-04-01T00:00:00Z' }))
      }),
    )
    renderApp('/applications/3')

    fireEvent.change(await screen.findByLabelText('Date applied'), { target: { value: '2026-03-04' } })
    await user.click(screen.getByRole('button', { name: 'Mark as applied' }))

    await waitFor(() => expect(bodies).toEqual([{ status: 'applied', date_applied: '2026-03-04' }]))
  })

  it('will not send an empty date', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    mockGet(SAVED())
    server.use(http.patch(url('/applications/3'), async ({ request }) => (bodies.push(await request.json()), HttpResponse.json(SAVED()))))
    renderApp('/applications/3')

    fireEvent.change(await screen.findByLabelText('Date applied'), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Mark as applied' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the date you applied')
    expect(bodies).toHaveLength(0)
  })

  it('shows the server message and lets you try again if it fails', async () => {
    const user = userEvent.setup()
    mockGet(SAVED())
    server.use(http.patch(url('/applications/3'), () => HttpResponse.json({ detail: 'Could not save that' }, { status: 500 })))
    renderApp('/applications/3')

    await user.click(await screen.findByRole('button', { name: 'Mark as applied' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that')
    expect(screen.getByRole('button', { name: 'Mark as applied' })).toBeEnabled()
  })

  it('has no date field in its edit form, and saves other edits without inventing a date', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(SAVED())
    server.use(
      http.patch(url('/applications/3'), async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json({ ...SAVED(), updated_at: '2026-04-01T00:00:00Z' })
      }),
    )
    renderApp('/applications/3')

    const form = (await screen.findByRole('button', { name: 'Save changes' })).closest('form')!
    expect(within(form).queryByLabelText('Date applied')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ status: 'saved', date_applied: null })
  })

  it('an application already made shows no such offer', async () => {
    mockGet(makeDetail({ id: 3, status: 'applied' }))
    renderApp('/applications/3')
    await screen.findByLabelText('Company')
    expect(screen.queryByRole('form', { name: 'Mark as applied' })).not.toBeInTheDocument()
  })
})

describe('interview rounds on the detail page', () => {
  it('shows "Round 2 of 3" beside the status and in the form', async () => {
    mockGet(makeDetail({ id: 3, status: 'interview', interview_round: 2, interview_rounds_total: 3 }))
    renderApp('/applications/3')

    expect(await screen.findByText('Round 2 of 3')).toBeInTheDocument()
    expect(screen.getByLabelText('Interview round')).toHaveValue('2')
    expect(screen.getByLabelText('Total rounds')).toHaveValue('3')
  })

  it.each(['offer', 'rejected', 'withdrawn', 'offer_declined'] as const)('keeps showing the last round once the status is %s: it is a record of how far it got', async (status) => {
    mockGet(makeDetail({ id: 3, status, interview_round: 2, interview_rounds_total: 3 }))
    renderApp('/applications/3')
    expect(await screen.findByText('Round 2 of 3')).toBeInTheDocument()
    expect(screen.getByLabelText('Interview round')).toBeInTheDocument() // and it can still be corrected
  })

  it('shows nothing, and no fields, for an application that never got to interviews', async () => {
    mockGet(makeDetail({ id: 3, status: 'applied' }))
    renderApp('/applications/3')
    await screen.findByLabelText('Company')
    expect(screen.queryByText(/^Round /)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Interview round')).not.toBeInTheDocument()
  })

  it('advancing the round is a one-field edit, and clearing it sends null', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, status: 'interview', interview_round: 1, interview_rounds_total: 3 }))
    server.use(
      http.patch(url('/applications/3'), async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return HttpResponse.json(makeDetail({ id: 3, status: 'interview', interview_round: body.interview_round as number | null, interview_rounds_total: 3, updated_at: `2026-04-0${bodies.length}T00:00:00Z` }))
      }),
    )
    renderApp('/applications/3')

    const round = await screen.findByLabelText('Interview round')
    await user.clear(round)
    await user.type(round, '2')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('status')
    await user.clear(screen.getByLabelText('Interview round'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies.map((b) => [b.interview_round, b.interview_rounds_total])).toEqual([[2, 3], [null, 3]])
    expect(bodies.map((b) => b.status)).toEqual(['interview', 'interview']) // the status is not touched by it
  })
})

describe('a picked place on the detail page', () => {
  it('shows the city with its state and country on a line of its own', async () => {
    mockGet(makeDetail({ id: 3, company: 'Acme', role: 'Analyst', ...withPlace(109) }))
    renderApp('/applications/3')
    expect(await screen.findByText('Springfield, Missouri, United States', { selector: 'p' })).toBeInTheDocument()
  })

  it('opens the form with the country and city already chosen, showing the state', async () => {
    mockGet(makeDetail({ id: 3, ...withPlace(109) }))
    renderApp('/applications/3')
    expect(await screen.findByRole('combobox', { name: 'Country' })).toHaveValue('United States')
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('Springfield, Missouri')
    expect(screen.queryByLabelText('Place, typed')).not.toBeInTheDocument()
  })

  it('saves the same place unchanged as the same ids, letting the server write the text', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, ...withPlace(109) }))
    server.use(http.patch(url('/applications/3'), async ({ request }) => (bodies.push((await request.json()) as Record<string, unknown>), HttpResponse.json(makeDetail({ id: 3, ...withPlace(109), updated_at: '2026-04-01T00:00:00Z' })))))
    renderApp('/applications/3')

    await user.click(await screen.findByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ country_id: 6, city_id: 109, location: null })
  })

  it('moves to another Springfield by choosing it: a different id, the same name', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockCities()
    mockGet(makeDetail({ id: 3, ...withPlace(109) }))
    server.use(http.patch(url('/applications/3'), async ({ request }) => (bodies.push((await request.json()) as Record<string, unknown>), HttpResponse.json(makeDetail({ id: 3, ...withPlace(110), updated_at: '2026-04-01T00:00:00Z' })))))
    renderApp('/applications/3')

    const box = await screen.findByRole('combobox', { name: 'City' })
    await user.clear(box)
    await user.type(box, 'spring')
    await user.click(await within(await screen.findByRole('listbox')).findByRole('option', { name: 'Springfield, Ohio' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ country_id: 6, city_id: 110 })
    expect(await screen.findByText('Springfield, Ohio, United States', { selector: 'p' })).toBeInTheDocument()
  })

  it('opens a place typed before places existed as typed text, and can be left as it is', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, location: 'Springfield' }))
    server.use(http.patch(url('/applications/3'), async ({ request }) => (bodies.push((await request.json()) as Record<string, unknown>), HttpResponse.json(makeDetail({ id: 3, location: 'Springfield', updated_at: '2026-04-01T00:00:00Z' })))))
    renderApp('/applications/3')

    expect(await screen.findByLabelText('Place, typed')).toHaveValue('Springfield')
    expect(screen.getByText(/no state or other structure/i)).toBeInTheDocument() // the reason to pick instead
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ location: 'Springfield', country_id: null, city_id: null }) // exactly as it was
  })

  it('a typed place can be upgraded to a picked one', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockCities()
    mockGet(makeDetail({ id: 3, location: 'Springfield' }))
    server.use(http.patch(url('/applications/3'), async ({ request }) => (bodies.push((await request.json()) as Record<string, unknown>), HttpResponse.json(makeDetail({ id: 3, ...withPlace(108), updated_at: '2026-04-01T00:00:00Z' })))))
    renderApp('/applications/3')

    await user.click(await screen.findByRole('button', { name: 'Pick a city from the list instead' }))
    await user.type(screen.getByRole('combobox', { name: 'Country' }), 'united')
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'United States' }))
    await user.type(screen.getByRole('combobox', { name: 'City' }), 'spring')
    await user.click(await within(await screen.findByRole('listbox')).findByRole('option', { name: 'Springfield, Illinois' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toMatchObject({ country_id: 6, city_id: 108, location: null })
  })

  it('a country with a typed place shows both, and the text field keeps only what was typed', async () => {
    mockGet(makeDetail({ id: 3, location: 'Nowheresville', country: { id: 1, name: 'Canada' }, location_display: 'Nowheresville, Canada' }))
    renderApp('/applications/3')
    expect(await screen.findByText('Nowheresville, Canada', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByLabelText('Place, typed')).toHaveValue('Nowheresville') // not "Nowheresville, Canada", which would repeat the country on save
    expect(screen.getByRole('combobox', { name: 'Country' })).toHaveValue('Canada')
  })
})

describe('the duplicate warning when editing', () => {
  const MATCH = { id: 9, company: 'Globex', role: 'Analyst', status: 'applied', date_applied: '2026-03-01', created_at: '2026-03-02T12:00:00Z' }

  function setup(matches: unknown[]) {
    const checks: URL[] = []
    const patches: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, company: 'Acme', role: 'Engineer' }))
    server.use(
      http.get(url('/applications/duplicates'), ({ request }) => (checks.push(new URL(request.url)), HttpResponse.json(matches))),
      http.patch(url('/applications/3'), async ({ request }) => {
        patches.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(makeDetail({ id: 3, company: 'Globex', role: 'Analyst', updated_at: '2026-04-01T00:00:00Z' }))
      }),
    )
    return { checks, patches }
  }

  it('does not check, or warn, when the company and role are left alone, even if another application is a twin', async () => {
    const user = userEvent.setup()
    const { checks, patches } = setup([MATCH])
    renderApp('/applications/3')
    await user.type(await screen.findByLabelText('Notes'), 'called back')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(patches).toHaveLength(1))
    expect(checks).toHaveLength(0)
  })

  it('warns when the company or role is changed to match another application, excluding itself from the check', async () => {
    const user = userEvent.setup()
    const { checks, patches } = setup([MATCH])
    renderApp('/applications/3')
    const company = await screen.findByLabelText('Company')
    await user.clear(company)
    await user.type(company, 'Globex')
    const role = screen.getByLabelText('Role')
    await user.clear(role)
    await user.type(role, 'Analyst')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('group', { name: 'Possible duplicate' })).toHaveTextContent('You already have an application for Globex, Analyst.')
    expect(checks[0].searchParams.get('exclude_id')).toBe('3')
    expect(patches).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Save anyway' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0]).toMatchObject({ company: 'Globex', role: 'Analyst' })
  })

  it('ignores case and spacing when deciding whether the company or role changed', async () => {
    const user = userEvent.setup()
    const { checks, patches } = setup([MATCH])
    renderApp('/applications/3')
    const company = await screen.findByLabelText('Company')
    await user.clear(company)
    await user.type(company, '  ACME ')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(checks).toHaveLength(0) // still the same company, as far as a duplicate is concerned
  })
})

describe('archiving from the detail page', () => {
  function setup(detail = makeDetail({ id: 3, company: 'Acme', status: 'rejected' })) {
    const patches: Record<string, unknown>[] = []
    mockGet(detail)
    server.use(
      http.patch(url('/applications/3'), async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        patches.push(body)
        const archived = body.archived as boolean
        return HttpResponse.json({ ...detail, archived, archived_at: archived ? '2026-05-01T00:00:00Z' : null, updated_at: '2026-05-01T00:00:00Z' })
      }),
    )
    return patches
  }

  it('has an Archive button beside Delete, and no archived banner for a live application', async () => {
    setup()
    renderApp('/applications/3')
    expect(await screen.findByRole('button', { name: 'Archive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete application' })).toBeInTheDocument()
    expect(screen.queryByText('This application is archived.')).not.toBeInTheDocument()
  })

  it('archiving sends only archived: true, and shows the banner with what it means', async () => {
    const user = userEvent.setup()
    const patches = setup()
    renderApp('/applications/3')
    await user.click(await screen.findByRole('button', { name: 'Archive' }))

    const banner = await screen.findByText('This application is archived.')
    expect(patches).toEqual([{ archived: true }])
    expect(banner.closest('div')).toHaveTextContent('still counted in your dashboard and export')
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument()
  })

  it('an archived application opens with the banner, and Unarchive brings it back', async () => {
    const user = userEvent.setup()
    const patches = setup(makeDetail({ id: 3, status: 'rejected', archived: true, archived_at: '2026-04-01T00:00:00Z' }))
    renderApp('/applications/3')
    expect(await screen.findByText('This application is archived.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Unarchive' }))

    await waitFor(() => expect(screen.queryByText('This application is archived.')).not.toBeInTheDocument())
    expect(patches).toEqual([{ archived: false }])
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument()
  })

  it('does not wipe what you are typing in the form', async () => {
    const user = userEvent.setup()
    setup()
    renderApp('/applications/3')
    await user.type(await screen.findByLabelText('Notes'), 'half-written thought')
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    await screen.findByText('This application is archived.')
    expect(screen.getByLabelText('Notes')).toHaveValue('half-written thought')
  })

  it('shows the server message if archiving fails', async () => {
    const user = userEvent.setup()
    mockGet(makeDetail({ id: 3, status: 'rejected' }))
    server.use(http.patch(url('/applications/3'), () => HttpResponse.json({ detail: 'Could not save that' }, { status: 500 })))
    renderApp('/applications/3')
    await user.click(await screen.findByRole('button', { name: 'Archive' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that')
    expect(screen.queryByText('This application is archived.')).not.toBeInTheDocument()
  })

  it('a normal save of an archived application does not send archived, so it cannot be unarchived by accident', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, status: 'rejected', archived: true, archived_at: '2026-04-01T00:00:00Z' }))
    server.use(http.patch(url('/applications/3'), async ({ request }) => (bodies.push((await request.json()) as Record<string, unknown>), HttpResponse.json(makeDetail({ id: 3, status: 'rejected', archived: true, archived_at: '2026-04-01T00:00:00Z' })))))
    renderApp('/applications/3')
    await user.type(await screen.findByLabelText('Notes'), 'a note')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).not.toHaveProperty('archived')
    expect(await screen.findByText('This application is archived.')).toBeInTheDocument()
  })
})

describe('tags on the detail page', () => {
  it('shows an application\'s tags under its heading and in the form', async () => {
    mockGet(makeDetail({ id: 3, tags: ['dream job', 'referral'] }))
    renderApp('/applications/3')
    expect(await screen.findByRole('heading', { name: /Acme/ })).toBeInTheDocument()
    const chips = screen.getAllByText('dream job')
    expect(chips.length).toBeGreaterThanOrEqual(2) // the label under the heading, and the chip in the form
    expect(screen.getByRole('list', { name: 'Chosen tags' })).toHaveTextContent('referral')
  })

  it('shows nothing extra for an application with no tags', async () => {
    mockGet(makeDetail({ id: 3, tags: [] }))
    renderApp('/applications/3')
    await screen.findByLabelText('Company')
    expect(screen.queryByRole('list', { name: 'Chosen tags' })).not.toBeInTheDocument()
  })

  it('saves added and removed tags as the full new set', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, tags: ['a', 'b'] }))
    server.use(
      http.patch(url('/applications/3'), async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        bodies.push(body)
        return HttpResponse.json(makeDetail({ id: 3, tags: body.tags as string[], updated_at: '2026-06-01T00:00:00Z' }))
      }),
    )
    renderApp('/applications/3')
    await user.click(await screen.findByRole('button', { name: 'Remove tag a' }))
    await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'New One{Enter}')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].tags).toEqual(['b', 'new one'])
  })

  it('clearing every tag sends an empty list, which clears them', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, tags: ['only'] }))
    server.use(http.patch(url('/applications/3'), async ({ request }) => (bodies.push((await request.json()) as Record<string, unknown>), HttpResponse.json(makeDetail({ id: 3, tags: [], updated_at: '2026-06-01T00:00:00Z' })))))
    renderApp('/applications/3')
    await user.click(await screen.findByRole('button', { name: 'Remove tag only' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].tags).toEqual([])
  })
})

describe('contacts on the detail page', () => {
  const JANE = { id: 11, name: 'Jane Doe', title: 'Recruiter', email: 'jane@acme.com', linkedin_url: 'https://www.linkedin.com/in/jane' }
  const SAM = { id: 12, name: 'Sam Lee', title: null, email: null, linkedin_url: null }
  const section = async () => within((await screen.findByRole('heading', { name: 'Contacts' })).closest('section')!)

  it('invites you to add one when there are none', async () => {
    mockGet(makeDetail({ id: 3, contacts: [] }))
    renderApp('/applications/3')
    const contacts = await section()
    expect(contacts.getByText(/No contacts yet/)).toBeInTheDocument()
    expect(contacts.getByRole('button', { name: 'Add contact' })).toBeInTheDocument()
  })

  it('lists each person with their title, a mailto link and a LinkedIn link that opens safely in a new tab', async () => {
    mockGet(makeDetail({ id: 3, contacts: [JANE, SAM] }))
    renderApp('/applications/3')
    const contacts = await section()
    expect(contacts.getByText('Jane Doe')).toBeInTheDocument()
    expect(contacts.getByText('Recruiter')).toBeInTheDocument()
    expect(contacts.getByRole('link', { name: 'jane@acme.com' })).toHaveAttribute('href', 'mailto:jane@acme.com')
    const linkedin = contacts.getByRole('link', { name: 'LinkedIn profile of Jane Doe' })
    expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/in/jane')
    expect(linkedin).toHaveAttribute('target', '_blank')
    expect(linkedin).toHaveAttribute('rel', 'noopener noreferrer')
    expect(contacts.getAllByRole('link')).toHaveLength(2) // Sam has neither, so no dead links
  })

  it('never renders an unsafe link, even if one reached the database', async () => {
    mockGet(makeDetail({ id: 3, contacts: [{ ...JANE, email: 'not an email <x>', linkedin_url: 'javascript:alert(1)' }] }))
    renderApp('/applications/3')
    const contacts = await section()
    expect(contacts.queryByRole('link')).not.toBeInTheDocument()
    expect(contacts.getByText('not an email <x>')).toBeInTheDocument() // shown as plain text
    expect(document.querySelector('a[href^="javascript"]')).toBeNull()
  })

  it('adds a contact, sending it on its own, and shows it at once', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, contacts: [] }))
    server.use(http.post(url('/applications/3/contacts'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      bodies.push(body)
      return HttpResponse.json({ id: 20, ...body }, { status: 201 })
    }))
    renderApp('/applications/3')
    await user.click((await section()).getByRole('button', { name: 'Add contact' }))
    const form = within(screen.getByRole('form', { name: 'Add a contact' }))
    await user.type(form.getByLabelText('Name'), '  Jane Doe ')
    await user.type(form.getByLabelText('Role or title'), 'Recruiter')
    await user.type(form.getByLabelText('Email'), 'jane@acme.com')
    await user.click(form.getByRole('button', { name: 'Add contact' }))

    expect(await (await section()).findByText('Jane Doe')).toBeInTheDocument()
    expect(bodies).toEqual([{ name: 'Jane Doe', title: 'Recruiter', email: 'jane@acme.com', linkedin_url: null }])
    expect(screen.queryByRole('form', { name: 'Add a contact' })).not.toBeInTheDocument()
  })

  it('needs a name, and says so next to the field without sending anything', async () => {
    const user = userEvent.setup()
    const bodies: unknown[] = []
    mockGet(makeDetail({ id: 3 }))
    server.use(http.post(url('/applications/3/contacts'), async ({ request }) => (bodies.push(await request.json()), HttpResponse.json({}, { status: 201 }))))
    renderApp('/applications/3')
    await user.click((await section()).getByRole('button', { name: 'Add contact' }))
    await user.click(within(screen.getByRole('form', { name: 'Add a contact' })).getByRole('button', { name: 'Add contact' }))
    expect(await screen.findByText("Enter the person's name")).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('shows the server\'s own message for an email it refuses, and keeps what was typed', async () => {
    const user = userEvent.setup()
    mockGet(makeDetail({ id: 3 }))
    server.use(http.post(url('/applications/3/contacts'), () => HttpResponse.json({ detail: [{ msg: 'value is not a valid email address: An email address must have an @-sign.' }] }, { status: 422 })))
    renderApp('/applications/3')
    await user.click((await section()).getByRole('button', { name: 'Add contact' }))
    const form = within(screen.getByRole('form', { name: 'Add a contact' }))
    await user.type(form.getByLabelText('Name'), 'Jane')
    await user.type(form.getByLabelText('Email'), 'nope')
    await user.click(form.getByRole('button', { name: 'Add contact' }))

    expect(await form.findByRole('alert')).toHaveTextContent('not a valid email address')
    expect(form.getByLabelText('Email')).toHaveValue('nope')
    expect(form.getByRole('button', { name: 'Add contact' })).toBeEnabled()
  })

  it('cancelling closes the form and adds nothing', async () => {
    const user = userEvent.setup()
    mockGet(makeDetail({ id: 3 }))
    renderApp('/applications/3')
    await user.click((await section()).getByRole('button', { name: 'Add contact' }))
    await user.click(within(screen.getByRole('form', { name: 'Add a contact' })).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Add a contact' })).not.toBeInTheDocument()
    expect((await section()).getByText(/No contacts yet/)).toBeInTheDocument()
  })

  it('edits a contact in place, sending the whole form, and clearing a field sends null', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, contacts: [JANE, SAM] }))
    server.use(http.patch(url('/applications/3/contacts/11'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      bodies.push(body)
      return HttpResponse.json({ id: 11, ...body })
    }))
    renderApp('/applications/3')
    await user.click((await section()).getByRole('button', { name: 'Edit Jane Doe' }))
    const form = within(screen.getByRole('form', { name: 'Edit Jane Doe' }))
    expect(form.getByLabelText('Email')).toHaveValue('jane@acme.com') // prefilled
    await user.clear(form.getByLabelText('Role or title'))
    await user.type(form.getByLabelText('Role or title'), 'Hiring manager')
    await user.clear(form.getByLabelText('Email'))
    await user.click(form.getByRole('button', { name: 'Save contact' }))

    expect(await (await section()).findByText('Hiring manager')).toBeInTheDocument()
    expect(bodies).toEqual([{ name: 'Jane Doe', title: 'Hiring manager', email: null, linkedin_url: 'https://www.linkedin.com/in/jane' }])
    expect((await section()).getByText('Sam Lee')).toBeInTheDocument() // the other one is unchanged
  })

  it('removes a contact after confirming, and not if you decline', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm')
    let deleted = 0
    mockGet(makeDetail({ id: 3, contacts: [JANE, SAM] }))
    server.use(http.delete(url('/applications/3/contacts/11'), () => (deleted++, new HttpResponse(null, { status: 204 }))))
    renderApp('/applications/3')

    confirm.mockReturnValueOnce(false)
    await user.click((await section()).getByRole('button', { name: 'Remove Jane Doe' }))
    expect(deleted).toBe(0)
    expect((await section()).getByText('Jane Doe')).toBeInTheDocument()

    confirm.mockReturnValueOnce(true)
    await user.click((await section()).getByRole('button', { name: 'Remove Jane Doe' }))
    await waitFor(() => expect((screen.getByRole('heading', { name: 'Contacts' }).closest('section')!).textContent).not.toContain('Jane Doe'))
    expect(deleted).toBe(1)
    expect(confirm).toHaveBeenLastCalledWith('Remove Jane Doe from this application?')
    confirm.mockRestore()
  })

  it('says why a removal failed and keeps the contact', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockGet(makeDetail({ id: 3, contacts: [JANE] }))
    server.use(http.delete(url('/applications/3/contacts/11'), () => HttpResponse.json({ detail: 'Contact not found' }, { status: 404 })))
    renderApp('/applications/3')
    await user.click((await section()).getByRole('button', { name: 'Remove Jane Doe' }))
    expect(await (await section()).findByRole('alert')).toHaveTextContent('Contact not found')
    expect((await section()).getByText('Jane Doe')).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('stops offering to add at ten, and says why', async () => {
    mockGet(makeDetail({ id: 3, contacts: Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, name: `Person ${i}`, title: null, email: null, linkedin_url: null })) }))
    renderApp('/applications/3')
    const contacts = await section()
    expect(contacts.queryByRole('button', { name: 'Add contact' })).not.toBeInTheDocument()
    expect(contacts.getByText(/the most contacts an application can have \(10\)/)).toBeInTheDocument()
  })

  it('adding a contact does not wipe what you are typing in the application form', async () => {
    const user = userEvent.setup()
    mockGet(makeDetail({ id: 3, contacts: [] }))
    server.use(http.post(url('/applications/3/contacts'), async ({ request }) => HttpResponse.json({ id: 21, ...((await request.json()) as object) }, { status: 201 })))
    renderApp('/applications/3')
    await user.type(await screen.findByLabelText('Notes'), 'half-written thought')
    await user.click((await section()).getByRole('button', { name: 'Add contact' }))
    const form = within(screen.getByRole('form', { name: 'Add a contact' }))
    await user.type(form.getByLabelText('Name'), 'Jane')
    await user.click(form.getByRole('button', { name: 'Add contact' }))
    await (await section()).findByText('Jane')
    expect(screen.getByLabelText('Notes')).toHaveValue('half-written thought')
  })
})

describe('salary and currency on the detail page', () => {
  it('shows the salary beside its currency under the heading, so a euro figure never looks like a dollar one', async () => {
    mockGet(makeDetail({ id: 3, salary_min: 100000, salary_max: 120000, salary_currency: 'EUR' }))
    renderApp('/applications/3')
    expect(await screen.findByText('100,000–120,000 EUR', { selector: 'p' })).toBeInTheDocument()
  })

  it('shows nothing extra for an application with no salary', async () => {
    mockGet(makeDetail({ id: 3, salary_min: null, salary_max: null, salary_currency: 'EUR' }))
    renderApp('/applications/3')
    await screen.findByLabelText('Company')
    expect(screen.queryByText(/EUR/, { selector: 'p' })).not.toBeInTheDocument()
  })

  it('opens the form with the saved currency selected, and saves a changed one', async () => {
    const user = userEvent.setup()
    const bodies: Record<string, unknown>[] = []
    mockGet(makeDetail({ id: 3, salary_min: 90000, salary_currency: 'CAD' }))
    server.use(http.patch(url('/applications/3'), async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      bodies.push(body)
      return HttpResponse.json(makeDetail({ id: 3, salary_min: 90000, salary_currency: body.salary_currency as string, updated_at: '2026-06-01T00:00:00Z' }))
    }))
    renderApp('/applications/3')
    const currency = await screen.findByLabelText('Salary currency')
    await waitFor(() => expect(currency).toHaveValue('CAD'))
    await user.selectOptions(currency, 'EUR')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].salary_currency).toBe('EUR')
    expect(await screen.findByText('from 90,000 EUR', { selector: 'p' })).toBeInTheDocument()
  })
})
