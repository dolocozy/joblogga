import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

// Returns `value` only after it has stopped changing for `ms`, e.g. so typing in
// a search box doesn't fire one request per keystroke.
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/**
 * Decides when a field's error is shown.
 *
 * A field stays quiet until the person has interacted with it (typed in it or
 * left it), so an untouched form doesn't open covered in errors. From then on
 * its message updates on every keystroke. Submitting reveals every error and
 * moves focus to the first invalid field.
 *
 * `errors` is recomputed from the current values on each render, in form order;
 * `idFor` maps a field name to its input's DOM id (for focusing).
 */
export function useFieldErrors<K extends string>(errors: Record<K, string | null>, idFor: (name: K) => string) {
  const [visited, setVisited] = useState<ReadonlySet<K>>(new Set())

  const visit = useCallback((name: K) => {
    setVisited((prev) => (prev.has(name) ? prev : new Set(prev).add(name)))
  }, [])

  const error = (name: K) => (visited.has(name) ? errors[name] : null)

  /** True if the form is valid. Otherwise shows all errors and focuses the first bad field. */
  function validateAll(): boolean {
    const names = Object.keys(errors) as K[]
    setVisited(new Set(names))
    const firstBad = names.find((n) => errors[n])
    if (firstBad === undefined) return true
    document.getElementById(idFor(firstBad))?.focus()
    return false
  }

  return { error, visit, validateAll }
}

/**
 * Where to send someone who is (now) logged in: the page a protected route
 * bounced them from, or the applications list. The saved path comes from router
 * state that ProtectedRoute set (never from the URL), and is still checked to be
 * a same-site path, so it can't be used to redirect anywhere else.
 */
export function useReturnPath(): string {
  const from = (useLocation().state as { from?: unknown } | null)?.from
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/applications'
}
