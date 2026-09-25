import { describe, expect, it } from 'vitest'
import { emailRequiredRule, emailRule, httpUrlRule, loginPasswordRule, newPasswordRule, required, wholeNumberRule } from './validation'

describe('emailRule', () => {
  it.each(['me@example.com', 'first.last+tag@sub.example.co.uk', '  me@example.com  '])('accepts %j', (v) => {
    expect(emailRule(v)).toBeNull()
  })
  it.each(['not-an-email', 'me@', '@example.com', 'me@example', 'me @example.com', 'me@exa mple.com'])('rejects %j', (v) => {
    expect(emailRule(v)).toBe('Enter an email address like name@example.com')
  })
  it('asks for an email when empty or only spaces', () => {
    expect(emailRule('')).toBe('Enter your email address')
    expect(emailRule('   ')).toBe('Enter your email address')
  })
})

describe('emailRequiredRule (login and signup)', () => {
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
