import type { ReactNode } from 'react'

interface ControlProps {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
  'aria-required'?: true
}

interface Props {
  id: string
  label: string
  required?: boolean
  hint?: string // shown in soft ink until there is an error to show instead
  error?: string | null
  children: (control: ControlProps) => ReactNode // renders the input/select/textarea
}

// A labelled form control with its message underneath. The message (hint or
// error) is tied to the control with aria-describedby, so screen readers read it
// with the field, and errors don't rely on color alone: they are text.
export default function Field({ id, label, required, hint, error, children }: Props) {
  const messageId = `${id}-message`
  const message = error ?? hint
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        {required && (
          <span aria-hidden className="text-xs text-ink-soft">
            required
          </span>
        )}
      </div>
      <div className="mt-1">
        {children({
          id,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': message ? messageId : undefined,
          'aria-required': required ? true : undefined,
        })}
      </div>
      {message && (
        <p id={messageId} className={`mt-1 text-sm ${error ? 'text-brick' : 'text-ink-soft'}`}>
          {message}
        </p>
      )}
    </div>
  )
}
