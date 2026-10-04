import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { addContact, deleteContact, updateContact } from '../api'
import type { Contact, ContactInput } from '../api'
import { useFieldErrors } from '../hooks'
import { safePostingUrl } from '../links'
import { httpUrlRule, required } from '../validation'
import Field from './Field'

export const MAX_CONTACTS = 10

// An email becomes a mailto link only if it looks like a plain address; anything odd is shown as text. (The server has
// already judged the address, this only keeps a surprising value from becoming a surprising link.)
const mailto = (email: string) => (/^[^\s@<>"]+@[^\s@<>"]+$/.test(email) ? `mailto:${email}` : null)

function ContactForm({ initial, onSave, onCancel }: { initial?: Contact; onSave: (input: ContactInput) => Promise<void>; onCancel: () => void }) {
  const base = useId()
  const id = (n: string) => `${base}-${n}`
  const [name, setName] = useState(initial?.name ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [linkedin, setLinkedin] = useState(initial?.linkedin_url ?? '')
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fields = useFieldErrors({ name: required("Enter the person's name")(name), linkedin_url: httpUrlRule(linkedin) }, id)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setServerError(null)
    if (!fields.validateAll()) return
    setSaving(true)
    try {
      await onSave({ name: name.trim(), title: title.trim() || null, email: email.trim() || null, linkedin_url: linkedin.trim() || null })
    } catch (err) {
      // The server judges an email address; its own message is shown here, as on every other form.
      setServerError(err instanceof Error ? err.message : 'Something went wrong')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={initial ? `Edit ${initial.name}` : 'Add a contact'} className="sheet space-y-3 p-3">
      {serverError && (
        <p role="alert" className="border-l-2 border-brick bg-brick/5 px-3 py-2 text-sm text-brick-deep">
          {serverError}
        </p>
      )}
      <Field id={id('name')} label="Name" required error={fields.error('name')}>
        {(c) => (
          <input
            {...c}
            maxLength={200}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              fields.visit('name')
            }}
            onBlur={() => fields.visit('name')}
            className="input"
          />
        )}
      </Field>
      <Field id={id('title')} label="Role or title">
        {(c) => <input {...c} maxLength={100} placeholder="For example, Recruiter" value={title} onChange={(e) => setTitle(e.target.value)} className="input" />}
      </Field>
      <Field id={id('email')} label="Email">
        {(c) => <input {...c} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="input" />}
      </Field>
      <Field id={id('linkedin')} label="LinkedIn link" error={fields.error('linkedin_url')}>
        {(c) => (
          <input
            {...c}
            type="url"
            placeholder="https://"
            value={linkedin}
            onChange={(e) => {
              setLinkedin(e.target.value)
              fields.settle('linkedin_url') // a link is wrong until it is finished: wait for a pause
            }}
            onBlur={() => fields.visit('linkedin_url')}
            className="input"
          />
        )}
      </Field>
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
          {saving ? 'Saving…' : initial ? 'Save contact' : 'Add contact'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="btn btn-secondary btn-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}

interface Props {
  applicationId: number
  contacts: Contact[]
  onChange: (contacts: Contact[]) => void // the whole new list, after the server has accepted a change
}

// The people you have dealt with at this company. Detail, not at-a-glance, so it lives on the detail page only. Each
// add, edit and remove is saved on its own, straight away: there is no separate Save for the list.
export default function ContactsSection({ applicationId, contacts, onChange }: Props) {
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const full = contacts.length >= MAX_CONTACTS

  async function remove(contact: Contact) {
    if (!window.confirm(`Remove ${contact.name} from this application?`)) return
    setError(null)
    try {
      await deleteContact(applicationId, contact.id)
      onChange(contacts.filter((c) => c.id !== contact.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that contact')
    }
  }

  return (
    <section aria-labelledby="contacts-heading">
      <h2 id="contacts-heading" className="mb-2 border-b-2 border-ink pb-2 text-lg">
        Contacts
      </h2>

      {contacts.length === 0 && editing !== 'new' && (
        <p className="py-2 text-sm text-ink-soft">No contacts yet. Add the recruiter or hiring manager you have dealt with.</p>
      )}

      <ul>
        {contacts.map((c) =>
          editing === c.id ? (
            <li key={c.id} className="border-b border-rule py-3">
              <ContactForm
                initial={c}
                onCancel={() => setEditing(null)}
                onSave={async (input) => {
                  const saved = await updateContact(applicationId, c.id, input)
                  onChange(contacts.map((x) => (x.id === c.id ? saved : x)))
                  setEditing(null)
                }}
              />
            </li>
          ) : (
            <li key={c.id} className="border-b border-rule py-3 text-sm">
              <p className="font-semibold">{c.name}</p>
              {c.title && <p className="text-ink-soft">{c.title}</p>}
              <p className="mt-0.5 flex flex-wrap gap-x-3">
                {c.email && (mailto(c.email) ? <a href={mailto(c.email)!} className="link break-all">{c.email}</a> : <span className="break-all">{c.email}</span>)}
                {safePostingUrl(c.linkedin_url) && (
                  <a href={safePostingUrl(c.linkedin_url)!} target="_blank" rel="noopener noreferrer" className="link" aria-label={`LinkedIn profile of ${c.name}`}>
                    LinkedIn
                  </a>
                )}
              </p>
              <p className="mt-1 flex gap-3">
                <button type="button" onClick={() => setEditing(c.id)} className="link" aria-label={`Edit ${c.name}`}>
                  Edit
                </button>
                <button type="button" onClick={() => remove(c)} className="btn-danger" aria-label={`Remove ${c.name}`}>
                  Remove
                </button>
              </p>
            </li>
          ),
        )}
      </ul>

      {error && (
        <p role="alert" className="mt-2 text-sm text-brick">
          {error}
        </p>
      )}

      {editing === 'new' ? (
        <div className="mt-3">
          <ContactForm
            onCancel={() => setEditing(null)}
            onSave={async (input) => {
              onChange([...contacts, await addContact(applicationId, input)])
              setEditing(null)
            }}
          />
        </div>
      ) : full ? (
        <p className="mt-3 text-sm text-ink-soft">That is the most contacts an application can have ({MAX_CONTACTS}).</p>
      ) : (
        <button type="button" onClick={() => setEditing('new')} className="btn btn-secondary btn-sm mt-3">
          Add contact
        </button>
      )}
    </section>
  )
}
