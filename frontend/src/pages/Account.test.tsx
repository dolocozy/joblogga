import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { tokenStore } from '../api'
import { server } from '../test/server'
import { mockList, mockUpcoming, renderApp, signIn, url, USER } from '../test/helpers'

function watchDelete(reply: () => Response = () => new HttpResponse(null, { status: 204 })) {
  const bodies: unknown[] = []
  server.use(
    http.post(url('/auth/delete-account'), async ({ request }) => {
      bodies.push(await request.json())
      return reply()
    }),
  )
  return bodies
}

const openConfirm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Delete my account…' }))
  return screen.findByLabelText('Enter your password to confirm')
}
const confirmButton = () => screen.getByRole('button', { name: 'Permanently delete my account' })

describe('reaching the account page', () => {
  it('is linked from the email in the header', async () => {
    const user = userEvent.setup()
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/applications')

    await user.click(await screen.findByRole('link', { name: `Account: ${USER.email}` }))

    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument()
    expect(screen.getByText('Email address verified.')).toBeInTheDocument()
  })

  it('is for logged-in users only', async () => {
    renderApp('/account')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })
})

describe('deleting the account', () => {
  it('shows nothing destructive until asked, then explains what will go and asks for the password', async () => {
    const user = userEvent.setup()
    signIn()
    renderApp('/account')

    await screen.findByRole('heading', { name: 'Account' })
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Permanently delete my account' })).not.toBeInTheDocument()

    await openConfirm(user)
    expect(screen.getByText(`This will delete ${USER.email} and everything in it, for good.`)).toBeInTheDocument()
    expect(confirmButton()).toBeInTheDocument()
  })

  it('cancelling closes the panel, forgets the password, and sends nothing', async () => {
    const user = userEvent.setup()
    signIn()
    const bodies = watchDelete()
    renderApp('/account')

    await user.type(await openConfirm(user), 'secret-password')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Enter your password to confirm')).not.toBeInTheDocument()

    expect(await openConfirm(user)).toHaveValue('')
    expect(bodies).toHaveLength(0)
  })

  it('will not send an empty password, and says why next to the field', async () => {
    const user = userEvent.setup()
    signIn()
    const bodies = watchDelete()
    renderApp('/account')
    await openConfirm(user)

    await user.click(confirmButton())

    expect(screen.getByText('Enter your password')).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('sends the password, ends the session, and says so on the login page', async () => {
    const user = userEvent.setup()
    signIn()
    const bodies = watchDelete()
    renderApp('/account')

    await user.type(await openConfirm(user), 'correct-horse-battery')
    await user.click(confirmButton())

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your account and all of its data have been deleted.')
    expect(bodies).toEqual([{ password: 'correct-horse-battery' }])
    expect(tokenStore.get()).toBeNull()
  })

  it('a wrong password shows the server message and leaves them logged in', async () => {
    const user = userEvent.setup()
    signIn()
    watchDelete(() => HttpResponse.json({ detail: 'Incorrect password' }, { status: 403 }))
    renderApp('/account')

    await user.type(await openConfirm(user), 'nope-nope-nope')
    await user.click(confirmButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password')
    expect(tokenStore.get()).toBe('valid-token')
    expect(confirmButton()).toBeEnabled() // they can try again
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
  })

  it('the login notice goes away on the next visit', async () => {
    const user = userEvent.setup()
    signIn()
    watchDelete()
    renderApp('/account')
    await user.type(await openConfirm(user), 'correct-horse-battery')
    await user.click(confirmButton())
    await screen.findByRole('status')

    // A fresh page load has no memory of it.
    document.body.innerHTML = ''
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.queryByText(/have been deleted/)).not.toBeInTheDocument()
  })
})

describe('exporting from the account page', () => {
  it('offers the CSV export so data can be saved first', async () => {
    signIn()
    renderApp('/account')
    expect(await screen.findByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  })
})

describe('importing a CSV', () => {
  const EMPTY = { total_rows: 0, blank_rows: 0, added: 0, skipped: [], duplicates: [], adjusted: [] }
  const csv = (name = 'jobs.csv') => new File(['Company,Role\r\nAcme,Engineer\r\n'], name, { type: 'text/csv' })

  function watchImport(reply: () => Response = () => HttpResponse.json({ ...EMPTY, total_rows: 1, added: 1 })) {
    const calls: { url: URL; type: string | null; body: string }[] = []
    server.use(
      http.post(url('/applications/import'), async ({ request }) => {
        calls.push({ url: new URL(request.url), type: request.headers.get('content-type'), body: await request.text() })
        return reply()
      }),
    )
    return calls
  }
  const importButton = () => screen.getByRole('button', { name: 'Import' })

  it('has an import section, with Import off until a file is chosen', async () => {
    signIn()
    renderApp('/account')
    expect(await screen.findByRole('heading', { name: 'Import from a CSV' })).toBeInTheDocument()
    expect(importButton()).toBeDisabled()
    expect(screen.getByLabelText('CSV file')).toBeInTheDocument()
  })

  it('uploads the file as it is, as text/csv, skipping duplicates unless told otherwise', async () => {
    const user = userEvent.setup()
    signIn()
    const calls = watchImport()
    renderApp('/account')
    await user.upload(await screen.findByLabelText('CSV file'), csv())
    expect(importButton()).toBeEnabled()
    await user.click(importButton())

    expect(await screen.findByRole('region', { name: 'Import result' })).toBeInTheDocument()
    expect(calls).toHaveLength(1)
    expect(calls[0].type).toContain('text/csv') // not application/json
    expect(calls[0].body).toBe('Company,Role\r\nAcme,Engineer\r\n')
    expect(calls[0].url.searchParams.get('skip_duplicates')).toBe('true')
  })

  it('keeps duplicates when the box is unticked', async () => {
    const user = userEvent.setup()
    signIn()
    const calls = watchImport()
    renderApp('/account')
    await user.upload(await screen.findByLabelText('CSV file'), csv())
    await user.click(screen.getByRole('checkbox', { name: /Skip rows that match an application/ }))
    await user.click(importButton())
    await screen.findByRole('region', { name: 'Import result' })
    expect(calls[0].url.searchParams.get('skip_duplicates')).toBe('false')
  })

  it('says how many were added, with a link to them', async () => {
    const user = userEvent.setup()
    signIn()
    watchImport(() => HttpResponse.json({ ...EMPTY, total_rows: 37, added: 37 }))
    renderApp('/account')
    await user.upload(await screen.findByLabelText('CSV file'), csv())
    await user.click(importButton())

    const result = await screen.findByRole('region', { name: 'Import result' })
    expect(within(result).getByRole('status')).toHaveTextContent('Imported 37 applications.')
    expect(within(result).getByRole('link', { name: 'View your applications' })).toHaveAttribute('href', '/applications')
    expect(within(result).queryByText(/skipped/)).not.toBeInTheDocument()
  })

  it('says what was skipped and why, grouped by reason, with the row numbers', async () => {
    const user = userEvent.setup()
    signIn()
    watchImport(() =>
      HttpResponse.json({
        ...EMPTY,
        total_rows: 8,
        added: 4,
        blank_rows: 1,
        skipped: [
          { row: 3, reason: 'missing company name' },
          { row: 7, reason: 'missing company name' },
          { row: 5, reason: 'missing role' },
        ],
        duplicates: [{ row: 2, reason: 'Acme, Engineer is already in your applications' }],
        adjusted: [{ row: 4, reason: "date applied 'soon' could not be read (use YYYY-MM-DD), so it was left empty" }],
      }),
    )
    renderApp('/account')
    await user.upload(await screen.findByLabelText('CSV file'), csv())
    await user.click(importButton())

    const result = await screen.findByRole('region', { name: 'Import result' })
    expect(within(result).getByRole('status')).toHaveTextContent('Imported 4 applications.')
    expect(result).toHaveTextContent('3 rows skipped because they could not be imported.')
    expect(result).toHaveTextContent('1 row left out as duplicates of applications you already have.')
    expect(result).toHaveTextContent('1 note about values that were left empty or filled in.')
    expect(result).toHaveTextContent('1 blank row ignored.')
    const skipped = within(within(result).getByRole('region', { name: 'Skipped rows' }))
    expect(skipped.getByText(/missing company name/)).toHaveTextContent('(rows 3 and 7)')
    expect(skipped.getByText(/missing role/)).toHaveTextContent('(row 5)')
    // the less urgent lists are there, folded away until opened
    expect(within(result).getByText('Left out as duplicates').closest('details')).not.toHaveAttribute('open')
    expect(within(result).getByText('Adjusted values').closest('details')).toContainElement(within(result).getByText(/could not be read/))
  })

  it('says plainly when nothing was imported', async () => {
    const user = userEvent.setup()
    signIn()
    watchImport(() => HttpResponse.json({ ...EMPTY, total_rows: 2, duplicates: [{ row: 2, reason: 'A, B is already in your applications' }, { row: 3, reason: 'C, D is already in your applications' }] }))
    renderApp('/account')
    await user.upload(await screen.findByLabelText('CSV file'), csv())
    await user.click(importButton())
    const result = await screen.findByRole('region', { name: 'Import result' })
    expect(within(result).getByRole('status')).toHaveTextContent('Nothing was imported.')
    expect(within(result).queryByRole('link', { name: 'View your applications' })).not.toBeInTheDocument()
  })

  it('shows the server message for a file it cannot use, and no result', async () => {
    const user = userEvent.setup()
    signIn()
    watchImport(() => HttpResponse.json({ detail: 'The first row must name the columns, and the file needs a Role column.' }, { status: 422 }))
    renderApp('/account')
    await user.upload(await screen.findByLabelText('CSV file'), csv())
    await user.click(importButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('needs a Role column')
    expect(screen.queryByRole('region', { name: 'Import result' })).not.toBeInTheDocument()
    expect(importButton()).toBeEnabled() // a corrected file can be tried straight away
  })

  it('clears an old result when a different file is chosen', async () => {
    const user = userEvent.setup()
    signIn()
    watchImport()
    renderApp('/account')
    const input = await screen.findByLabelText('CSV file')
    await user.upload(input, csv('one.csv'))
    await user.click(importButton())
    await screen.findByRole('region', { name: 'Import result' })

    await user.upload(input, csv('two.csv'))

    expect(screen.queryByRole('region', { name: 'Import result' })).not.toBeInTheDocument()
  })

  it('is reachable from an empty applications list', async () => {
    signIn()
    mockList([])
    mockUpcoming()
    renderApp('/applications')
    expect(await screen.findByRole('link', { name: 'import a spreadsheet' })).toHaveAttribute('href', '/account')
  })
})
