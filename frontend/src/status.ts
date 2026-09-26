import type { ApplicationStatus } from './api'

// The words shown for each status. The stored value is snake_case, so it is not shown as is.
const LABELS: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  offer_accepted: 'Offer accepted',
  offer_declined: 'Offer declined',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export const statusLabel = (s: ApplicationStatus) => LABELS[s]

// Statuses where nothing is left to do: no follow-up is due and nothing is overdue.
export const isClosed = (s: ApplicationStatus) => s === 'offer_accepted' || s === 'offer_declined' || s === 'rejected' || s === 'withdrawn'

// How many of the four pipeline stages an application has reached. Accepting an offer
// completes the pipeline. Declined, Rejected and Withdrawn are endings that do not
// progress it, so they show none.
export const stageCount: Record<ApplicationStatus, number> = {
  applied: 1,
  screening: 2,
  interview: 3,
  offer: 4,
  offer_accepted: 4,
  offer_declined: 0,
  rejected: 0,
  withdrawn: 0,
}

// Text color per status. The word always carries the meaning; color only backs it up.
export const statusText: Record<ApplicationStatus, string> = {
  applied: 'text-ink',
  screening: 'text-ink',
  interview: 'text-ink',
  offer: 'font-semibold text-pine',
  offer_accepted: 'font-semibold text-pine',
  offer_declined: 'text-ink-soft',
  rejected: 'text-brick',
  withdrawn: 'text-ink-soft',
}
