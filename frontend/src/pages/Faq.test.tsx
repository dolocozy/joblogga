import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { FAQS } from '../faq'
import { renderApp } from '../test/helpers'

describe('FAQ page at /faq', () => {
  it('opens without logging in and shows every question', async () => {
    renderApp('/faq')

    expect(await screen.findByRole('heading', { level: 1, name: 'Frequently asked questions' })).toBeInTheDocument()
    for (const { question } of FAQS) expect(screen.getByText(question)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
  })

  it('shows an answer when its question is opened, and keeps the others closed', async () => {
    const user = userEvent.setup()
    renderApp('/faq')

    const question = await screen.findByText('How is the response rate calculated?')
    const details = question.closest('details')!
    expect(details.open).toBe(false)
    expect(screen.getByText('Does it have a dark mode?').closest('details')!.open).toBe(false)

    await user.click(question)

    expect(details.open).toBe(true)
    expect(details).toHaveTextContent(/withdrew before hearing anything are left out/)
    expect(screen.getByText('Does it have a dark mode?').closest('details')!.open).toBe(false)
  })
})

describe('links to the FAQ', () => {
  it('is on the landing page', async () => {
    renderApp('/')
    expect(await screen.findByRole('link', { name: 'FAQ' })).toHaveAttribute('href', '/faq')
  })
})
