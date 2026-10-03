from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import ApplicationStatus as S
from app.models import StatusChange
from app.routers import stats as stats_module
from app.stage_times import STAGES, Step, stage_stats

NOW = datetime(2026, 7, 1, 12, tzinfo=UTC)


def at(day: int, hour: int = 12) -> datetime:
    """Day N of June 2026."""
    return datetime(2026, 6, day, hour, tzinfo=UTC)


def stat(result, status):
    return next(s for s in result if s.status == status)


# --- the calculation, against known histories ------------------------------------------


def test_every_pipeline_stage_is_always_reported_in_order_even_with_no_data():
    result = stage_stats([], NOW)
    assert [s.status for s in result] == [S.APPLIED, S.SCREENING, S.INTERVIEW, S.OFFER] == list(STAGES)
    assert all(s.finished == 0 and s.mean_days is None and s.median_days is None and s.in_progress == 0 and s.in_progress_mean_days is None for s in result)


def test_a_full_chain_gives_the_gap_between_each_change():
    # applied Jun 1, screening Jun 4 (3 days in Applied), interview Jun 11 (7 in Screening), offer Jun 13 (2 in Interview), accepted Jun 20
    steps = [Step(S.APPLIED, at(1)), Step(S.SCREENING, at(4)), Step(S.INTERVIEW, at(11)), Step(S.OFFER, at(13)), Step(S.OFFER_ACCEPTED, at(20))]
    result = stage_stats([(date(2026, 6, 1), steps)], NOW)
    assert (stat(result, S.APPLIED).finished, stat(result, S.APPLIED).mean_days) == (1, 3.0)
    assert (stat(result, S.SCREENING).finished, stat(result, S.SCREENING).mean_days) == (1, 7.0)
    assert (stat(result, S.INTERVIEW).finished, stat(result, S.INTERVIEW).mean_days) == (1, 2.0)
    assert (stat(result, S.OFFER).finished, stat(result, S.OFFER).mean_days) == (1, 7.0)  # 13th to 20th, ended by accepting


def test_partial_days_count():
    steps = [Step(S.APPLIED, at(1, 12)), Step(S.SCREENING, at(2, 0))]
    assert stat(stage_stats([(date(2026, 6, 1), steps)], NOW), S.APPLIED).mean_days == 0.5


def test_the_mean_and_the_median_are_over_every_application():
    def app(days):  # applied, then screening `days` later, then rejected
        return (date(2026, 6, 1), [Step(S.APPLIED, at(1)), Step(S.SCREENING, at(1) + timedelta(days=days)), Step(S.REJECTED, at(25))])

    result = stage_stats([app(2), app(4), app(12)], NOW)
    applied = stat(result, S.APPLIED)
    assert (applied.finished, applied.mean_days, applied.median_days) == (3, 6.0, 4.0)  # the median ignores the one slow outlier
    even = stage_stats([app(2), app(4), app(6), app(12)], NOW)
    assert stat(even, S.APPLIED).median_days == 5.0  # the middle two averaged


def test_a_stage_still_in_progress_is_kept_out_of_the_average_and_reported_on_its_own():
    done = (date(2026, 6, 1), [Step(S.APPLIED, at(1)), Step(S.SCREENING, at(5)), Step(S.REJECTED, at(9))])
    waiting = (date(2026, 6, 21), [Step(S.APPLIED, at(21))])  # still Applied on Jul 1: 10 days so far
    result = stage_stats([done, waiting], NOW)
    applied = stat(result, S.APPLIED)
    assert (applied.finished, applied.mean_days) == (1, 4.0)  # only the stay that ended: not dragged to 7 by the open one
    assert (applied.in_progress, applied.in_progress_mean_days) == (1, 10.0)
    assert stat(result, S.SCREENING).in_progress == 0


def test_an_application_with_only_an_open_stay_has_no_average_yet():
    result = stage_stats([(date(2026, 6, 21), [Step(S.APPLIED, at(21))])], NOW)
    applied = stat(result, S.APPLIED)
    assert (applied.finished, applied.mean_days, applied.median_days, applied.in_progress) == (0, None, None, 1)


