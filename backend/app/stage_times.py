"""How long applications spend in each stage, worked out from their status history.

A "stay" is the time between entering a status and the next status change. The four pipeline stages are measured:
Applied, Screening, Interview and Offer. The endings (accepted, declined, rejected, withdrawn) are not stages
you wait in, and Saved is before the application exists.

Stays that have ended and stays that have not are kept apart, on purpose:

- The average and median use FINISHED stays only: how long applications that moved on were in the stage.
- An application still sitting in a stage has not finished, and dropping it from the average makes the stage look
  quicker than it is (the slowest waits are exactly the ones still open); counting its time so far in the average
  mixes unfinished waits into a figure about how long it takes. So open stays are reported separately: how many are
  still there, and how long they have waited so far on average.

Skipped stages simply have no stay (Applied straight to Rejected adds nothing to Screening or Interview). A stage
entered twice (Interview, back to Applied, Interview again) counts each stay.

The history records WHEN YOU RECORDED each change, which is when it happened if you keep it up to date. One correction
is made for people who add applications after the fact: the first time an application enters Applied, that stay is
taken to start on its applied date, if that is earlier than when it was entered.
"""

import statistics
from dataclasses import dataclass
from datetime import UTC, date, datetime

from app.models import ApplicationStatus

STAGES = (ApplicationStatus.APPLIED, ApplicationStatus.SCREENING, ApplicationStatus.INTERVIEW, ApplicationStatus.OFFER)
_DAY = 86400


@dataclass(frozen=True)
class Step:
    """One entry in an application's status history: it moved to `status` at `at`."""

    status: ApplicationStatus
    at: datetime


@dataclass
class StageStat:
    status: ApplicationStatus
    finished: int  # stays that ended
    mean_days: float | None  # None when no stay has ended yet
    median_days: float | None
    in_progress: int  # applications in the stage right now
    in_progress_mean_days: float | None  # how long they have waited so far, on average


def _applied_start(applied_on: date) -> datetime:
    # A date has no time of day: noon UTC keeps it on the right calendar day in every time zone.
    return datetime(applied_on.year, applied_on.month, applied_on.day, 12, tzinfo=UTC)


def stage_stats(histories: list[tuple[date | None, list[Step]]], now: datetime) -> list[StageStat]:
    """`histories` holds one (applied date, status history oldest first) per application."""
    finished: dict[ApplicationStatus, list[float]] = {s: [] for s in STAGES}
    waiting: dict[ApplicationStatus, list[float]] = {s: [] for s in STAGES}

    for applied_on, steps in histories:
        first_applied_seen = False
        for index, step in enumerate(steps):
            start = step.at
            if step.status == ApplicationStatus.APPLIED and not first_applied_seen:
                first_applied_seen = True
                if applied_on is not None:
                    start = min(start, _applied_start(applied_on))
            if step.status not in finished:
                continue
            end = steps[index + 1].at if index + 1 < len(steps) else None
            seconds = ((end or now) - start).total_seconds()
            if seconds < 0:
                continue  # dates entered out of order: not a duration, so not counted
            (finished if end is not None else waiting)[step.status].append(seconds / _DAY)

    def avg(values: list[float]) -> float | None:
        return round(statistics.fmean(values), 2) if values else None

    return [
        StageStat(
            status=stage,
            finished=len(finished[stage]),
            mean_days=avg(finished[stage]),
            median_days=round(statistics.median(finished[stage]), 2) if finished[stage] else None,
            in_progress=len(waiting[stage]),
            in_progress_mean_days=avg(waiting[stage]),
        )
        for stage in STAGES
    ]
