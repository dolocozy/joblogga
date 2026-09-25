import { describe, expect, it } from 'vitest'
import { tokenFromHash } from './resetToken'

describe('tokenFromHash', () => {
  it.each([
    ['#token=abc123', 'abc123'],
    ['token=abc123', 'abc123'], // without the leading #
    ['#token=A-b_C-9', 'A-b_C-9'], // the URL-safe characters tokens use
    ['#other=1&token=abc', 'abc'],
  ])('reads %j', (hash, expected) => {
    expect(tokenFromHash(hash)).toBe(expected)
  })

  it.each(['', '#', '#token=', '#token', '#nottoken=abc', '#tok=abc'])('finds nothing in %j', (hash) => {
    expect(tokenFromHash(hash)).toBeNull()
  })
})
