import { describe, expect, it } from 'vitest'
import { roundsLabel, showsRoundFields } from './rounds'
import { STATUSES } from './api'

describe('roundsLabel', () => {
  it.each([
    [2, 3, 'Round 2 of 3'],
    [2, null, 'Round 2'],
    [null, 3, '3 rounds'],
    [null, 1, '1 round'],
    [null, null, null],
  ])('round %s of %s reads %j', (round, total, expected) => {
    expect(roundsLabel({ interview_round: round, interview_rounds_total: total })).toBe(expected)
  })
})

describe('showsRoundFields', () => {
  it('is on while interviewing and for the offers that follow', () => {
    for (const s of ['interview', 'offer', 'offer_accepted', 'offer_declined'] as const) expect(showsRoundFields(s, false), s).toBe(true)
  })

  it('stays off for the other statuses when nothing is recorded', () => {
    for (const s of STATUSES.filter((s) => !['interview', 'offer', 'offer_accepted', 'offer_declined'].includes(s))) expect(showsRoundFields(s, false), s).toBe(false)
  })

  it('stays on for any status once something is recorded, so it can be corrected or cleared', () => {
    for (const s of STATUSES) expect(showsRoundFields(s, true), s).toBe(true)
  })
})
