import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import Combobox from './Combobox'
import type { ComboOption } from './Combobox'

const OPTIONS: ComboOption[] = [
  { id: 1, label: 'Springfield, Illinois' },
  { id: 2, label: 'Springfield, Missouri' },
  { id: 3, label: 'Springfield, Ohio' },
]

// A small stand-in parent that keeps the choice, as the real forms do.
function Harness({ options = OPTIONS, onInput, minChars = 1, disabled = false }: { options?: ComboOption[]; onInput?: (t: string) => void; minChars?: number; disabled?: boolean }) {
  const [selected, setSelected] = useState<ComboOption | null>(null)
  return (
    <>
      <label htmlFor="c">City</label>
      <Combobox control={{ id: 'c' }} options={options} selected={selected} onSelect={setSelected} onInput={onInput} emptyText="Nothing matches." minChars={minChars} disabled={disabled} />
      <p data-testid="chosen">{selected ? selected.id : 'none'}</p>
    </>
  )
}

const box = () => screen.getByRole('combobox', { name: 'City' })

describe('Combobox', () => {
  it('is a labelled combobox that starts closed, with nothing chosen', () => {
    render(<Harness />)
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    expect(box()).toHaveAttribute('aria-autocomplete', 'list')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByTestId('chosen')).toHaveTextContent('none')
  })

  it('opens a list of options as you type, and reports each edit', async () => {
    const user = userEvent.setup()
    const seen: string[] = []
    render(<Harness onInput={(t) => seen.push(t)} />)
    await user.type(box(), 'spr')
    expect(box()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(OPTIONS.map((o) => o.label))
    expect(seen).toEqual(['s', 'sp', 'spr'])
    expect(box()).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
  })

  it('waits for the minimum number of characters before offering anything', async () => {
    const user = userEvent.setup()
    render(<Harness minChars={2} />)
    await user.type(box(), 's')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    await user.type(box(), 'p')
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('chooses with a click, shows the choice in the box, and closes', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'spr')
    await user.click(screen.getByRole('option', { name: 'Springfield, Missouri' }))
    expect(box()).toHaveValue('Springfield, Missouri')
    expect(screen.getByTestId('chosen')).toHaveTextContent('2')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
  })

  it('chooses with the keyboard: arrows move, Enter picks, and the highlighted option is announced', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'spr')
    expect(box()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0].id)
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
    expect(box()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2].id)
    await user.keyboard('{ArrowUp}{Enter}')
    expect(screen.getByTestId('chosen')).toHaveTextContent('2')
  })

  it('does not run past either end of the list', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'spr')
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
  })

  it('Escape closes the list without choosing', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'spr')
    await user.keyboard('{Escape}')
    expect(box()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('chosen')).toHaveTextContent('none')
  })

  it('Enter with the list closed is left alone, so it can submit a form', async () => {
    const user = userEvent.setup()
    const submit = vi.fn((e: Event) => e.preventDefault())
    render(
      <form onSubmit={submit as never}>
        <Harness />
        <button type="submit">Go</button>
      </form>,
    )
    await user.click(box())
    await user.keyboard('{Enter}') // nothing typed, nothing listed
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('editing the text after choosing clears the choice, and keeps what was typed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(box(), 'spr')
    await user.click(screen.getByRole('option', { name: 'Springfield, Ohio' }))
    await user.type(box(), 'x')
    expect(screen.getByTestId('chosen')).toHaveTextContent('none') // a stale choice is never left behind
    expect(box()).toHaveValue('Springfield, Ohiox') // and the person's typing is not wiped
  })

  it('says so when nothing matches', async () => {
    const user = userEvent.setup()
    render(<Harness options={[]} />)
    await user.type(box(), 'zzz')
    expect(screen.getByRole('status')).toHaveTextContent('Nothing matches.')
  })

  it('cannot be used when disabled', async () => {
    const user = userEvent.setup()
    render(<Harness disabled />)
    expect(box()).toBeDisabled()
    await user.type(box(), 'spr')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
