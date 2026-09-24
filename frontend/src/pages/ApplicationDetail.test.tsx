import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
