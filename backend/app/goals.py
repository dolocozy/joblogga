"""The weekly application goal: how many applications this week, and whether that is on pace.

What counts: applications you APPLIED to in the current calendar week (Monday to Sunday, the week the weekly chart uses), up to
today. Saved jobs do not count, because the goal is about applying, not browsing; moving one out of Saved does, on the day it was
applied. The count is exactly the dashboard's other applied-only figures (archived applications included).

Pace is judged on days already finished, so nobody is "behind" on Monday morning: after a day is over, the goal's share of the week
for the days gone is the target. A goal of 10 expects 1 by Tuesday, 4 by Thursday and 8 by Sunday, and reaching the goal ends the
question however early.

There is deliberately no streak: it would need the goal as it was in each past week (raising a goal would otherwise retroactively
break weeks that hit the old one), and a counter you can lose breaks in the weeks a search is busiest.
"""

from dataclasses import dataclass
from datetime import date, timedelta

MAX_WEEKLY_GOAL = 100  # a ceiling against typos ("1000"), not a target


@dataclass(frozen=True)
class WeekProgress:
    target: int
    this_week: int
    week_start: date  # the Monday
    pace_target: int  # how many would be on pace given the days already finished
    on_pace: bool
    reached: bool
    remaining: int  # to reach the goal; 0 once reached


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def week_progress(count: int, goal: int, today: date) -> WeekProgress:
    """Where `count` applications this week stands against `goal`, on `today`."""
    finished_days = today.weekday()  # Monday 0 ... Sunday 6: how many days of the week are over
    pace_target = goal * finished_days // 7
    return WeekProgress(
        target=goal,
        this_week=count,
        week_start=week_start(today),
        pace_target=pace_target,
        on_pace=count >= pace_target,
        reached=count >= goal,
        remaining=max(0, goal - count),
    )
