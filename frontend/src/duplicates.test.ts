import { describe, expect, it } from 'vitest'
import { describeMatch, duplicateKey, normalizeName } from './duplicates'
import { formatDate, formatIsoDate } from './dates'

describe('duplicateKey', () => {
  it.each([
    ['Acme Corp', 'acme corp'],
    ['  Acme Corp  ', 'Acme Corp'],
    ['Acme    Corp', 'Acme Corp'],
    ['ACME\tCORP', 'acme corp'],
  ])('%j and %j are the same company', (a, b) => {
    expect(normalizeName(a)).toBe(normalizeName(b))
  })

  it('is not fuzzy', () => {
    expect(duplicateKey('Acme', 'Data Analyst')).not.toBe(duplicateKey('Acme', 'Senior Data Analyst'))
    expect(duplicateKey('Acme', 'Analyst')).not.toBe(duplicateKey('Acme Inc', 'Analyst'))
  })

  it('does not confuse the company with the role', () => {
    expect(duplicateKey('Acme', 'Engineer')).not.toBe(duplicateKey('Engineer', 'Acme'))
  })
})

describe('describeMatch', () => {
  it('gives the status and the applied date', () => {
    expect(describeMatch({ status: 'interview', date_applied: '2026-03-01', created_at: '2026-04-01T12:00:00Z' })).toBe(`Interview, applied ${formatDate('2026-03-01')}`)
  })

  it('says saved, with when, for a job not applied to yet', () => {
    expect(describeMatch({ status: 'saved', date_applied: null, created_at: '2026-04-01T12:00:00Z' })).toBe(`Saved, saved ${formatIsoDate('2026-04-01T12:00:00Z')}`)
  })
})
