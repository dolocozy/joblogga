import { describe, expect, it } from 'vitest'
import { WORK_MODES } from './api'
import { roleLine, workModeLabel } from './workMode'

describe('work mode labels', () => {
  it('has readable words for every mode, never the stored value', () => {
    for (const m of WORK_MODES) expect(workModeLabel[m]).not.toMatch(/_/)
    expect(Object.keys(workModeLabel).sort()).toEqual([...WORK_MODES].sort())
    expect(workModeLabel.in_person).toBe('In person')
  })
})

describe('roleLine', () => {
  it('joins role, location and work mode with commas', () => {
    expect(roleLine({ role: 'Analyst', location: 'Portland', work_mode: 'hybrid' })).toBe('Analyst, Portland, Hybrid')
  })

  it('leaves out whatever is not given', () => {
    expect(roleLine({ role: 'Analyst', location: null, work_mode: null })).toBe('Analyst')
    expect(roleLine({ role: 'Analyst', location: 'Portland', work_mode: null })).toBe('Analyst, Portland')
    expect(roleLine({ role: 'Analyst', location: null, work_mode: 'remote' })).toBe('Analyst, Remote')
    expect(roleLine({ role: 'Analyst', location: '', work_mode: null })).toBe('Analyst')
  })
})
