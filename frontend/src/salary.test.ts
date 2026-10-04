import { describe, expect, it } from 'vitest'
import { salaryLine } from './salary'

const s = (salary_min: number | null, salary_max: number | null, salary_currency = 'USD') => salaryLine({ salary_min, salary_max, salary_currency })

describe('salaryLine', () => {
  it('shows a range with the currency code after it', () => {
    expect(s(110000, 130000)).toBe('110,000–130,000 USD')
    expect(s(110000, 130000, 'EUR')).toBe('110,000–130,000 EUR')
  })

  it('keeps 120,000 USD and 120,000 EUR apart, which is the point', () => {
    expect(s(120000, null, 'USD')).not.toBe(s(120000, null, 'EUR'))
  })

  it('shows one figure when the two are the same', () => {
    expect(s(90000, 90000, 'CAD')).toBe('90,000 CAD')
  })

  it('says "from" or "up to" when only one end is known', () => {
    expect(s(90000, null)).toBe('from 90,000 USD')
    expect(s(null, 130000)).toBe('up to 130,000 USD')
  })

  it('treats zero as an amount, not as missing', () => {
    expect(s(0, 0)).toBe('0 USD')
  })

  it('is null when there is no salary, whatever the currency says', () => {
    expect(s(null, null, 'EUR')).toBeNull()
  })

  it('groups large amounts the same way for a currency without decimals', () => {
    expect(s(9000000, 12000000, 'JPY')).toBe('9,000,000–12,000,000 JPY')
  })
})
