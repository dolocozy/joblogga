import type { ApplicationStatus } from './api'

export const statusLabel = (s: ApplicationStatus) => s.charAt(0).toUpperCase() + s.slice(1)

// How many of the four pipeline stages an application has reached. Rejected and
// Withdrawn are endings, not stages, so they show none.
export const stageCount: Record<ApplicationStatus, number> = {
  applied: 1,
  screening: 2,
  interview: 3,
  offer: 4,
  rejected: 0,
  withdrawn: 0,
}

// Text color per status. The word always carries the meaning; color only backs it up.
export const statusText: Record<ApplicationStatus, string> = {
  applied: 'text-ink',
  screening: 'text-ink',
  interview: 'text-ink',
  offer: 'font-semibold text-pine',
  rejected: 'text-brick',
  withdrawn: 'text-ink-soft',
}
