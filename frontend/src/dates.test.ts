import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatDate, localToday } from './dates'

afterEach(() => vi.useRealTimers())

describe('localToday', () => {
  it('uses local date parts, zero-padded', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 5, 23, 30)) // Jan 5, 11:30pm local
    expect(localToday()).toBe('2026-01-05')
  })
})

describe('formatDate', () => {
  it('does not shift the day for a plain YYYY-MM-DD date', () => {
    // Parsing "2026-03-01" as UTC would show Feb 28 in timezones west of UTC.
    expect(formatDate('2026-03-01')).toContain('1')
    expect(formatDate('2026-03-01')).toContain('Mar')
    expect(formatDate('2026-03-01')).toContain('2026')
  })
})
