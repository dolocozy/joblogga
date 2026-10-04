import { Link } from 'react-router-dom'
import type { GoalProgress as Goal } from '../api'

// This week against the weekly goal. Rendered only when a goal is set (the server sends none otherwise), so someone who never
// opted in sees nothing at all. The wording is plain on purpose: being behind is reported, never scolded.
export default function GoalProgress({ goal }: { goal: Goal }) {
  const { target, this_week: done, pace_target: pace, on_pace: onPace, reached, remaining } = goal
  const filled = Math.min(100, Math.round((done / target) * 100))
  const marker = Math.round((pace / target) * 100)

  const verdict = reached
    ? 'Goal reached for this week.'
    : onPace
      ? `On pace. ${remaining} to go this week.`
      : `A little behind pace: about ${pace} by now. ${remaining} to go this week.`

  return (
    <section aria-label="Weekly goal" className="sheet p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg">This week</h2>
        <Link to="/account#goal" className="link text-sm">
          Change goal
        </Link>
      </div>
      <p className="mt-1">
        <span className="text-3xl font-semibold">{done}</span> of {target} applications
      </p>
      <div
        role="progressbar"
        aria-label="Applications sent this week"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={Math.min(done, target)}
        aria-valuetext={`${done} of ${target} applications`}
        className="relative mt-3 h-2 bg-rule"
      >
        <div className="h-full bg-pine" style={{ width: `${filled}%` }} />
        {/* Where on pace would be by now. Hidden once the goal is met, and on Monday when it sits at zero. */}
        {!reached && marker > 0 && <div aria-hidden data-testid="pace-marker" className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: `${marker}%` }} />}
      </div>
      <p className="mt-2 text-sm text-ink-soft">{verdict}</p>
    </section>
  )
}
