import { describe, expect, it } from 'vitest'
import { formatDays, stillHere } from './stageTimes'

describe('formatDays', () => {
  it.each([
    [null, '—'],
    [0, 'under a day'],
    [0.4, 'under a day'],
    [1, '1 day'],
    [1.04, '1 day'],
    [1.5, '1.5 days'],
    [4.25, '4.3 days'],
    [9.94, '9.9 days'],
    [10, '10 days'],
    [12.6, '13 days'],
    [120, '120 days'],
  ])('%s reads %j', (days, text) => {
    expect(formatDays(days)).toBe(text)
  })
})

describe('stillHere', () => {
  it('says none when nothing is waiting', () => {
    expect(stillHere({ in_progress: 0, in_progress_mean_days: null })).toBe('none')
  })

  it('gives the count and how long they have waited so far', () => {
    expect(stillHere({ in_progress: 3, in_progress_mean_days: 12.4 })).toBe('3 (12 days so far)')
    expect(stillHere({ in_progress: 1, in_progress_mean_days: 0.2 })).toBe('1 (under a day so far)')
  })
})
