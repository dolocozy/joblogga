import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import TagsInput from './TagsInput'

function Harness({ initial = [], suggestions = [], onSubmit }: { initial?: string[]; suggestions?: string[]; onSubmit?: () => void }) {
  const [tags, setTags] = useState(initial)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
    >
      <label htmlFor="t">Tags</label>
      <TagsInput control={{ id: 't' }} value={tags} onChange={setTags} suggestions={suggestions} />
      <p data-testid="value">{JSON.stringify(tags)}</p>
      <button type="submit">Save</button>
    </form>
  )
}

const box = () => screen.getByRole('combobox', { name: 'Tags' }) // an input with a suggestions list is a combobox
const value = () => JSON.parse(screen.getByTestId('value').textContent!)

describe('TagsInput', () => {
  it('adds a tag on Enter, normalised, and clears the box', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'Dream Job{Enter}')
    expect(value()).toEqual(['dream job'])
    expect(box()).toHaveValue('')
    expect(screen.getByRole('list', { name: 'Chosen tags' })).toHaveTextContent('dream job')
  })

  it('does not submit the form when Enter finishes a tag, but does when the box is empty', async () => {
    const user = userEvent.setup()
    const submit = vi.fn()
    render(<Harness onSubmit={submit} />)
    await user.type(box(), 'referral{Enter}')
    expect(submit).not.toHaveBeenCalled()
    await user.type(box(), '{Enter}')
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('adds a tag when a comma or semicolon is typed, and splits a pasted list', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'a,')
    expect(value()).toEqual(['a'])
    await user.click(box())
    await user.paste('B; c, d')
    expect(value()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('adds what was typed when the box is left, so Save never loses a half-finished tag', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'backup option')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(value()).toEqual(['backup option'])
  })

  it('shows existing tags as chips, each with a remove button that names it', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['a', 'b']} />)
    await user.click(screen.getByRole('button', { name: 'Remove tag a' }))
    expect(value()).toEqual(['b'])
  })

  it('Backspace in an empty box removes the last tag, but not while typing', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['a', 'b']} />)
    await user.click(box())
    await user.type(box(), 'x{Backspace}')
    expect(value()).toEqual(['a', 'b']) // that Backspace only deleted the "x"
    await user.keyboard('{Backspace}')
    expect(value()).toEqual(['a'])
  })

  it('ignores a repeat, in any case', async () => {
    const user = userEvent.setup()
    render(<Harness initial={['dream job']} />)
    await user.type(box(), 'DREAM JOB{Enter}')
    expect(value()).toEqual(['dream job'])
  })

  it('says why a too-long tag was not added, and leaves it in the box to be shortened', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), `${'x'.repeat(31)}{Enter}`)
    expect(screen.getByRole('alert')).toHaveTextContent('at most 30 characters')
    expect(value()).toEqual([])
    expect(box()).toHaveValue('x'.repeat(31))
    await user.type(box(), '{Backspace}')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // the message goes as soon as it is being fixed
  })

  it('stops at ten tags: the box is disabled and says so', () => {
    render(<Harness initial={Array.from({ length: 10 }, (_, i) => `t${i}`)} />)
    expect(box()).toBeDisabled()
    expect(box()).toHaveAttribute('placeholder', 'At most 10 tags')
  })

  it('offers tags used before as suggestions, leaving out the ones already on', () => {
    render(<Harness initial={['referral']} suggestions={['referral', 'dream job', 'backup option']} />)
    const options = Array.from(document.querySelectorAll('datalist option')).map((o) => o.getAttribute('value'))
    expect(options).toEqual(['dream job', 'backup option'])
    expect(box()).toHaveAttribute('list', document.querySelector('datalist')!.id)
  })

  it('a stray comma is not a tag', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), ',')
    expect(value()).toEqual([])
    expect(box()).toHaveValue('')
  })
})
