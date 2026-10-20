// Where the four route stops (Applied, Screening, Interview, Offer) sit along a track, as a percentage of its width.
export const STOP_AT = [0, 100 / 3, 200 / 3, 100] as const

// Each application has one line color, picked from its id so it never changes. Written out in full so Tailwind finds the classes.
const LINES = [
  { bar: 'bg-cobalt', ring: 'border-cobalt' },
  { bar: 'bg-tangerine', ring: 'border-tangerine' },
  { bar: 'bg-signal', ring: 'border-signal' },
  { bar: 'bg-plum', ring: 'border-plum' },
] as const
export const lineFor = (id: number) => LINES[Math.abs(id) % LINES.length]!
