import { useCallback, useEffect, useRef, useState } from 'react'
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

// How long someone must stop typing before an error for a half-typed value appears.
export const SETTLE_MS = 800

/**
 * Decides when a field's error is shown.
 *
 * A field stays quiet until the person has interacted with it, so an untouched
 * form doesn't open covered in errors. There are two ways a field becomes
 * "visited", and which one a field uses depends on whether a half-finished value
 * is already wrong:
 *
 * - `visit(name)`: right away. For rules where every keystroke is meaningful, e.g.
 *   the password's running character count, which the person wants to watch.
 * - `settle(name)`: only after they pause typing (SETTLE_MS), or leave the field.
 *   For values that are invalid until they are complete, such as an email address
 *   ("m" is not an email yet) or a link ("h" is not a URL yet), where an instant
 *   error just nags someone who is partway through typing a correct value.
 *
 * A "visit" (`visit`, blurring the field, or submitting) shows the message, and it
 * then follows every keystroke and disappears the moment the value becomes valid.
 * A settled field behaves differently while being edited: typing hides its message
 * again until the next pause, so a value that is being fixed isn't shouted at
 * halfway through. Blurring a field visits it at once. Submitting reveals every
 * error and focuses the first invalid field.
 *
 * `errors` is recomputed from the current values on each render, in form order;
 * `idFor` maps a field name to its input's DOM id (for focusing).
 */
export function useFieldErrors<K extends string>(errors: Record<K, string | null>, idFor: (name: K) => string, settleMs = SETTLE_MS) {
  const [visited, setVisited] = useState<ReadonlySet<K>>(new Set())
  const timers = useRef(new Map<K, ReturnType<typeof setTimeout>>())

  const cancelTimer = useCallback((name: K) => {
    const timer = timers.current.get(name)
    if (timer !== undefined) clearTimeout(timer)
    timers.current.delete(name)
  }, [])

  const visit = useCallback(
    (name: K) => {
      cancelTimer(name)
      setVisited((prev) => (prev.has(name) ? prev : new Set(prev).add(name)))
    },
    [cancelTimer],
  )

  const settle = useCallback(
    (name: K) => {
      cancelTimer(name) // each keystroke restarts the wait
      // ...and hides an error that was already showing: they are typing again.
      setVisited((prev) => {
        if (!prev.has(name)) return prev
        const next = new Set(prev)
        next.delete(name)
        return next
      })
      timers.current.set(
        name,
        setTimeout(() => visit(name), settleMs),
      )
    },
    [cancelTimer, visit, settleMs],
  )

  // Don't fire a timer into a form that has been closed.
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((t) => clearTimeout(t))
  }, [])

  const error = (name: K) => (visited.has(name) ? errors[name] : null)

  /** True if the form is valid. Otherwise shows all errors and focuses the first bad field. */
  function validateAll(): boolean {
    const names = Object.keys(errors) as K[]
    names.forEach(cancelTimer)
    setVisited(new Set(names))
    const firstBad = names.find((n) => errors[n])
    if (firstBad === undefined) return true
    document.getElementById(idFor(firstBad))?.focus()
    return false
  }

  return { error, visit, settle, validateAll }
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

/** True once `active` has stayed true for `ms`, e.g. a request that is taking long enough to explain. */
export function useSlowAfter(active: boolean, ms = 3000): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setSlow(true), ms)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [active, ms])
  return active && slow
}
