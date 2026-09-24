// Dates from the API are plain "YYYY-MM-DD" strings (no time zone). Build them
// from local date parts: toISOString() would give the UTC date, which can be
// "tomorrow" or "yesterday" late in the evening.
export function localToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// "2026-03-01" -> "Mar 1, 2026". Parsed as local midnight so it never shifts a day.
export function formatDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
