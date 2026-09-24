from collections import Counter
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Application, ApplicationStatus, User
from app.schemas import ResponseRate, StatsOut, StatusCount, WeekCount

router = APIRouter(prefix="/stats", tags=["stats"])

# An employer "responded" once an application moved past Applied, and a
# rejection is a response. Withdrawn is the applicant's own decision, so it says
# nothing about employer behavior and is left out of BOTH sides of the ratio.
RESPONDED = (
    ApplicationStatus.SCREENING,
    ApplicationStatus.INTERVIEW,
    ApplicationStatus.OFFER,
    ApplicationStatus.REJECTED,
)


def week_start(d: date) -> date:
    """The Monday of `d`'s week (weeks run Monday to Sunday)."""
    return d - timedelta(days=d.weekday())


def response_rate(counts: dict[ApplicationStatus, int]) -> ResponseRate:
    responded = sum(counts[s] for s in RESPONDED)
    eligible = sum(counts.values()) - counts[ApplicationStatus.WITHDRAWN]
    return ResponseRate(
        responded=responded,
        eligible=eligible,
        rate=responded / eligible if eligible else None,
    )


@router.get("", response_model=StatsOut)
def get_stats(
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(get_current_user)],
    weeks: Annotated[
        int | None,
        Query(ge=1, le=520, description="Only applications from the last N weeks (incl. this one). Omit for all time."),
    ] = None,
) -> StatsOut:
    """Dashboard numbers. Every figure covers the same slice of applications,
    so the totals, breakdown, response rate and weekly chart always agree.

    Note: status is each application's *current* status. An application that
    reached Interview and was then withdrawn counts as Withdrawn, so it is left
    out of the response rate.
    """
    this_week = week_start(date.today())
    # Applications dated later than this week (e.g. entered in advance) are left
    # out so the weekly chart, which ends at the current week, matches the totals.
    conditions = [Application.user_id == user.id, Application.date_applied < this_week + timedelta(days=7)]
    if weeks is not None:
        conditions.append(Application.date_applied >= this_week - timedelta(weeks=weeks - 1))

    counts = {s: 0 for s in ApplicationStatus}
    for status, n in db.execute(select(Application.status, func.count()).where(*conditions).group_by(Application.status)):
        counts[status] = n

    # Bucketed in Python, not SQL: date-truncation functions differ between
    # SQLite and Postgres, and this keeps one behavior on both.
    dates = list(db.scalars(select(Application.date_applied).where(*conditions)))
    per_week_counts = Counter(week_start(d) for d in dates)

    if weeks is not None:
        first_week = this_week - timedelta(weeks=weeks - 1)
    elif dates:
        first_week = week_start(min(dates))
    else:
        first_week = None

    per_week: list[WeekCount] = []
    if first_week is not None:
        week = first_week
        while week <= this_week:
            per_week.append(WeekCount(week_start=week, count=per_week_counts[week]))
            week += timedelta(weeks=1)

    return StatsOut(
        total=sum(counts.values()),
        by_status=[StatusCount(status=s, count=counts[s]) for s in ApplicationStatus],
        response=response_rate(counts),
        per_week=per_week,
    )
