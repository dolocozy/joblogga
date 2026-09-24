import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { localToday } from '../dates'
import { server } from '../test/server'
import { makeDetail, renderApp, signIn, url } from '../test/helpers'

beforeEach(() => signIn())

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

    await user.type(await screen.findByLabelText('Company *'), '  Acme  ')
    await user.type(screen.getByLabelText('Role *'), 'Engineer')
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

    await user.type(await screen.findByLabelText('Company *'), 'Acme')
    await user.type(screen.getByLabelText('Role *'), 'Engineer')
    await user.selectOptions(screen.getByLabelText('Status'), 'screening')
    await user.type(screen.getByLabelText('Resume version'), 'tech-focused')
    await user.type(screen.getByLabelText('Notes'), 'Referred by Sam')
    await user.click(screen.getByRole('button', { name: 'Add application' }))

    await screen.findByRole('heading', { name: /Acme/ })
    expect(body).toMatchObject({ status: 'screening', resume_version: 'tech-focused', notes: 'Referred by Sam' })
  })

  it('does not submit without the required company and role', async () => {
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
    expect(screen.getByLabelText('Company *')).toBeInvalid()
  })

  it('shows server validation errors and lets the user fix and retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(url('/applications'), () =>
        HttpResponse.json({ detail: [{ msg: 'Value error, Job link must start with http:// or https://' }] }, { status: 422 }),
      ),
    )
    renderApp('/applications/new')

    await user.type(await screen.findByLabelText('Company *'), 'Acme')
    await user.type(screen.getByLabelText('Role *'), 'Engineer')
    await user.click(screen.getByRole('button', { name: 'Add application' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Job link must start with http:// or https://')
    expect(screen.getByLabelText('Company *')).toHaveValue('Acme') // input is kept
    expect(screen.getByRole('button', { name: 'Add application' })).toBeEnabled()
  })
})
