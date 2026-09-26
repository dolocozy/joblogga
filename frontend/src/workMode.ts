import type { Application, WorkMode } from './api'

// The words shown for each mode. The stored value is snake_case, so it is not shown as is.
export const workModeLabel: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  in_person: 'In person',
}

// The second line of a list row or board card: role, then location, then work mode, as a
// comma-separated phrase ("Analyst, Portland, Hybrid"). Anything not given is left out,
// so "not specified" shows nothing rather than a placeholder.
export function roleLine(app: Pick<Application, 'role' | 'location' | 'work_mode'>): string {
  return [app.role, app.location, app.work_mode ? workModeLabel[app.work_mode] : null].filter(Boolean).join(', ')
}
