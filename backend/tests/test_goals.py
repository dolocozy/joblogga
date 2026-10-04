from datetime import date, timedelta

import pytest

from app.goals import MAX_WEEKLY_GOAL, week_progress, week_start
from app.routers import stats as stats_module

MONDAY = date(2026, 6, 8)
SUNDAY = date(2026, 6, 14)
BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


# --- the calculation --------------------------------------------------------------------------


def test_the_week_starts_on_monday():
    assert week_start(date(2026, 6, 8)) == MONDAY
    assert week_start(date(2026, 6, 11)) == MONDAY
    assert week_start(SUNDAY) == MONDAY  # Sunday is still the same week
    assert week_start(date(2026, 6, 15)) == date(2026, 6, 15)  # the next Monday starts a new one


@pytest.mark.parametrize(
    "day,expected",  # a goal of 10: the share of the week for the days already finished
    [(date(2026, 6, 8), 0), (date(2026, 6, 9), 1), (date(2026, 6, 10), 2), (date(2026, 6, 11), 4), (date(2026, 6, 12), 5), (date(2026, 6, 13), 7), (SUNDAY, 8)],
)
def test_pace_is_judged_on_days_already_finished(day, expected):
    assert week_progress(0, 10, day).pace_target == expected


def test_nobody_is_behind_on_monday_morning():
    progress = week_progress(0, 10, MONDAY)
    assert (progress.pace_target, progress.on_pace, progress.reached) == (0, True, False)


def test_behind_and_on_pace_around_the_target():
    wednesday = date(2026, 6, 10)  # two days finished: a goal of 10 expects 2
    assert week_progress(1, 10, wednesday).on_pace is False
    assert week_progress(2, 10, wednesday).on_pace is True
    assert week_progress(5, 10, wednesday).on_pace is True


def test_reaching_the_goal_settles_it_however_early():
    progress = week_progress(10, 10, date(2026, 6, 9))
    assert (progress.reached, progress.on_pace, progress.remaining) == (True, True, 0)
    over = week_progress(14, 10, date(2026, 6, 9))
    assert (over.reached, over.remaining, over.this_week) == (True, 0, 14)  # past the goal is fine, and never a negative remainder


def test_remaining_counts_down():
    assert week_progress(3, 10, date(2026, 6, 10)).remaining == 7


def test_a_small_goal_is_not_behind_until_a_whole_application_is_due():
    for day in (MONDAY, date(2026, 6, 9), date(2026, 6, 10)):  # goal 3: 0, 0, 0 by the end of those days
        assert week_progress(0, 3, day).on_pace is True
    assert week_progress(0, 3, date(2026, 6, 11)).on_pace is False  # 3 * 3 // 7 = 1


def test_the_result_reports_which_week_it_is_about():
    assert week_progress(0, 5, date(2026, 6, 12)).week_start == MONDAY


# --- setting the goal ---------------------------------------------------------------------------


def me(client, auth):
    return client.get("/auth/me", headers=auth).json()


def test_nobody_has_a_goal_until_they_set_one(client, auth):
    assert me(client, auth)["weekly_goal"] is None


def test_setting_updating_and_removing_the_goal(client, auth):
    assert client.patch("/auth/me", json={"weekly_goal": 10}, headers=auth).json()["weekly_goal"] == 10
    assert me(client, auth)["weekly_goal"] == 10
    assert client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth).json()["weekly_goal"] == 5
    assert client.patch("/auth/me", json={"weekly_goal": None}, headers=auth).json()["weekly_goal"] is None  # null removes it
    assert me(client, auth)["weekly_goal"] is None


@pytest.mark.parametrize("bad", [0, -1, MAX_WEEKLY_GOAL + 1, 1000, 2.5, "10", True, "", [10], {"n": 10}])
def test_only_a_whole_number_from_one_to_the_ceiling_is_accepted(client, auth, bad):
    client.patch("/auth/me", json={"weekly_goal": 7}, headers=auth)
    assert client.patch("/auth/me", json={"weekly_goal": bad}, headers=auth).status_code == 422
    assert me(client, auth)["weekly_goal"] == 7  # unchanged


