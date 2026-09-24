import type { ApplicationStatus } from './api'

export const statusLabel = (s: ApplicationStatus) => s.charAt(0).toUpperCase() + s.slice(1)

// Tailwind classes per status, shared by the badge and the list's status dropdown.
export const statusStyles: Record<ApplicationStatus, string> = {
  applied: 'bg-slate-100 text-slate-700',
  screening: 'bg-sky-100 text-sky-800',
  interview: 'bg-indigo-100 text-indigo-800',
  offer: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  withdrawn: 'bg-amber-100 text-amber-800',
}
