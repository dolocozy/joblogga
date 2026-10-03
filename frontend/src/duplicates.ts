import type { Application, DuplicateMatch } from './api'
import { formatDate, formatIsoDate } from './dates'
import { statusLabel } from './status'

// Same comparison the server makes: ignore case and extra spaces, nothing fuzzier.
export const normalizeName = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean).join(' ')
export const duplicateKey = (company: string, role: string) => `${normalizeName(company)}\u0000${normalizeName(role)}`

// "Interview, applied Mar 1, 2026" or, for a job only saved so far, "Saved, saved Mar 1, 2026".
export function describeMatch(m: Pick<DuplicateMatch, 'status' | 'date_applied' | 'created_at'>): string {
  const when = m.date_applied ? `applied ${formatDate(m.date_applied)}` : `${m.status === 'saved' ? 'saved' : 'added'} ${formatIsoDate(m.created_at)}`
  return `${statusLabel(m.status as Application['status'])}, ${when}`
}