def test_several_open_stays_in_one_stage_are_averaged():
    waiting = [(date(2026, 6, d), [Step(S.INTERVIEW, at(d))]) for d in (21, 26)]  # 10 and 5 days so far
    interview = stat(stage_stats(waiting, NOW), S.INTERVIEW)
    assert (interview.in_progress, interview.in_progress_mean_days) == (2, 7.5)


def test_a_stage_skipped_entirely_has_no_stay():
    steps = [Step(S.APPLIED, at(1)), Step(S.REJECTED, at(8))]  # straight from Applied to Rejected
    result = stage_stats([(date(2026, 6, 1), steps)], NOW)
    assert (stat(result, S.APPLIED).finished, stat(result, S.APPLIED).mean_days) == (1, 7.0)
    for skipped in (S.SCREENING, S.INTERVIEW, S.OFFER):
        s = stat(result, skipped)
        assert (s.finished, s.in_progress, s.mean_days) == (0, 0, None)


def test_skipping_a_stage_in_the_middle_does_not_invent_time_in_it():
    steps = [Step(S.APPLIED, at(1)), Step(S.INTERVIEW, at(6)), Step(S.REJECTED, at(8))]  # never screened
    result = stage_stats([(date(2026, 6, 1), steps)], NOW)
    assert (stat(result, S.SCREENING).finished, stat(result, S.INTERVIEW).mean_days) == (0, 2.0)


@pytest.mark.parametrize("ending", [S.REJECTED, S.WITHDRAWN, S.OFFER_ACCEPTED, S.OFFER_DECLINED])
def test_the_endings_are_not_stages_so_time_after_the_end_is_not_measured(ending):
    result = stage_stats([(date(2026, 6, 1), [Step(S.APPLIED, at(1)), Step(ending, at(3))])], NOW)
    assert [s.status for s in result] == list(STAGES)  # no row for the ending


def test_a_stage_entered_twice_counts_each_stay():
    steps = [Step(S.APPLIED, at(1)), Step(S.INTERVIEW, at(3)), Step(S.APPLIED, at(5)), Step(S.INTERVIEW, at(6)), Step(S.REJECTED, at(10))]
    result = stage_stats([(date(2026, 6, 1), steps)], NOW)
    assert (stat(result, S.INTERVIEW).finished, stat(result, S.INTERVIEW).mean_days) == (2, 3.0)  # 2 days then 4 days
    assert stat(result, S.APPLIED).finished == 2  # Jun 1 to 3, and Jun 5 to 6


def test_saved_is_not_a_stage_and_time_spent_saved_is_not_counted():
    steps = [Step(S.SAVED, at(1)), Step(S.APPLIED, at(10)), Step(S.SCREENING, at(12))]
    result = stage_stats([(date(2026, 6, 10), steps)], NOW)
    assert stat(result, S.APPLIED).mean_days == 2.0


def test_an_application_added_afterwards_starts_applied_on_its_applied_date():
    """Entered on Jun 20 for an application made on Jun 1, then moved to screening the same day."""
    steps = [Step(S.APPLIED, at(20)), Step(S.SCREENING, at(20, 15))]
    result = stage_stats([(date(2026, 6, 1), steps)], NOW)
    assert stat(result, S.APPLIED).mean_days == pytest.approx(19.125, abs=0.01)  # Jun 1 noon to Jun 20 3pm, not 3 hours


def test_the_applied_date_is_used_for_the_first_entry_into_applied_only():
    steps = [Step(S.APPLIED, at(20)), Step(S.SCREENING, at(22)), Step(S.APPLIED, at(23)), Step(S.REJECTED, at(25))]
    result = stage_stats([(date(2026, 6, 1), steps)], NOW)
    applied = stat(result, S.APPLIED)
    assert (applied.finished, applied.mean_days) == (2, 11.5)  # (21 days from the applied date + 2 days) / 2: the second entry uses its own time


def test_converting_a_saved_job_with_a_chosen_earlier_date_starts_applied_on_that_date():
    steps = [Step(S.SAVED, at(1)), Step(S.APPLIED, at(10)), Step(S.SCREENING, at(12))]  # marked applied on the 10th, "applied" on the 5th
    result = stage_stats([(date(2026, 6, 5), steps)], NOW)
    assert stat(result, S.APPLIED).mean_days == 7.0


