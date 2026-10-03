import { describe, expect, it } from 'vitest'
import { groupNotes, plural, rowsLabel } from './importSummary'

describe('rowsLabel', () => {
  it.each([
    [[5], 'row 5'],
    [[5, 9], 'rows 5 and 9'],
    [[5, 9, 12], 'rows 5, 9 and 12'],
    [[2, 3, 4, 5, 6, 7], 'rows 2, 3, 4, 5, 6 and 7'],
    [[2, 3, 4, 5, 6, 7, 8, 9], 'rows 2, 3, 4, 5, 6 and 3 more'],
  ])('%j reads %j', (rows, label) => {
    expect(rowsLabel(rows)).toBe(label)
  })
})

describe('groupNotes', () => {
  it('puts rows with the same reason on one line, in the order first seen', () => {
    expect(
      groupNotes([
        { row: 5, reason: 'missing company name' },
        { row: 6, reason: 'missing role' },
        { row: 9, reason: 'missing company name' },
      ]),
    ).toEqual([
      { reason: 'missing company name', rows: [5, 9] },
      { reason: 'missing role', rows: [6] },
    ])
  })

  it('keeps reasons that differ apart, even when they are similar', () => {
    expect(groupNotes([{ row: 2, reason: 'Acme, Engineer is already in your applications' }, { row: 3, reason: 'Globex, Analyst is already in your applications' }])).toHaveLength(2)
  })

  it('is empty for no notes', () => {
    expect(groupNotes([])).toEqual([])
  })
})

describe('plural', () => {
  it('counts', () => {
    expect(plural(1, 'row')).toBe('1 row')
    expect(plural(3, 'row')).toBe('3 rows')
    expect(plural(0, 'application')).toBe('0 applications')
    expect(plural(2, 'blank row')).toBe('2 blank rows')
  })
})
