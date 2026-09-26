import { describe, expect, it } from 'vitest'
import { WORK_MODES } from './api'
import { placeLine, roleLine, workModeLabel } from './workMode'

describe('work mode labels', () => {
  it('has readable words for every mode, never the stored value', () => {
    for (const m of WORK_MODES) expect(workModeLabel[m]).not.toMatch(/_/)
    expect(Object.keys(workModeLabel).sort()).toEqual([...WORK_MODES].sort())
    expect(workModeLabel.in_person).toBe('In person')
  })
})

describe('roleLine', () => {
  it('is the role, then the work mode when there is one', () => {
    expect(roleLine({ role: 'Analyst', work_mode: 'hybrid' })).toBe('Analyst, Hybrid')
    expect(roleLine({ role: 'Analyst', work_mode: 'in_person' })).toBe('Analyst, In person')
  })

  it('leaves out a work mode that is not specified', () => {
    expect(roleLine({ role: 'Analyst', work_mode: null })).toBe('Analyst')
  })
})

describe('placeLine', () => {
  it('is the generated place, with its state, for a picked city', () => {
    expect(placeLine({ location_display: 'Springfield, Illinois, United States' })).toBe('Springfield, Illinois, United States')
  })

  it('is null when there is no place, so nothing is shown', () => {
    expect(placeLine({ location_display: null })).toBeNull()
    expect(placeLine({ location_display: '' })).toBeNull()
  })

  it('keeps two Springfields distinguishable', () => {
    expect(placeLine({ location_display: 'Springfield, Illinois, United States' })).not.toBe(placeLine({ location_display: 'Springfield, Ohio, United States' }))
  })
})
