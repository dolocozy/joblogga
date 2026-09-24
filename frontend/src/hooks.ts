import { useEffect, useState } from 'react'

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
