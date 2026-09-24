import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Application } from '../api'
import Board from '../components/Board'
import { server } from '../test/server'
import { makeApplication, mockUpcoming, renderApp, signIn, url } from '../test/helpers'

// jsdom has no layout, so it cannot perform a real drag. Instead we wrap dnd-kit's
// DndContext to capture the handlers the board gives it, and call them with the events
// a real drag produces. That tests what OUR code does with a drop. Real dragging
// (mouse and keyboard) was verified by hand in a browser.
const dnd = vi.hoisted(() => ({ props: null as null | Record<string, any> })) // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: (props: Record<string, unknown>) => {
      dnd.props = props
      return createElement(actual.DndContext, props)
    },
  }
})

beforeEach(() => {
  signIn()
  mockUpcoming()
  dnd.props = null
})

const APPS = [
  makeApplication({ id: 1, company: 'Acme', role: 'Engineer', status: 'applied', date_applied: '2026-03-01' }),
  makeApplication({ id: 2, company: 'Globex', role: 'Analyst', status: 'interview', location: 'Remote', follow_up_date: '2000-01-01' }),
  makeApplication({ id: 3, company: 'Initech', role: 'Manager', status: 'interview' }),
  makeApplication({ id: 4, company: 'Hooli', role: 'Designer', status: 'rejected', follow_up_date: '2000-01-01' }),
]

/** A fake list endpoint over a mutable array, plus a PATCH that really changes it. */
function mockBackend(apps: Application[], opts: { total?: number; patchStatus?: number } = {}) {
  const data = apps.map((a) => ({ ...a }))
  const listCalls: URL[] = []
  const patches: { id: number; body: Record<string, unknown> }[] = []
  server.use(
    http.get(url('/applications'), ({ request }) => {
      const u = new URL(request.url)
      listCalls.push(u)
      const limit = Number(u.searchParams.get('limit') ?? 50)
      const offset = Number(u.searchParams.get('offset') ?? 0)
      return HttpResponse.json({ items: data.slice(offset, offset + limit), total: opts.total ?? data.length })
    }),
    http.patch(url('/applications/:id'), async ({ request, params }) => {
      const id = Number(params.id)
      const body = (await request.json()) as Record<string, unknown>
      patches.push({ id, body })
      if (opts.patchStatus && opts.patchStatus >= 400) return HttpResponse.json({ detail: 'Could not save that' }, { status: opts.patchStatus })
      const row = data.find((a) => a.id === id)!
      Object.assign(row, body)
      return HttpResponse.json({ ...row, history: [] })
    }),
  )
  return { data, listCalls, patches }
}

const column = (name: string) => screen.getByRole('region', { name: new RegExp(`^${name},`) })
const cardIn = (col: HTMLElement, company: string) => within(col).getByText(company).closest('li')!
const drop = (activeId: string, overId: string | null) =>
  act(() => {
    dnd.props!.onDragEnd({ active: { id: activeId }, over: overId === null ? null : { id: overId } })
  })

describe('switching between list and board', () => {
  it('starts on the list, and the toggle shows which view is current', async () => {
    mockBackend(APPS)
    renderApp('/applications')
    await screen.findByText('Acme')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('region', { name: /^Applied,/ })).not.toBeInTheDocument()
  })

  it('shows the board and asks the API for everything at once, without pages', async () => {
    const user = userEvent.setup()
    const { listCalls } = mockBackend(APPS)
    renderApp('/applications')
    await screen.findByText('Acme')

    await user.click(screen.getByRole('button', { name: 'Board' }))

    await screen.findByRole('region', { name: /^Applied, 1/ })
    const last = listCalls.at(-1)!
    expect(last.searchParams.get('limit')).toBe('200')
    expect(last.searchParams.get('offset')).toBe('0')
    expect(screen.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument()
  })

  it('opens straight to the board from the address (?view=board), so a refresh keeps it', async () => {
    mockBackend(APPS)
    renderApp('/applications?view=board')
    expect(await screen.findByRole('region', { name: /^Applied, 1/ })).toBeInTheDocument()
  })

  it('goes back to the list', async () => {
    const user = userEvent.setup()
    const { listCalls } = mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    await user.click(screen.getByRole('button', { name: 'List' }))

    expect(await screen.findByText('Company and role')).toBeInTheDocument() // the list's column headings are back
    await waitFor(() => expect(screen.queryByRole('region', { name: /^Applied,/ })).not.toBeInTheDocument())
    expect(listCalls.at(-1)!.searchParams.get('limit')).toBe('20')
  })

  it('hides the status filter on the board (the columns are the statuses) but keeps the others', async () => {
    mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })
    expect(screen.queryByRole('combobox', { name: 'Filter by status' })).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Company' })).toBeInTheDocument()
    expect(screen.getByLabelText('Applied from')).toBeInTheDocument()
  })

  it('ignores a status filter chosen in the list when showing the board', async () => {
    const user = userEvent.setup()
    const { listCalls } = mockBackend(APPS)
    renderApp('/applications')
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Filter by status' }), 'applied')
    await waitFor(() => expect(listCalls.at(-1)!.searchParams.get('status')).toBe('applied'))

    await user.click(screen.getByRole('button', { name: 'Board' }))

    await screen.findByRole('region', { name: /^Interview,/ })
    expect(listCalls.at(-1)!.searchParams.has('status')).toBe(false) // otherwise five columns would be empty
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('applies search and company filters to the board', async () => {
    const user = userEvent.setup()
    const { listCalls } = mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    await user.type(screen.getByRole('searchbox', { name: 'Company' }), 'glob')

    await waitFor(() => expect(listCalls.at(-1)!.searchParams.get('company')).toBe('glob'))
    expect(listCalls.at(-1)!.searchParams.get('limit')).toBe('200')
  })
})

