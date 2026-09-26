import type { Application, WorkMode } from './api'

// The words shown for each mode. The stored value is snake_case, so it is not shown as is.
export const workModeLabel: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  in_person: 'In person',
}

// The role line of a list row, board card or detail heading: the role, then the work mode when there is one
// ("Analyst, Hybrid"). Anything not given is left out, so "not specified" shows nothing rather than a
// placeholder. The place is a line of its own (see placeLine): with a state and a country in it, it is too long
// to be one more comma in this phrase.
export function roleLine(app: Pick<Application, 'role' | 'work_mode'>): string {
  return [app.role, app.work_mode ? workModeLabel[app.work_mode] : null].filter(Boolean).join(', ')
}

// "Springfield, Illinois, United States" for a picked city, or whatever was typed; null when there is no place.
// The state is part of a picked city, so two Springfields never read the same.
export function placeLine(app: Pick<Application, 'location_display'>): string | null {
  return app.location_display || null
}
