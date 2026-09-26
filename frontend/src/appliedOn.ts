import type { Application } from './api'
import { formatDate, formatIsoDate } from './dates'

// The date line for a card: when it was applied, or for a job still only saved, when it was saved.
export function dateLine(app: Pick<Application, 'status' | 'date_applied' | 'created_at'>): string {
  if (app.status === 'saved' || app.date_applied === null) return `Saved ${formatIsoDate(app.created_at)}`
  return formatDate(app.date_applied)
}
