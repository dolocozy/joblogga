import type { StageTime } from './api'

// "under a day", "1 day", "4.5 days", "12 days": enough precision to read, never more than the data supports.
export function formatDays(days: number | null): string {
  if (days === null) return '—'
  if (days < 1) return 'under a day'
  const rounded = days < 10 ? Math.round(days * 10) / 10 : Math.round(days)
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`
}

// The "still here" cell: how many applications are in the stage now, and how long they have waited so far.
// Kept apart from the average on purpose: an unfinished wait is not a measure of how long the stage takes.
export function stillHere(stage: Pick<StageTime, 'in_progress' | 'in_progress_mean_days'>): string {
  if (stage.in_progress === 0) return 'none'
  return `${stage.in_progress} (${formatDays(stage.in_progress_mean_days)} so far)`
}
