// An application's tags as small quiet labels: they should not compete with the status or the work mode.
// Shows the first few and counts the rest, so a long list cannot take over a row or a card.
export default function TagList({ tags, max = 3, className = '' }: { tags: string[]; max?: number; className?: string }) {
  if (tags.length === 0) return null
  const shown = tags.slice(0, max)
  const more = tags.length - shown.length
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {shown.map((t) => (
        <span key={t} className="rounded-field border border-rule px-1.5 text-xs text-ink-soft">
          {t}
        </span>
      ))}
      {more > 0 && <span className="px-0.5 text-xs text-ink-soft">+{more}</span>}
    </span>
  )
}
