import { describe, expect, it } from 'vitest'
import { safePostingUrl } from './links'

describe('safePostingUrl', () => {
  it.each(['https://example.com/jobs/1', 'http://example.com', 'HTTPS://EXAMPLE.COM'])('lets %s through unchanged', (url) => {
    expect(safePostingUrl(url)).toBe(url)
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com',
    '//example.com',
    ' https://example.com', // a leading space is not a URL scheme match; refused rather than guessed at
    'example.com/jobs',
    '',
  ])('refuses %j', (url) => {
    expect(safePostingUrl(url)).toBeNull()
  })

  it('refuses a missing link', () => {
    expect(safePostingUrl(null)).toBeNull()
    expect(safePostingUrl(undefined)).toBeNull()
  })
})