def test_the_ceiling_itself_is_allowed(client, auth):
    assert client.patch("/auth/me", json={"weekly_goal": MAX_WEEKLY_GOAL}, headers=auth).status_code == 200


def test_setting_the_goal_leaves_the_reminder_setting_alone_and_the_other_way_round(client, auth):
    client.patch("/auth/me", json={"reminder_emails": True}, headers=auth)
    client.patch("/auth/me", json={"weekly_goal": 8}, headers=auth)
    assert (me(client, auth)["reminder_emails"], me(client, auth)["weekly_goal"]) == (True, 8)
    client.patch("/auth/me", json={"reminder_emails": False}, headers=auth)
    assert (me(client, auth)["reminder_emails"], me(client, auth)["weekly_goal"]) == (False, 8)


def test_both_settings_can_be_changed_in_one_request(client, auth):
    res = client.patch("/auth/me", json={"reminder_emails": True, "weekly_goal": 4}, headers=auth)
    assert (res.json()["reminder_emails"], res.json()["weekly_goal"]) == (True, 4)


def test_an_empty_request_or_a_null_reminder_flag_is_refused(client, auth):
    assert client.patch("/auth/me", json={}, headers=auth).status_code == 422
    assert client.patch("/auth/me", json={"reminder_emails": None}, headers=auth).status_code == 422


def test_it_needs_a_login_and_each_user_has_their_own_goal(client, auth, other_auth):
    assert client.patch("/auth/me", json={"weekly_goal": 3}).status_code == 401
    client.patch("/auth/me", json={"weekly_goal": 9}, headers=auth)
    assert me(client, other_auth)["weekly_goal"] is None


# --- the count, through /stats -----------------------------------------------------------------


@pytest.fixture
def today_is(monkeypatch):
    def freeze(day: date):
        monkeypatch.setattr(stats_module, "today", lambda: day)

    return freeze