describe('the board', () => {
  it('puts each application in the column for its status, with counts', async () => {
    mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    expect(column('Applied')).toHaveAccessibleName('Applied, 1')
    expect(column('Interview')).toHaveAccessibleName('Interview, 2')
    expect(column('Rejected')).toHaveAccessibleName('Rejected, 1')
    expect(within(column('Interview')).getByText('Globex')).toBeInTheDocument()
    expect(within(column('Interview')).getByText('Initech')).toBeInTheDocument()
    expect(within(column('Applied')).queryByText('Globex')).not.toBeInTheDocument()
  })

  it('shows all six columns, saying so when one is empty', async () => {
    mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    expect(screen.getAllByRole('region')).toHaveLength(6)
    expect(within(column('Screening')).getByText('Nothing here.')).toBeInTheDocument()
    expect(within(column('Offer')).getByText('Nothing here.')).toBeInTheDocument()
  })

  it('shows company, role, location, date, and a link to the application', async () => {
    mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    const card = cardIn(column('Interview'), 'Globex')
    expect(card).toHaveTextContent('Analyst, Remote')
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/applications/2')
  })

  it('highlights an overdue follow-up on an open application, but not on a rejected one', async () => {
    mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    expect(cardIn(column('Interview'), 'Globex').querySelector('mark')).toHaveTextContent('Jan 1, 2000')
    expect(cardIn(column('Interview'), 'Globex')).toHaveTextContent(/overdue/i)
    expect(cardIn(column('Rejected'), 'Hooli').querySelector('mark')).toBeNull() // has a past date, but it is closed
  })

  it('says when only part of a large logbook is shown', async () => {
    mockBackend(APPS, { total: 350 })
    renderApp('/applications?view=board')
    expect(await screen.findByText(/showing the newest 4 of 350/i)).toBeInTheDocument()
  })

  it('every card has a labelled grip for keyboard and screen-reader users', async () => {
    mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    const grip = screen.getByRole('button', { name: 'Move Acme' })
    expect(grip).toHaveAttribute('aria-roledescription', 'draggable')
  })
})

