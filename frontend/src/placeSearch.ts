// The same accent-and-case folding the server uses for city names (backend/app/geo.py), so "zurich" finds "Zürich".
const SPECIAL: Record<string, string> = { ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i', ħ: 'h' }

export function searchKey(text: string): string {
  const folded = text
    .trim()
    .toLowerCase()
    .replace(/[ßøæœłđðþıħ]/g, (c) => SPECIAL[c])
  return folded.normalize('NFKD').replace(/\p{M}/gu, '')
}

// Countries: everything whose name contains what was typed, names that START with it first.
export function matchCountries<T extends { name: string }>(all: T[], query: string): T[] {
  const key = searchKey(query)
  if (!key) return all
  const starts: T[] = []
  const contains: T[] = []
  for (const c of all) {
    const name = searchKey(c.name)
    if (name.startsWith(key)) starts.push(c)
    else if (name.includes(key)) contains.push(c)
  }
  return [...starts, ...contains]
}
