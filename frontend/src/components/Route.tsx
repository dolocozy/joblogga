import type { ApplicationStatus } from '../api'
import { STOP_AT, lineFor } from '../routeStops'
import { isEnded, stageCount } from '../status'

// One application drawn as a route: four stops (Applied, Screening, Interview, Offer), a solid line for the ground it
// covered, a dashed one for what is left, and a larger stop for where it is now. An application that ended (rejected,
// withdrawn, offer declined) keeps the stop it got to, drawn as an empty larger square on a grey line, so a closed
// row still says how far it went. Each application has its own line color, picked from its id so it never changes.
// Decorative: the status word beside it says the same thing, so it is hidden from screen readers.

export default function Route({ status, furthest, lineId }: { status: ApplicationStatus; furthest: number; lineId: number }) {
  const line = lineFor(lineId)
  const ended = isEnded(status)
  const reached = status === 'saved' ? 0 : Math.min(4, Math.max(furthest, stageCount[status]))
  // The stop the route sits on now (or ended on). Saved has none: nothing is reached yet.
  const here = reached === 0 ? (ended ? 0 : -1) : reached - 1
  const covered = Math.max(here, 0)
  const bar = ended ? 'bg-unreached' : line.bar
  const stopRing = ended ? 'border-pencil' : line.ring
  const endRing = status === 'rejected' ? 'border-brick' : 'border-pencil'

  return (
    <span aria-hidden className="relative block h-7">
      {here > 0 && <span className={`absolute left-0 top-[11px] h-[5px] ${bar}`} style={{ width: `${STOP_AT[covered]}%` }} />}
      <span className="absolute right-0 top-[13px] border-t-2 border-dashed border-unreached" style={{ left: `${STOP_AT[covered]}%` }} />
      {STOP_AT.map((at, i) => {
        const place = { left: `${at}%` }
        if (i === here) {
          const look = ended ? `border-[3px] bg-platform ${endRing}` : `${line.bar} border-0`
          return <span key={i} className={`absolute top-[3px] h-[21px] w-[21px] -translate-x-1/2 rounded-button ${look}`} style={place} />
        }
        const look = i < here ? `${stopRing} bg-platform` : 'border-unreached bg-platform'
        return <span key={i} className={`absolute top-[8px] h-[11px] w-[11px] -translate-x-1/2 rounded-field border-[3px] ${look}`} style={place} />
      })}
    </span>
  )
}

// The four stop names, each centered over its stop on a route below. The inset leaves room for half a label either side,
// so the route under it needs the same `mx-6`.
export function StopNames() {
  return (
    <span aria-hidden className="relative mx-6 block h-5 text-sm font-normal">
      {['Applied', 'Screening', 'Interview', 'Offer'].map((name, i) => (
        <span key={name} className="absolute top-0 -translate-x-1/2" style={{ left: `${STOP_AT[i]}%` }}>
          {name}
        </span>
      ))}
    </span>
  )
}