describe('moving a card', () => {
  it('a drop on another column changes the status: the card moves at once and the server is told', async () => {
    const { patches } = mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied, 1/ })

    drop('app:1', 'column:screening')

    // Immediately, before the server has answered:
    expect(within(column('Screening')).getByText('Acme')).toBeInTheDocument()
    expect(column('Applied')).toHaveAccessibleName('Applied, 0')
    await waitFor(() => expect(patches).toEqual([{ id: 1, body: { status: 'screening' } }]))
  })

  it('sends only the new status', async () => {
    const { patches } = mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })
    drop('app:3', 'column:offer')
    await waitFor(() => expect(patches).toHaveLength(1))
    expect(patches[0].body).toEqual({ status: 'offer' })
  })

  it('dropping on the column it is already in does nothing', async () => {
    const { patches } = mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    drop('app:1', 'column:applied')
    await new Promise((r) => setTimeout(r, 50))

    expect(patches).toEqual([])
  })

  it('dropping outside every column does nothing', async () => {
    const { patches } = mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    drop('app:1', null)
    await new Promise((r) => setTimeout(r, 50))

    expect(patches).toEqual([])
    expect(within(column('Applied')).getByText('Acme')).toBeInTheDocument()
  })

  it('ignores a drop on something that is not a column', async () => {
    const { patches } = mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    drop('app:1', 'app:2')
    await new Promise((r) => setTimeout(r, 50))

    expect(patches).toEqual([])
  })

  it('puts the card back and explains when the server refuses', async () => {
    mockBackend(APPS, { patchStatus: 500 })
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied, 1/ })

    drop('app:1', 'column:offer')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that')
    await waitFor(() => expect(within(column('Applied')).getByText('Acme')).toBeInTheDocument())
    expect(within(column('Offer')).queryByText('Acme')).not.toBeInTheDocument()
    expect(column('Applied')).toHaveAccessibleName('Applied, 1')
  })

  it('locks a card while its move is being saved, then frees it', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { data } = mockBackend(APPS)
    server.use(
      http.patch(url('/applications/1'), async () => {
        await gate
        data[0].status = 'screening'
        return HttpResponse.json({ ...data[0], history: [] })
      }),
    )
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    drop('app:1', 'column:screening')

    const card = within(column('Screening')).getByText('Acme').closest('li')!
    expect(card).toHaveAttribute('aria-busy', 'true')
    expect(within(card).getByRole('combobox')).toBeDisabled()
    release()
    await waitFor(() => expect(within(column('Screening')).getByText('Acme').closest('li')).toHaveAttribute('aria-busy', 'false'))
  })

  it('the status dropdown on a card is a way to move it without dragging', async () => {
    const user = userEvent.setup()
    const { patches } = mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status for Acme' }), 'interview')

    await waitFor(() => expect(patches).toEqual([{ id: 1, body: { status: 'interview' } }]))
    expect(within(column('Interview')).getByText('Acme')).toBeInTheDocument()
  })

  it('refreshes from the server after a move, and refreshes the follow-up reminders', async () => {
    const { listCalls } = mockBackend(APPS)
    let upcomingCalls = 0
    server.use(
      http.get(url('/applications/upcoming'), () => {
        upcomingCalls++
        return HttpResponse.json([])
      }),
    )
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })
    const before = { lists: listCalls.length, upcoming: upcomingCalls }

    drop('app:4', 'column:withdrawn')

    await waitFor(() => expect(listCalls.length).toBe(before.lists + 1))
    expect(upcomingCalls).toBe(before.upcoming + 1)
  })
})

describe('accessibility announcements', () => {
  async function announcements() {
    mockBackend(APPS)
    renderApp('/applications?view=board')
    await screen.findByRole('region', { name: /^Applied,/ })
    return dnd.props!.accessibility.announcements as Record<string, (e: unknown) => string>
  }

  it('says what was picked up and where it is', async () => {
    const a = await announcements()
    expect(a.onDragStart({ active: { id: 'app:2' } })).toBe('Picked up Globex, currently in Interview.')
  })

  it('says which column the card is over, and when it is over none', async () => {
    const a = await announcements()
    expect(a.onDragOver({ active: { id: 'app:2' }, over: { id: 'column:offer' } })).toBe('Globex is over Offer.')
    expect(a.onDragOver({ active: { id: 'app:2' }, over: null })).toBe('Globex is not over a column.')
  })

  it('says where it was dropped, and that cancelling changed nothing', async () => {
    const a = await announcements()
    expect(a.onDragEnd({ active: { id: 'app:2' }, over: { id: 'column:rejected' } })).toBe('Globex was dropped in Rejected.')
    expect(a.onDragEnd({ active: { id: 'app:2' }, over: null })).toBe('Globex was dropped. Nothing changed.')
    expect(a.onDragCancel({ active: { id: 'app:2' } })).toBe('Moving Globex was cancelled. Nothing changed.')
  })
})

describe('Board on its own', () => {
  function renderBoard(onMove = vi.fn()) {
    render(
      <MemoryRouter>
        <Board items={APPS} moving={new Set()} onMove={onMove} />
      </MemoryRouter>,
    )
    return onMove
  }

  it('reports a drop on a different column to its parent, and only then', () => {
    const onMove = renderBoard()
    drop('app:1', 'column:applied') // where it already is
    expect(onMove).not.toHaveBeenCalled()

    drop('app:1', 'column:offer')
    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 1, company: 'Acme' }), 'offer')
  })

  it('does not report drops with nowhere valid to land', () => {
    const onMove = renderBoard()
    drop('app:1', null)
    drop('app:1', 'app:2')
    drop('app:999', 'column:offer') // an application the board does not know about
    expect(onMove).not.toHaveBeenCalled()
  })
})
