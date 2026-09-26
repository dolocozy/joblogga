import { describe, expect, it } from 'vitest'
import { STATUSES } from './api'
import { APPLIED_STATUSES, isClosed, stageCount, statusLabel, statusText } from './status'

describe('the status list', () => {
  it('is in pipeline order: Saved first, and the offer outcomes right after Offer', () => {
    expect([...STATUSES]).toEqual(['saved', 'applied', 'screening', 'interview', 'offer', 'offer_accepted', 'offer_declined', 'rejected', 'withdrawn'])
  })

  it('has a label, a stage count and a text color for every status (none forgotten when one is added)', () => {
    for (const s of STATUSES) {
      expect(statusLabel(s), s).toBeTruthy()
      expect(stageCount[s], s).toBeGreaterThanOrEqual(0)
      expect(statusText[s], s).toBeTruthy()
    }
    expect(Object.keys(stageCount).sort()).toEqual([...STATUSES].sort())
    expect(Object.keys(statusText).sort()).toEqual([...STATUSES].sort())
  })

  it('shows readable words, never the stored value', () => {
    expect(statusLabel('offer_accepted')).toBe('Offer accepted')
    expect(statusLabel('offer_declined')).toBe('Offer declined')
    for (const s of STATUSES) expect(statusLabel(s)).not.toMatch(/_/)
  })

  it('keeps Rejected (the employer said no) and Offer declined (you said no) apart', () => {
    expect(statusLabel('rejected')).not.toBe(statusLabel('offer_declined'))
  })

  it('treats exactly the endings as closed', () => {
    expect(STATUSES.filter(isClosed)).toEqual(['offer_accepted', 'offer_declined', 'rejected', 'withdrawn'])
  })

  it('fills all four stage ticks for an accepted offer and none for the endings that do not progress', () => {
    expect(stageCount.offer_accepted).toBe(4)
    expect([stageCount.offer_declined, stageCount.rejected, stageCount.withdrawn]).toEqual([0, 0, 0])
  })
})

describe('Saved', () => {
  it('reads as Saved, shows no progress, and is not a closed status (a follow-up date still counts as "apply by")', () => {
    expect(statusLabel('saved')).toBe('Saved')
    expect(stageCount.saved).toBe(0)
    expect(isClosed('saved')).toBe(false)
  })

  it('is left out of the statuses of jobs you have applied to', () => {
    expect(APPLIED_STATUSES).not.toContain('saved')
    expect(APPLIED_STATUSES).toHaveLength(STATUSES.length - 1)
    expect(APPLIED_STATUSES[0]).toBe('applied')
  })
})
