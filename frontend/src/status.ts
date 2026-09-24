import type { ApplicationStatus } from './api'

export const statusLabel = (s: ApplicationStatus) => s.charAt(0).toUpperCase() + s.slice(1)
