import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFieldErrors, useSlowAfter } from './hooks'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useSlowAfter', () => {
  it('is false at first and becomes true only after the delay', () => {
    const { result } = renderHook(() => useSlowAfter(true, 3000))
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(2999))
    expect(result.current).toBe(false)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it('never turns true if the work finishes first', () => {
    const { result, rerender } = renderHook(({ active }) => useSlowAfter(active, 3000), { initialProps: { active: true } })
    act(() => vi.advanceTimersByTime(2000))

    rerender({ active: false })
    act(() => vi.advanceTimersByTime(5000))

    expect(result.current).toBe(false)
  })

  it('starts over the next time work begins', () => {
    const { result, rerender } = renderHook(({ active }) => useSlowAfter(active, 3000), { initialProps: { active: true } })
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current).toBe(true)

    rerender({ active: false })
    expect(result.current).toBe(false)
    rerender({ active: true })
    expect(result.current).toBe(false) // not left over from last time
    act(() => vi.advanceTimersByTime(3000))
    expect(result.current).toBe(true)
  })

  it('is always false while nothing is happening', () => {
    const { result } = renderHook(() => useSlowAfter(false, 3000))
    act(() => vi.advanceTimersByTime(60_000))
    expect(result.current).toBe(false)
  })
})

describe('useFieldErrors: when a field\'s message is shown', () => {
  type Errors = Record<'a' | 'b', string | null>
  const setup = (errors: Errors) => renderHook((props: { errors: Errors }) => useFieldErrors(props.errors, (n) => `id-${n}`), { initialProps: { errors } })
  const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

  it('shows nothing for a field nobody has touched', () => {
    const { result } = setup({ a: 'A is wrong', b: null })
    expect(result.current.error('a')).toBeNull()
  })

  it('visit shows the message at once', () => {
    const { result } = setup({ a: 'A is wrong', b: null })
    act(() => result.current.visit('a'))
    expect(result.current.error('a')).toBe('A is wrong')
  })

  it('settle shows it only after a pause: not before 0.4s, shown by 1.5s (literal times)', () => {
    const { result } = setup({ a: 'A is wrong', b: null })
    act(() => result.current.settle('a'))
    wait(400)
    expect(result.current.error('a')).toBeNull()
    wait(1100)
    expect(result.current.error('a')).toBe('A is wrong')
  })

  it('every settle call restarts the wait', () => {
    const { result } = setup({ a: 'A is wrong', b: null })
    act(() => result.current.settle('a'))
    wait(600)
    act(() => result.current.settle('a')) // typing again
    wait(600)
    expect(result.current.error('a')).toBeNull() // 1200ms since the first call, 600 since the last
    wait(300)
    expect(result.current.error('a')).toBe('A is wrong')
  })

  it('a message shown earlier steps aside when settle is called again, and returns after the next pause', () => {
    const { result } = setup({ a: 'A is wrong', b: null })
    act(() => result.current.visit('a'))
    expect(result.current.error('a')).toBe('A is wrong')

    act(() => result.current.settle('a')) // they are typing again
    expect(result.current.error('a')).toBeNull()
    wait(1500)
    expect(result.current.error('a')).toBe('A is wrong')
  })

  it('visit cancels a pending wait and shows the message straight away', () => {
    const { result } = setup({ a: 'A is wrong', b: null })
    act(() => result.current.settle('a'))
    wait(200)
    act(() => result.current.visit('a')) // e.g. they left the field
    expect(result.current.error('a')).toBe('A is wrong')
  })

  it('follows the value: the moment it stops being wrong the message goes, with no wait', () => {
    const { result, rerender } = setup({ a: 'A is wrong', b: null })
    act(() => result.current.visit('a'))
    rerender({ errors: { a: null, b: null } })
    expect(result.current.error('a')).toBeNull()
  })

  it('a wait that ends when the value is already fine shows nothing', () => {
    const { result, rerender } = setup({ a: 'A is wrong', b: null })
    act(() => result.current.settle('a'))
    rerender({ errors: { a: null, b: null } })
    wait(1500)
    expect(result.current.error('a')).toBeNull()
  })

  it('fields are independent', () => {
    const { result } = setup({ a: 'A is wrong', b: 'B is wrong' })
    act(() => result.current.settle('a'))
    act(() => result.current.visit('b'))
    expect(result.current.error('b')).toBe('B is wrong')
    expect(result.current.error('a')).toBeNull()
  })

  it('validateAll shows every message and focuses the first bad field, in form order', () => {
    const first = document.body.appendChild(document.createElement('input'))
    const second = document.body.appendChild(document.createElement('input'))
    first.id = 'id-a'
    second.id = 'id-b'
    const { result } = setup({ a: null, b: 'B is wrong' })
    act(() => result.current.settle('b')) // a wait is pending

    let ok = true
    act(() => void (ok = result.current.validateAll()))

    expect(ok).toBe(false)
    expect(result.current.error('b')).toBe('B is wrong') // no waiting when submitting
    expect(document.activeElement).toBe(second)
    first.remove()
    second.remove()
  })

  it('validateAll passes a form with nothing wrong', () => {
    const { result } = setup({ a: null, b: null })
    let ok = false
    act(() => void (ok = result.current.validateAll()))
    expect(ok).toBe(true)
  })
})