def add(client, auth, applied: date, status="applied", **fields):
    res = client.post("/applications", json={**BASE, "status": status, "date_applied": applied.isoformat(), **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def goal(client, auth, **params):
    res = client.get("/stats", params=params, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()["goal"]


def test_with_no_goal_the_stats_say_nothing_about_one(client, auth, today_is):
    today_is(SUNDAY)
    add(client, auth, SUNDAY)
    assert goal(client, auth) is None  # no goal, no pressure: not even a count


def test_removing_the_goal_takes_the_progress_away_again(client, auth, today_is):
    today_is(SUNDAY)
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    assert goal(client, auth) is not None
    client.patch("/auth/me", json={"weekly_goal": None}, headers=auth)
    assert goal(client, auth) is None


def test_the_count_is_this_weeks_applications_against_the_goal(client, auth, today_is):
    today_is(date(2026, 6, 11))  # Thursday
    client.patch("/auth/me", json={"weekly_goal": 10}, headers=auth)
    for day in (MONDAY, MONDAY, date(2026, 6, 10), date(2026, 6, 11)):
        add(client, auth, day)
    assert goal(client, auth) == {
        "target": 10,
        "this_week": 4,
        "week_start": "2026-06-08",
        "pace_target": 4,  # three days finished: 10 * 3 // 7
        "on_pace": True,
        "reached": False,
        "remaining": 6,
    }


def test_the_week_boundary_the_sunday_before_is_last_week_and_the_monday_is_this_week(client, auth, today_is):
    today_is(date(2026, 6, 10))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    add(client, auth, date(2026, 6, 7))  # Sunday: last week
    add(client, auth, date(2026, 6, 8))  # Monday: this week
    assert goal(client, auth)["this_week"] == 1


def test_the_boundary_from_the_other_side_on_a_sunday_the_whole_week_counts_and_next_monday_starts_fresh(client, auth, today_is):
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    for day in (MONDAY, date(2026, 6, 10), SUNDAY):
        add(client, auth, day)
    today_is(SUNDAY)
    assert goal(client, auth)["this_week"] == 3
    today_is(date(2026, 6, 15))  # the next Monday: those three are now last week
    assert goal(client, auth)["this_week"] == 0
    assert goal(client, auth)["week_start"] == "2026-06-15"


def test_an_application_dated_later_this_week_does_not_count_yet(client, auth, today_is):
    today_is(date(2026, 6, 10))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    add(client, auth, date(2026, 6, 10))
    add(client, auth, date(2026, 6, 12))  # entered in advance: you cannot have applied on Friday yet
    assert goal(client, auth)["this_week"] == 1


def test_saved_jobs_do_not_count_but_marking_one_applied_does(client, auth, today_is):
    today_is(date(2026, 6, 10))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    saved_id = add(client, auth, date(2026, 6, 10), status="saved")
    assert goal(client, auth)["this_week"] == 0  # browsing is not applying
    client.patch(f"/applications/{saved_id}", json={"status": "applied", "date_applied": "2026-06-10"}, headers=auth)
    assert goal(client, auth)["this_week"] == 1


def test_moving_an_application_back_to_saved_takes_it_out_of_the_count(client, auth, today_is):
    today_is(date(2026, 6, 10))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    app_id = add(client, auth, date(2026, 6, 10))
    client.patch(f"/applications/{app_id}", json={"status": "saved"}, headers=auth)
    assert goal(client, auth)["this_week"] == 0


@pytest.mark.parametrize("status", ["applied", "screening", "interview", "offer", "offer_accepted", "offer_declined", "rejected", "withdrawn"])
def test_every_status_beyond_saved_counts_because_you_did_apply(client, auth, today_is, status):
    today_is(date(2026, 6, 10))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    add(client, auth, date(2026, 6, 10), status=status)
    assert goal(client, auth)["this_week"] == 1


def test_archived_applications_still_count(client, auth, today_is):
    today_is(date(2026, 6, 10))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    app_id = add(client, auth, date(2026, 6, 10), status="rejected")
    client.patch(f"/applications/{app_id}", json={"archived": True}, headers=auth)
    assert goal(client, auth)["this_week"] == 1


def test_reaching_and_passing_the_goal(client, auth, today_is):
    today_is(date(2026, 6, 9))
    client.patch("/auth/me", json={"weekly_goal": 2}, headers=auth)
    add(client, auth, date(2026, 6, 8))
    assert goal(client, auth)["reached"] is False and goal(client, auth)["remaining"] == 1
    add(client, auth, date(2026, 6, 9))
    add(client, auth, date(2026, 6, 9))
    got = goal(client, auth)
    assert (got["this_week"], got["reached"], got["remaining"]) == (3, True, 0)


def test_the_goal_is_always_about_this_week_whatever_time_range_the_dashboard_shows(client, auth, today_is):
    today_is(date(2026, 6, 10))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    add(client, auth, date(2026, 6, 9))
    assert goal(client, auth, weeks=1)["this_week"] == goal(client, auth)["this_week"] == goal(client, auth, weeks=52)["this_week"] == 1


def test_only_your_own_applications_count(client, auth, other_auth, today_is):
    today_is(date(2026, 6, 10))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    add(client, other_auth, date(2026, 6, 10))
    assert goal(client, auth)["this_week"] == 0


def test_the_count_agrees_with_the_weekly_chart_for_this_week(client, auth, today_is):
    """The same definition as "applications per week": the goal's count is that chart's last bar (for applications up to today)."""
    today_is(date(2026, 6, 11))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    for day in (MONDAY, date(2026, 6, 10), date(2026, 6, 11)):
        add(client, auth, day)
    add(client, auth, date(2026, 6, 1))
    body = client.get("/stats", headers=auth).json()
    assert body["per_week"][-1]["count"] == body["goal"]["this_week"] == 3


def test_changing_the_goal_changes_the_target_not_the_count(client, auth, today_is):
    today_is(date(2026, 6, 10))
    add(client, auth, date(2026, 6, 10))
    client.patch("/auth/me", json={"weekly_goal": 5}, headers=auth)
    first = goal(client, auth)
    client.patch("/auth/me", json={"weekly_goal": 20}, headers=auth)
    second = goal(client, auth)
    assert (first["this_week"], second["this_week"]) == (1, 1) and (first["target"], second["target"]) == (5, 20)
