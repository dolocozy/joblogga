import { useId, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { addTags, MAX_TAGS } from '../tags'

interface Props {
  // The id and aria props the surrounding Field hands to its control.
  control: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; 'aria-required'?: true }
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[] // tags this person has used before, offered as they type
}

/**
 * Tags as little chips with a text box after them. Type a tag and press Enter or a comma to add it; Backspace in an empty
 * box removes the last one; leaving the box adds what was typed, so clicking Save never loses a half-finished tag.
 * What is added is normalised exactly as the server will store it.
 */
export default function TagsInput({ control, value, onChange, suggestions }: Props) {
  const listId = useId()
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const full = value.length >= MAX_TAGS

  function commit(text: string) {
    if (!text.trim()) return
    const result = addTags(value, text)
    setProblem(result.problem)
    onChange(result.tags)
    setDraft(result.problem ? text : '') // a rejected tag stays in the box, so it can be fixed
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      if (draft.trim()) {
        e.preventDefault() // Enter must not submit the form while a tag is being finished
        commit(draft)
      } else if (e.key !== 'Enter') {
        e.preventDefault() // a stray comma is not a tag
      }
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div>
      {value.length > 0 && (
        <ul aria-label="Chosen tags" className="mb-2 flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <li key={tag} className="inline-flex items-center gap-1 rounded-field border border-pencil bg-sheet pl-2 text-sm">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => onChange(value.filter((t) => t !== tag))}
                className="px-1.5 py-0.5 text-ink-soft hover:text-brick"
              >
                &times;
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        {...control}
        type="text"
        autoComplete="off"
        list={listId}
        value={draft}
        disabled={full}
        placeholder={full ? `At most ${MAX_TAGS} tags` : 'Add a tag, then press Enter'}
        onChange={(e) => {
          setDraft(e.target.value)
          setProblem(null)
          // A comma or semicolon typed or pasted ends a tag, even mid-text ("a, b").
          if (/[,;]/.test(e.target.value)) commit(e.target.value)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => commit(draft)}
        className="input"
      />
      <datalist id={listId}>
        {suggestions
          .filter((s) => !value.includes(s))
          .map((s) => (
            <option key={s} value={s} />
          ))}
      </datalist>
      {problem && (
        <p role="alert" className="mt-1 text-sm text-brick">
          {problem}
        </p>
      )}
    </div>
  )
}
