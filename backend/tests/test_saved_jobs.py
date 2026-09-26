from datetime import date, timedelta

import pytest


BASE = {"company": "Acme Corp", "role": "Backend Engineer"}
TODAY = date.today().isoformat()


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def patch(client, auth, app_id, **fields):
    return client.patch(f"/applications/{app_id}", json=fields, headers=auth)


def stats(client, auth, **params):
    res = client.get("/stats", params=params, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


def companies(client, auth, **params):
    return [a["company"] for a in client.get("/applications", params=params, headers=auth).json()["items"]]


# --- saving a job -------------------------------------------------------------


def test_a_saved_job_has_no_applied_date(client, auth):
    app = create(client, auth, status="saved")
    assert app["status"] == "saved"
    assert app["date_applied"] is None
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["date_applied"] is None


def test_a_saved_job_still_takes_all_the_other_details(client, auth):
    app = create(client, auth, status="saved", job_url="https://example.com/j", location="Portland", work_mode="hybrid", follow_up_date="2026-12-01", notes="Apply by Friday")
    assert (app["job_url"], app["location"], app["work_mode"], app["follow_up_date"]) == ("https://example.com/j", "Portland", "hybrid", "2026-12-01")


def test_a_saved_job_may_be_given_a_date_anyway(client, auth):
    assert create(client, auth, status="saved", date_applied="2026-03-01")["date_applied"] == "2026-03-01"


def test_history_starts_at_saved(client, auth):
    app = create(client, auth, status="saved")
    assert [(h["from_status"], h["to_status"]) for h in app["history"]] == [(None, "saved")]


def test_every_other_status_still_defaults_to_today_when_no_date_is_given(client, auth):
    assert create(client, auth)["date_applied"] == TODAY
    assert create(client, auth, status="interview", date_applied=None)["date_applied"] == TODAY


def test_saved_is_the_first_status_and_a_valid_filter(client, auth):
    create(client, auth, company="Wish", status="saved")
    create(client, auth, company="Sent")
    assert companies(client, auth, status="saved") == ["Wish"]
    assert companies(client, auth, status="applied") == ["Sent"]


# --- converting to Applied ----------------------------------------------------


def test_moving_a_saved_job_to_applied_sets_the_date_to_today(client, auth):
    app = create(client, auth, status="saved")
    res = patch(client, auth, app["id"], status="applied")
    assert res.status_code == 200
    assert (res.json()["status"], res.json()["date_applied"]) == ("applied", TODAY)
    assert [(h["from_status"], h["to_status"]) for h in res.json()["history"]] == [(None, "saved"), ("saved", "applied")]


def test_the_date_can_be_chosen_while_converting(client, auth):
    app = create(client, auth, status="saved")
    res = patch(client, auth, app["id"], status="applied", date_applied="2026-03-04")
    assert res.json()["date_applied"] == "2026-03-04"


def test_a_saved_job_can_skip_straight_past_applied(client, auth):
    app = create(client, auth, status="saved")
    res = patch(client, auth, app["id"], status="screening")  # applied and heard back, entered late
    assert (res.json()["status"], res.json()["date_applied"]) == ("screening", TODAY)


def test_editing_a_saved_job_without_changing_its_status_keeps_it_saved_and_undated(client, auth):
    app = create(client, auth, status="saved")
    res = patch(client, auth, app["id"], notes="Looks good", date_applied=None)  # what the edit form sends
    assert res.status_code == 200
    assert (res.json()["status"], res.json()["date_applied"]) == ("saved", None)


def test_you_cannot_clear_the_date_of_an_application_you_have_made(client, auth):
    app = create(client, auth, date_applied="2026-03-01")
    res = patch(client, auth, app["id"], date_applied=None)
    assert res.status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["date_applied"] == "2026-03-01"


def test_moving_an_applied_job_back_to_saved_keeps_its_date_so_a_slip_loses_nothing(client, auth):
    app = create(client, auth, date_applied="2026-03-01")
    back = patch(client, auth, app["id"], status="saved").json()
    assert (back["status"], back["date_applied"]) == ("saved", "2026-03-01")
    again = patch(client, auth, app["id"], status="applied").json()
    assert (again["status"], again["date_applied"]) == ("applied", "2026-03-01")  # the original date, not today


def test_converting_twice_does_not_touch_the_date_again(client, auth):
    app = create(client, auth, status="saved")
    patch(client, auth, app["id"], status="applied", date_applied="2026-03-04")
    assert patch(client, auth, app["id"], status="interview").json()["date_applied"] == "2026-03-04"


# --- saved jobs stay out of applied-only figures -----------------------------


def test_saved_jobs_do_not_appear_in_any_stat(client, auth):
    for _ in range(5):
        create(client, auth, status="saved")
    body = stats(client, auth)
    assert body["total"] == 0
    assert body["response"] == {"responded": 0, "eligible": 0, "rate": None}
    assert body["per_week"] == []
    assert body["no_reply"]["count"] == 0
    assert "saved" not in [row["status"] for row in body["by_status"]]
    assert sum(row["count"] for row in body["by_status"]) == 0


def test_saved_jobs_do_not_skew_the_response_rate_or_the_weekly_chart(client, auth):
    create(client, auth, status="applied")
    create(client, auth, status="interview")
    before = stats(client, auth)
    for _ in range(10):
        create(client, auth, status="saved")
    after = stats(client, auth)
    assert after == before
    assert after["response"] == {"responded": 1, "eligible": 2, "rate": 0.5}
    assert after["total"] == 2


def test_saved_jobs_are_out_of_the_time_window_figures_too(client, auth):
    create(client, auth, status="saved")
    assert stats(client, auth, weeks=4)["total"] == 0


def test_a_job_moved_back_to_saved_leaves_the_stats_and_returns_when_reapplied(client, auth):
    app = create(client, auth, status="interview")
    assert stats(client, auth)["response"]["responded"] == 1
    patch(client, auth, app["id"], status="saved")
    body = stats(client, auth)
    assert (body["total"], body["response"]["responded"]) == (0, 0)  # even though its history shows an interview
    patch(client, auth, app["id"], status="applied")
    assert stats(client, auth)["total"] == 1


def test_a_converted_job_counts_as_an_application_from_the_day_it_was_applied(client, auth):
    app = create(client, auth, status="saved")
    patch(client, auth, app["id"], status="applied", date_applied=(date.today() - timedelta(days=40)).isoformat())
    body = stats(client, auth)
    assert body["total"] == 1
    assert body["no_reply"]["count"] == 1  # applied 40 days ago and still at Applied


# --- listing, ordering, reminders, export ------------------------------------


def test_saved_jobs_sort_after_dated_applications_on_every_database(client, auth):
    create(client, auth, company="Saved early", status="saved")
    create(client, auth, company="Old", date_applied="2026-01-01")
    create(client, auth, company="New", date_applied="2026-03-01")
    create(client, auth, company="Saved late", status="saved")
    assert companies(client, auth) == ["New", "Old", "Saved late", "Saved early"]  # saved: newest entered first


def test_a_date_filter_never_returns_undated_saved_jobs(client, auth):
    create(client, auth, company="Saved", status="saved")
    create(client, auth, company="Dated", date_applied="2026-03-01")
    assert companies(client, auth, date_from="2000-01-01") == ["Dated"]
    assert companies(client, auth, date_to="2099-01-01") == ["Dated"]


def test_a_saved_job_with_a_follow_up_date_appears_in_the_upcoming_reminders(client, auth):
    """Follow up by doubles as "apply by" for a job you are still deciding about."""
    create(client, auth, company="Apply soon", status="saved", follow_up_date=(date.today() + timedelta(days=2)).isoformat())
    assert [a["company"] for a in client.get("/applications/upcoming", headers=auth).json()] == ["Apply soon"]


def test_the_csv_export_leaves_the_applied_date_empty_for_a_saved_job(client, auth):
    import csv
    import io

    create(client, auth, company="Saved", status="saved")
    text = client.get("/applications/export.csv", headers=auth).text.lstrip("﻿")
    (row,) = csv.DictReader(io.StringIO(text))
    assert (row["Status"], row["Date applied"]) == ("saved", "")


def test_another_users_saved_jobs_are_not_visible(client, auth, other_auth):
    create(client, other_auth, company="Theirs", status="saved")
    assert companies(client, auth, status="saved") == []


@pytest.mark.parametrize("status", ["saved"])
def test_the_status_history_records_a_move_into_saved(client, auth, status):
    app = create(client, auth)
    assert [h["to_status"] for h in patch(client, auth, app["id"], status=status).json()["history"]] == ["applied", "saved"]
