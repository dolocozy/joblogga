import { describe, expect, it } from 'vitest'
import { dateLine } from './appliedOn'
import { formatDate, formatIsoDate } from './dates'

describe('dateLine', () => {
  it('is the applied date for an application', () => {
    expect(dateLine({ status: 'applied', date_applied: '2026-03-01', created_at: '2026-02-01T12:00:00Z' })).toBe(formatDate('2026-03-01'))
  })

  it('says when a saved job was saved, since it has not been applied to', () => {
    expect(dateLine({ status: 'saved', date_applied: null, created_at: '2026-02-01T12:00:00Z' })).toBe(`Saved ${formatIsoDate('2026-02-01T12:00:00Z')}`)
  })

  it('still reads as saved for a job moved back to Saved, even though it kept its old applied date', () => {
    expect(dateLine({ status: 'saved', date_applied: '2026-03-01', created_at: '2026-02-01T12:00:00Z' })).toMatch(/^Saved /)
  })
})
