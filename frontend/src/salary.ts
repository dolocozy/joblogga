import type { Application } from './api'

type Salary = Pick<Application, 'salary_min' | 'salary_max' | 'salary_currency'>

// "110,000–130,000 USD". The code goes after the amounts, not a symbol before them: "$" is a dozen currencies, and "120,000 USD"
// next to "120,000 EUR" cannot be misread. Nothing is converted. Null when there is no salary to show.
export function salaryLine({ salary_min: min, salary_max: max, salary_currency: currency }: Salary): string | null {
  const fmt = (n: number) => n.toLocaleString('en-US')
  if (min !== null && max !== null) return min === max ? `${fmt(min)} ${currency}` : `${fmt(min)}–${fmt(max)} ${currency}`
  if (min !== null) return `from ${fmt(min)} ${currency}`
  if (max !== null) return `up to ${fmt(max)} ${currency}`
  return null
}
