from collections import Counter
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.models import Application, ApplicationStatus, StatusChange, User
from app.schemas import ResponseRate, StatsOut, StatusCount, WeekCount

router = APIRouter(prefix="/stats", tags=["stats"])

# An employer "responded" once an application moved past Applied, and a
# rejection is a response. An application counts as responded if it EVER reached
# one of these (its status history says so), not only if it is in one right now:
# Applied -> Interview -> Withdrawn was answered, however it ended.
#
# Withdrawn is the applicant's own decision. Withdrawing BEFORE any response says
# nothing about employer behavior, so such an application is left out of both sides
# of the ratio; withdrawing after a response leaves it in both.
RESPONDED = (
    ApplicationStatus.SCREENING,
    ApplicationStatus.INTERVIEW,
    ApplicationStatus.OFFER,
    ApplicationStatus.REJECTED,
)


def week_start(d: date) -> date:
    """The Monday of `d`'s week (weeks run Monday to Sunday)."""
    return d - timedelta(days=d.weekday())


def response_rate(responded: int, eligible: int) -> ResponseRate:
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

    Note: the status breakdown is each application's *current* status, but the
    response rate looks at history: an application that reached Interview and was
    then withdrawn shows as Withdrawn in the breakdown and still counts as a
    response in the rate.
    """
    this_week = week_start(date.today())
    # Applications dated later than this week (e.g. entered in advance) are left
    # out so the weekly chart, which ends at the current week, matches the totals.
    conditions = [Application.user_id == user.id, Application.date_applied < this_week + timedelta(days=7)]
    if weeks is not None:
        conditions.append(Application.date_applied >= this_week - timedelta(weeks=weeks - 1))

    # Reached a response status at some point: now, or per the history. Checking the current
    # status too keeps an application counted even if its history were ever missing a row.
    ever_responded = or_(
        Application.status.in_(RESPONDED),
        exists().where(StatusChange.application_id == Application.id, StatusChange.to_status.in_(RESPONDED)),
    )
    responded = db.scalar(select(func.count()).select_from(Application).where(*conditions, ever_responded)) or 0
    eligible = (
        db.scalar(
            select(func.count()).select_from(Application).where(*conditions, or_(Application.status != ApplicationStatus.WITHDRAWN, ever_responded))
        )
        or 0
    )

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
        response=response_rate(responded, eligible),
        per_week=per_week,
    )
