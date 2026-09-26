import { describe, expect, it } from 'vitest'
import { matchCountries, searchKey } from './placeSearch'

describe('searchKey', () => {
  it.each([
    ['Zürich', 'zurich'],
    ['ZURICH', 'zurich'],
    [' São Paulo ', 'sao paulo'],
    ['Ålesund', 'alesund'],
    ['Łódź', 'lodz'],
    ['Bjørnafjorden', 'bjornafjorden'],
    ['Straße', 'strasse'],
    ['Reykjavík', 'reykjavik'],
  ])('%s becomes %s, the same as the server computes', (text, key) => {
    expect(searchKey(text)).toBe(key)
  })
})

describe('matchCountries', () => {
  const ALL = [{ name: 'Guinea' }, { name: 'Papua New Guinea' }, { name: 'United States' }, { name: 'Côte d’Ivoire' }, { name: 'Canada' }]

  it('is everything for an empty query', () => {
    expect(matchCountries(ALL, '')).toHaveLength(5)
    expect(matchCountries(ALL, '  ')).toHaveLength(5)
  })

  it('finds names that contain the text, with those that start with it first', () => {
    expect(matchCountries(ALL, 'guinea').map((c) => c.name)).toEqual(['Guinea', 'Papua New Guinea'])
    expect(matchCountries(ALL, 'states').map((c) => c.name)).toEqual(['United States'])
  })

  it('ignores accents and case', () => {
    expect(matchCountries(ALL, 'COTE').map((c) => c.name)).toEqual(['Côte d’Ivoire'])
  })

  it('is empty when nothing matches', () => {
    expect(matchCountries(ALL, 'zzz')).toEqual([])
  })
})
