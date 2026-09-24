import type { Application } from './api'

// A follow-up is overdue when its date has passed and the application is still
// open: nobody follows up on a rejection or a withdrawal. `today` is a local
// YYYY-MM-DD string (see dates.ts); those compare correctly as plain text.
export function isOverdue(app: Pick<Application, 'follow_up_date' | 'status'>, today: string): boolean {
  return app.follow_up_date !== null && app.follow_up_date < today && app.status !== 'rejected' && app.status !== 'withdrawn'
}
