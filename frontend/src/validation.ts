// Inline validation rules. Each takes the field's current text and returns an
// error message, or null when it's fine. The server re-checks everything; these
// exist so people see problems next to the field while they type, instead of in
// the browser's native popup.

export type Rule = (value: string) => string | null

export const required =
  (message: string): Rule =>
  (v) =>
    v.trim() ? null : message

// Every form that takes an email address only asks for one to be typed. Whether it is a *valid* address
// is deliberately left to the server, which checks properly on submit and answers with
// its own message: a client-side format rule on this field only ever second-guessed
// people mid-typing, and any pattern short of the full specification rejects some real
// addresses.
export const emailRequiredRule: Rule = required('Enter your email address')

// Logging in only needs *a* password. Length rules apply when choosing one, and
// the server is the judge of whether it's right.
export const loginPasswordRule: Rule = (v) => (v ? null : 'Enter your password')

export const newPasswordRule: Rule = (v) => {
  if (!v) return 'Choose a password'
  if (v.length < 8) return `Use at least 8 characters (${v.length} so far)`
  // bcrypt only reads the first 72 bytes, and the server rejects longer input.
  if (new TextEncoder().encode(v).length > 72) return 'Use at most 72 bytes (about 72 characters)'
  return null
}

// Only http(s) links are stored: anything else could run script when clicked.
export const httpUrlRule: Rule = (v) => {
  const t = v.trim()
  if (!t) return null
  return /^https?:\/\/\S+$/i.test(t) ? null : 'Start the link with http:// or https://'
}

export const wholeNumberRule: Rule = (v) => {
  const t = v.trim()
  if (!t) return null
  return /^\d+$/.test(t) ? null : 'Enter a whole number, 0 or more'
}

// The second "type it again" box on a new-password form.
export const matches =
  (other: string, message = 'The passwords do not match'): Rule =>
  (v) =>
    v === other ? null : message