def test_an_applied_date_later_than_the_entry_is_not_used():
    steps = [Step(S.APPLIED, at(1)), Step(S.SCREENING, at(4))]
    assert stat(stage_stats([(date(2026, 6, 20), steps)], NOW), S.APPLIED).mean_days == 3.0  # entered in advance: keep the entry time


def test_no_applied_date_falls_back_to_the_entry_time():
    steps = [Step(S.APPLIED, at(1)), Step(S.SCREENING, at(4))]
    assert stat(stage_stats([(None, steps)], NOW), S.APPLIED).mean_days == 3.0


def test_dates_entered_out_of_order_are_ignored_not_counted_as_negative_time():
    steps = [Step(S.APPLIED, at(10)), Step(S.SCREENING, at(5)), Step(S.INTERVIEW, at(8))]  # the second change is dated before the first
    result = stage_stats([(None, steps)], NOW)
    assert stat(result, S.APPLIED).finished == 0  # the impossible stay is left out
    assert stat(result, S.SCREENING).mean_days == 3.0  # the sensible one is kept


def test_an_open_stay_that_starts_in_the_future_is_ignored():
    steps = [Step(S.APPLIED, NOW + timedelta(days=3))]
    assert stat(stage_stats([(None, steps)], NOW), S.APPLIED).in_progress == 0


def test_an_empty_history_is_harmless():
    assert stage_stats([(date(2026, 6, 1), [])], NOW) == stage_stats([], NOW)


def test_two_changes_at_the_same_instant_make_a_zero_length_stay():
    steps = [Step(S.APPLIED, at(1)), Step(S.SCREENING, at(1)), Step(S.REJECTED, at(3))]
    result = stage_stats([(None, steps)], NOW)
    assert (stat(result, S.APPLIED).finished, stat(result, S.APPLIED).mean_days) == (1, 0.0)


def test_figures_are_rounded_to_hundredths_of_a_day():
    steps = [Step(S.APPLIED, at(1, 0)), Step(S.SCREENING, at(1, 0) + timedelta(hours=1))]
    assert stat(stage_stats([(None, steps)], NOW), S.APPLIED).mean_days == 0.04  # 1 hour


# --- through the API -------------------------------------------------------------------------

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


@pytest.fixture
def frozen_now(monkeypatch):
    monkeypatch.setattr(stats_module, "now", lambda: NOW)


