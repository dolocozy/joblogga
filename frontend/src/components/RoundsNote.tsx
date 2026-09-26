import type { Application } from '../api'
import { roundsLabel } from '../rounds'

// "Round 2 of 3", in small soft text beside or under the status. Nothing when there is nothing recorded.
export default function RoundsNote({ app, className = '' }: { app: Pick<Application, 'interview_round' | 'interview_rounds_total'>; className?: string }) {
  const label = roundsLabel(app)
  if (!label) return null
  return <span className={`text-xs text-ink-soft ${className}`}>{label}</span>
}
