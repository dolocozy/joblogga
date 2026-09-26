import { describe, expect, it } from 'vitest'
import { emailRequiredRule, httpUrlRule, loginPasswordRule, newPasswordRule, required, roundRule, wholeNumberRule } from './validation'

describe('emailRequiredRule (every form with an email field)', () => {
  it('only asks for something to be typed', () => {
    expect(emailRequiredRule('')).toBe('Enter your email address')
    expect(emailRequiredRule('   ')).toBe('Enter your email address')
  })

  it.each(['me@example.com', 'not-an-email', 'me@', '@example.com', 'a b c', 'x'])('leaves judging %j to the server', (v) => {
    expect(emailRequiredRule(v)).toBeNull() // the format is deliberately not checked in the browser
  })
})

describe('password rules', () => {
  it('login only needs something typed', () => {
    expect(loginPasswordRule('')).toBe('Enter your password')
    expect(loginPasswordRule('a')).toBeNull()
  })

  it('a new password needs 8 characters, and reports how many so far', () => {
    expect(newPasswordRule('')).toBe('Choose a password')
    expect(newPasswordRule('1234567')).toBe('Use at least 8 characters (7 so far)')
    expect(newPasswordRule('12345678')).toBeNull()
  })

  it('a new password stays within 72 bytes (the limit is bytes, not characters)', () => {
    expect(newPasswordRule('x'.repeat(72))).toBeNull()
    expect(newPasswordRule('x'.repeat(73))).toMatch(/at most 72 bytes/)
    expect(newPasswordRule('é'.repeat(37))).toMatch(/at most 72 bytes/) // 37 chars, 74 bytes
    expect(newPasswordRule('é'.repeat(36))).toBeNull() // 36 chars, 72 bytes
  })
})

describe('httpUrlRule', () => {
  it.each(['', '   ', 'http://example.com', 'https://example.com/jobs/1?x=1', 'HTTPS://EXAMPLE.COM'])('accepts %j', (v) => {
    expect(httpUrlRule(v)).toBeNull()
  })
  it.each(['javascript:alert(1)', 'ftp://example.com', 'example.com', 'https://', 'https:// spaced.com'])('rejects %j', (v) => {
    expect(httpUrlRule(v)).toBe('Start the link with http:// or https://')
  })
})

describe('wholeNumberRule', () => {
  it.each(['', '  ', '0', '90000'])('accepts %j', (v) => expect(wholeNumberRule(v)).toBeNull())
  it.each(['-1', '1.5', '1e3', 'abc', '9 0'])('rejects %j', (v) => {
    expect(wholeNumberRule(v)).toBe('Enter a whole number, 0 or more')
  })
})

describe('required', () => {
  it('treats spaces-only as empty', () => {
    expect(required('Enter it')('   ')).toBe('Enter it')
    expect(required('Enter it')(' x ')).toBeNull()
  })
})

describe('roundRule', () => {
  it('accepts blank and whole numbers from 1 to 50', () => {
    for (const v of ['', '  ', '1', '3', '50']) expect(roundRule(v), v).toBeNull()
  })

  it('refuses everything else with one message', () => {
    for (const v of ['0', '51', '-1', '2.5', 'two', '1e2']) expect(roundRule(v), v).toBe('Enter a whole number from 1 to 50')
  })
})