def build(client, auth, db, steps, applied="2026-06-01", **fields):
    """Create an application, walk it through `steps` (status, when), then set the history to exactly those times."""
    first_status = steps[0][0]
    res = client.post("/applications", json={**BASE, "status": first_status, "date_applied": applied, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    app_id = res.json()["id"]
    for status, _ in steps[1:]:
        assert client.patch(f"/applications/{app_id}", json={"status": status}, headers=auth).status_code == 200
    rows = db.scalars(select(StatusChange).where(StatusChange.application_id == app_id).order_by(StatusChange.id)).all()
    assert len(rows) == len(steps)
    for row, (_, when) in zip(rows, steps, strict=True):
        row.changed_at = when
    db.commit()
    return app_id


def stages(client, auth, **params):
    res = client.get("/stats", params=params, headers=auth)
    assert res.status_code == 200, res.text
    return {s["status"]: s for s in res.json()["stages"]}


def test_the_stats_always_include_the_four_stages_even_for_an_empty_account(client, auth, frozen_now):
    got = client.get("/stats", headers=auth).json()["stages"]
    assert [s["status"] for s in got] == ["applied", "screening", "interview", "offer"]
    assert got[0] == {"status": "applied", "finished": 0, "mean_days": None, "median_days": None, "in_progress": 0, "in_progress_mean_days": None}


def test_durations_come_from_the_applications_history(client, auth, db, frozen_now):
    build(client, auth, db, [("applied", at(1)), ("screening", at(4)), ("interview", at(11)), ("rejected", at(14))])
    got = stages(client, auth)
    assert (got["applied"]["mean_days"], got["screening"]["mean_days"], got["interview"]["mean_days"]) == (3.0, 7.0, 3.0)
    assert got["offer"]["finished"] == 0


def test_an_application_still_in_a_stage_is_reported_as_waiting_not_averaged(client, auth, db, frozen_now):
    build(client, auth, db, [("applied", at(1)), ("screening", at(5)), ("rejected", at(9))], company="Done")
    build(client, auth, db, [("applied", at(21))], applied="2026-06-21", company="Waiting")
    applied = stages(client, auth)["applied"]
    assert (applied["finished"], applied["mean_days"]) == (1, 4.0)
    assert (applied["in_progress"], applied["in_progress_mean_days"]) == (1, 10.0)


def test_an_application_that_skipped_a_stage_is_handled(client, auth, db, frozen_now):
    build(client, auth, db, [("applied", at(1)), ("rejected", at(8))])
    got = stages(client, auth)
    assert got["applied"]["mean_days"] == 7.0
    assert (got["screening"]["finished"], got["interview"]["finished"]) == (0, 0)


def test_the_time_window_scopes_the_stages_like_every_other_figure(client, auth, db, frozen_now):
    today = date.today()
    old = (today - timedelta(weeks=20)).isoformat()
    build(client, auth, db, [("applied", at(1)), ("screening", at(11))], applied=old, company="Old")
    build(client, auth, db, [("applied", at(1)), ("screening", at(3))], applied=today.isoformat(), company="Recent")
    assert stages(client, auth)["applied"]["finished"] == 2
    windowed = stages(client, auth, weeks=4)["applied"]
    assert (windowed["finished"], windowed["mean_days"]) == (1, 2.0)  # only the recent application


def test_saved_jobs_are_left_out_and_so_is_time_spent_saved(client, auth, db, frozen_now):
    client.post("/applications", json={**BASE, "status": "saved"}, headers=auth)
    build(client, auth, db, [("saved", at(1)), ("applied", at(10)), ("screening", at(12))], applied="2026-06-10", company="Converted")
    got = stages(client, auth)
    assert (got["applied"]["finished"], got["applied"]["mean_days"]) == (1, 2.0)


def test_an_application_moved_back_to_saved_leaves_the_stages_like_it_leaves_everything_else(client, auth, db, frozen_now):
    app_id = build(client, auth, db, [("applied", at(1)), ("screening", at(4))])
    client.patch(f"/applications/{app_id}", json={"status": "saved"}, headers=auth)
    assert stages(client, auth)["applied"]["finished"] == 0


def test_archived_applications_still_count(client, auth, db, frozen_now):
    app_id = build(client, auth, db, [("applied", at(1)), ("screening", at(4)), ("rejected", at(6))])
    before = stages(client, auth)
    client.patch(f"/applications/{app_id}", json={"archived": True}, headers=auth)
    assert stages(client, auth) == before  # archiving is a view preference, not a deletion


def test_only_your_own_applications_are_used(client, auth, other_auth, db, frozen_now):
    build(client, other_auth, db, [("applied", at(1)), ("screening", at(20))], company="Theirs")
    assert stages(client, auth)["applied"]["finished"] == 0


def test_the_applied_date_corrects_an_application_entered_after_the_fact(client, auth, db, frozen_now):
    build(client, auth, db, [("applied", at(20)), ("screening", at(20, 15))], applied="2026-06-01")
    assert stages(client, auth)["applied"]["mean_days"] == pytest.approx(19.12, abs=0.02)


def test_importing_an_exported_history_keeps_the_durations(client, auth, db, frozen_now):
    from tests.conftest import make_user

    build(client, auth, db, [("applied", at(1)), ("screening", at(4)), ("interview", at(11))])
    fresh = make_user(client, email="fresh@example.com")
    data = client.get("/applications/export.csv", headers=auth).content
    assert client.post("/applications/import", content=data, headers={**fresh, "Content-Type": "text/csv"}).status_code == 200
    mine, restored = stages(client, auth), stages(client, fresh)
    assert (restored["applied"]["mean_days"], restored["screening"]["mean_days"]) == (mine["applied"]["mean_days"], mine["screening"]["mean_days"])
    assert restored["interview"]["in_progress"] == 1


def test_stage_times_do_not_change_any_other_figure(client, auth, db, frozen_now):
    build(client, auth, db, [("applied", at(1)), ("screening", at(4)), ("interview", at(11))])
    body = client.get("/stats", headers=auth).json()
    assert body["total"] == 1 and body["response"] == {"responded": 1, "eligible": 1, "rate": 1.0}
