import type { Application, ApplicationStatus } from './api'

type Rounds = Pick<Application, 'interview_round' | 'interview_rounds_total'>

// "Round 2 of 3", "Round 2", or "3 rounds" when only the total is known; null when nothing is recorded.
// It is shown whatever the status: once an application moves on to an offer or a rejection, the
// last round reached stays as a record of how far it got.
export function roundsLabel({ interview_round: round, interview_rounds_total: total }: Rounds): string | null {
  if (round !== null && total !== null) return `Round ${round} of ${total}`
  if (round !== null) return `Round ${round}`
  if (total !== null) return `${total} ${total === 1 ? 'round' : 'rounds'}`
  return null
}

// Whether the edit form offers the round fields. They belong to interviewing and the offers that follow it,
// so a job still at Saved, Applied or Screening (or ended by a rejection or withdrawal) does not ask for
// them, unless something is already recorded, so it can still be corrected or cleared.
export function showsRoundFields(status: ApplicationStatus, recorded: boolean): boolean {
  return recorded || status === 'interview' || status === 'offer' || status === 'offer_accepted' || status === 'offer_declined'
}
