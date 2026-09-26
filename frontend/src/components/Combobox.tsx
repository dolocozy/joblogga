import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

export interface ComboOption {
  id: number
  label: string // what is shown in the list and, once chosen, in the box
}

interface Props {
  // The id and aria props the surrounding Field hands to its control.
  control: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; 'aria-required'?: true }
  options: ComboOption[] // what to offer for the current text; the parent decides how they were found
  selected: ComboOption | null
  onSelect: (option: ComboOption | null) => void // null: the person edited the text, so nothing is chosen any more
  onInput?: (text: string) => void // called on every edit, so the parent can search
  placeholder?: string
  disabled?: boolean
  busy?: boolean // the parent is still fetching options
  emptyText: string // said when the person has typed something and nothing matches
  minChars?: number // how much to type before options are offered
}

/**
 * A text box with a list of choices under it (the ARIA "combobox" pattern): type to narrow the list, arrow keys
 * and Enter to choose, Escape to close. Choosing sets `selected`, and editing the text afterwards clears it,
 * so what is shown in the box is never a stale choice.
 */
export default function Combobox({ control, options, selected, onSelect, onInput, placeholder, disabled, busy, emptyText, minChars = 1 }: Props) {
  const listId = useId()
  const [text, setText] = useState(selected?.label ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapper = useRef<HTMLDivElement>(null)

  // Follow the parent when it sets or clears the choice (for example when the country changes). Not when the
  // choice was cleared BY typing: the text is then what the person is in the middle of writing.
  const clearedByTyping = useRef(false)
  useEffect(() => {
    if (clearedByTyping.current) {
      clearedByTyping.current = false
      return
    }
    setText(selected?.label ?? '')
  }, [selected])

  const typed = text.trim().length
  const listed = open && !disabled && !selected && typed >= minChars
  const optionId = (i: number) => `${listId}-opt-${i}`

  function choose(option: ComboOption) {
    setText(option.label)
    setOpen(false)
    onSelect(option)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(options.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      // Choose the highlighted option; with the list closed, Enter submits the form as usual.
      if (listed && options[active]) {
        e.preventDefault()
        choose(options[active])
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault() // keeps a surrounding dialog or form from also reacting
        setOpen(false)
      }
    }
  }

  return (
    <div
      ref={wrapper}
      className="relative"
      // Leaving the whole control (not just the input) closes the list, so clicking an option still counts as inside.
      onBlur={(e) => {
        if (!wrapper.current?.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <input
        {...control}
        role="combobox"
        type="text"
        autoComplete="off"
        aria-expanded={listed}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listed && options[active] ? optionId(active) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
          if (selected) {
            clearedByTyping.current = true
            onSelect(null)
          }
          onInput?.(e.target.value)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="input"
      />
      <ul
        id={listId}
        role="listbox"
        hidden={!listed || options.length === 0}
        className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-field border border-pencil bg-sheet py-1"
      >
        {options.map((option, i) => (
          <li
            key={option.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            // mousedown, not click: the input's blur would close the list before a click could land.
            onMouseDown={(e) => {
              e.preventDefault()
              choose(option)
            }}
            onMouseEnter={() => setActive(i)}
            className={`cursor-pointer px-3 py-1.5 text-sm ${i === active ? 'bg-pine/10' : ''}`}
          >
            {option.label}
          </li>
        ))}
      </ul>
      {listed && options.length === 0 && (
        <p role="status" className="mt-1 text-sm text-ink-soft">
          {busy ? 'Searching…' : emptyText}
        </p>
      )}
    </div>
  )
}
