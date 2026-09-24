import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSlowAfter } from './hooks'

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
