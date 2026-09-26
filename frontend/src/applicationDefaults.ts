import type { ApplicationInput, ApplicationStatus } from './api'
import { localToday } from './dates'

// A blank application for the "add" form. A job you are only saving has no applied date
// yet; anything else is applied today unless the person changes it. Built on each call so
// "today" is never left over from when the page was first loaded.
export function blankApplication(status: ApplicationStatus = 'applied'): ApplicationInput {
  return {
    company: '',
    role: '',
    job_url: null,
    date_applied: status === 'saved' ? null : localToday(),
    resume_version: null,
    salary_min: null,
    salary_max: null,
    location: null,
    work_mode: null,
    notes: null,
    status,
    follow_up_date: null,
  }
}
