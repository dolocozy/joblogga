import type { Application } from '../api'

// "Archived", in small soft text, for an archived application that is being shown (the default views hide them).
export default function ArchivedNote({ app, className = '' }: { app: Pick<Application, 'archived'>; className?: string }) {
  if (!app.archived) return null
  return <span className={`text-xs text-ink-soft ${className}`}>Archived</span>
}
