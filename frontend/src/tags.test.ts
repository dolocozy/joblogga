import { describe, expect, it } from 'vitest'
import { addTags, MAX_TAG_LENGTH, MAX_TAGS, normalizeTag } from './tags'

describe('normalizeTag', () => {
  it.each([
    ['Dream Job', 'dream job'],
    ['  dream   job  ', 'dream job'],
    ['DREAM\tJOB', 'dream job'],
    ['Café', 'café'],
    ['', ''],
    ['   ', ''],
  ])('%j becomes %j, as the server will store it', (raw, expected) => {
    expect(normalizeTag(raw)).toBe(expected)
  })
})

describe('addTags', () => {
  it('adds a tag, normalised, keeping the list sorted', () => {
    expect(addTags(['referral'], 'Dream Job')).toEqual({ tags: ['dream job', 'referral'], problem: null })
  })

  it('treats "Dream Job" and "dream job" as one tag', () => {
    expect(addTags(['dream job'], 'Dream  JOB').tags).toEqual(['dream job'])
  })

  it('splits what is typed or pasted on commas and semicolons', () => {
    expect(addTags([], 'a, B; c ,, d').tags).toEqual(['a', 'b', 'c', 'd'])
  })

  it('ignores blanks without complaint', () => {
    expect(addTags(['a'], '  ,; ')).toEqual({ tags: ['a'], problem: null })
  })

  it('refuses a tag that is too long, with a reason, but keeps the others from the same text', () => {
    const result = addTags([], `ok, ${'x'.repeat(MAX_TAG_LENGTH + 1)}, fine`)
    expect(result.tags).toEqual(['fine', 'ok'])
    expect(result.problem).toBe(`A tag can be at most ${MAX_TAG_LENGTH} characters.`)
  })

  it('accepts a tag of exactly the longest length, measured after tidying the spaces', () => {
    expect(addTags([], `  ${'x'.repeat(MAX_TAG_LENGTH)}  `).problem).toBeNull()
  })

  it('stops at the limit and says so', () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${String(i).padStart(2, '0')}`)
    const result = addTags(full, 'one more')
    expect(result.tags).toEqual(full)
    expect(result.problem).toBe(`An application can have at most ${MAX_TAGS} tags.`)
  })

  it('does not count a repeat against the limit', () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${String(i).padStart(2, '0')}`)
    expect(addTags(full, 'T00').problem).toBeNull()
  })

  it('does not change the list it was given', () => {
    const current = ['a']
    addTags(current, 'b')
    expect(current).toEqual(['a'])
  })
})
