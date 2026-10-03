import type { ImportRowNote } from './api'

export interface NoteGroup {
  reason: string
  rows: number[]
}

// One line per distinct reason, with the rows it applies to: "dated today" on three hundred rows is one
// line, not three hundred. Reasons that name a company or value are naturally unique and stay one per row.
export function groupNotes(notes: ImportRowNote[]): NoteGroup[] {
  const groups = new Map<string, number[]>()
  for (const n of notes) groups.set(n.reason, [...(groups.get(n.reason) ?? []), n.row])
  return [...groups].map(([reason, rows]) => ({ reason, rows }))
}

// "row 5", "rows 5, 9 and 12", "rows 2, 3, 4, 5, 6 and 295 more".
export function rowsLabel(rows: number[], show = 5): string {
  if (rows.length === 1) return `row ${rows[0]}`
  if (rows.length <= show + 1) return `rows ${rows.slice(0, -1).join(', ')} and ${rows[rows.length - 1]}`
  return `rows ${rows.slice(0, show).join(', ')} and ${rows.length - show} more`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
