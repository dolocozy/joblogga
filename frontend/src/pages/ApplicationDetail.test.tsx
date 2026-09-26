import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localToday } from '../dates'
import { server } from '../test/server'
import { makeDetail, mockList, mockUpcoming, renderApp, signIn, url } from '../test/helpers'

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
    expect(screen.getByLabelText('Location')).toHaveValue('Remote')
    expect(screen.getByLabelText('Status')).toHaveValue('interview')
    expect(screen.getByLabelText('Resume version')).toHaveValue('tech-focused')
  })

  it('shows the work mode in the heading beside the location, and selected in the form', async () => {
    mockGet(makeDetail({ id: 3, role: 'Analyst', location: 'Portland', work_mode: 'hybrid' }))
    renderApp('/applications/3')

    expect(await screen.findByText('Analyst, Portland, Hybrid')).toBeInTheDocument()
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

    await user.clear(await screen.findByLabelText('Location'))
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
