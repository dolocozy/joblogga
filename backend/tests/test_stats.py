from datetime import date, timedelta

import pytest

from app.models import ApplicationStatus
from app.routers.stats import response_rate, week_start


def monday_of_this_week() -> date:
    return week_start(date.today())


def add(client, auth, status="applied", applied=None, n=1):
    for _ in range(n):
        res = client.post(
            "/applications",
            json={"company": "Acme", "role": "Eng", "status": status, "date_applied": (applied or date.today()).isoformat()},
            headers=auth,
        )
        assert res.status_code == 201, res.text


def stats(client, auth, **params):
    res = client.get("/stats", params=params, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


def counts_by_status(body):
    return {row["status"]: row["count"] for row in body["by_status"]}


# --- the response-rate definition (pure function) ---------------------------


def test_rate_is_responded_over_eligible():
    r = response_rate(4, 8)
    assert (r.responded, r.eligible, r.rate) == (4, 8, 0.5)


def test_rate_is_none_when_nothing_is_eligible_and_zero_when_nobody_replied():
    assert response_rate(0, 0).rate is None  # no data is not 0%
    assert response_rate(0, 2).rate == 0.0  # eligible, no replies: a real 0%


# --- endpoint ---------------------------------------------------------------


def test_requires_login(client):
    assert client.get("/stats").status_code == 401


def test_empty_account(client, auth):
    body = stats(client, auth)
    assert body["total"] == 0
    assert counts_by_status(body) == {s.value: 0 for s in ApplicationStatus}
    assert body["response"] == {"responded": 0, "eligible": 0, "rate": None}
    assert body["per_week"] == []  # all time, no data: nothing to plot


def test_by_status_lists_every_status_in_pipeline_order(client, auth):
    add(client, auth, "interview", n=2)
    add(client, auth, "rejected")
    body = stats(client, auth)
    assert [r["status"] for r in body["by_status"]] == ["applied", "screening", "interview", "offer", "rejected", "withdrawn"]
    assert counts_by_status(body)["interview"] == 2
    assert counts_by_status(body)["screening"] == 0  # zero rows are still present
    assert body["total"] == 3


def test_response_rate_end_to_end(client, auth):
    add(client, auth, "applied", n=2)
    add(client, auth, "screening")
    add(client, auth, "interview")
    add(client, auth, "offer")
    add(client, auth, "rejected")
    add(client, auth, "withdrawn", n=3)
    body = stats(client, auth)
    assert body["total"] == 9
    assert body["response"]["responded"] == 4
    assert body["response"]["eligible"] == 6
    assert body["response"]["rate"] == pytest.approx(4 / 6)


def move(client, auth, app_id, *statuses):
    for s in statuses:
        assert client.patch(f"/applications/{app_id}", json={"status": s}, headers=auth).status_code == 200


def first_id(client, auth):
    return client.get("/applications", headers=auth).json()["items"][0]["id"]


def test_interview_then_withdrawn_still_counts_as_a_response(client, auth):
    """The regression this fixes: Applied -> Interview -> Withdrawn used to drop out of the rate."""
    add(client, auth, "applied")
    move(client, auth, first_id(client, auth), "interview", "withdrawn")

    body = stats(client, auth)

    assert counts_by_status(body)["withdrawn"] == 1  # it does end as withdrawn...
    assert body["response"] == {"responded": 1, "eligible": 1, "rate": 1.0}  # ...and was answered


def test_withdrawing_before_any_response_stays_out_of_both_sides(client, auth):
    add(client, auth, "applied")  # one plain unanswered application
    add(client, auth, "applied")
    move(client, auth, first_id(client, auth), "withdrawn")  # the newest, withdrawn unanswered

    assert stats(client, auth)["response"] == {"responded": 0, "eligible": 1, "rate": 0.0}


def test_any_response_status_in_the_history_counts_not_only_interview(client, auth):
    for reached in ("screening", "offer", "rejected"):
        add(client, auth, "applied")
        move(client, auth, first_id(client, auth), reached, "withdrawn")
    body = stats(client, auth)
    assert body["response"] == {"responded": 3, "eligible": 3, "rate": 1.0}


def test_history_is_what_counts_so_moving_back_to_applied_keeps_the_response(client, auth):
    add(client, auth, "applied")
    move(client, auth, first_id(client, auth), "interview", "applied")  # corrected a slip
    assert stats(client, auth)["response"] == {"responded": 1, "eligible": 1, "rate": 1.0}


def test_history_and_the_window_agree_on_which_applications_are_counted(client, auth):
    old = date.today() - timedelta(weeks=10)
    add(client, auth, "applied", applied=old)
    move(client, auth, first_id(client, auth), "interview", "withdrawn")  # answered, but outside the window
    add(client, auth, "applied")

    assert stats(client, auth, weeks=4)["response"] == {"responded": 0, "eligible": 1, "rate": 0.0}
    assert stats(client, auth)["response"] == {"responded": 1, "eligible": 2, "rate": 0.5}


def test_another_users_history_does_not_leak_into_my_rate(client, auth, other_auth):
    add(client, other_auth, "applied")
    move(client, other_auth, first_id(client, other_auth), "interview")
    add(client, auth, "applied")
    assert stats(client, auth)["response"] == {"responded": 0, "eligible": 1, "rate": 0.0}


def test_status_changes_are_reflected(client, auth):
    add(client, auth, "applied")
    app_id = client.get("/applications", headers=auth).json()["items"][0]["id"]
    client.patch(f"/applications/{app_id}", json={"status": "withdrawn"}, headers=auth)
    body = stats(client, auth)
    assert body["response"] == {"responded": 0, "eligible": 0, "rate": None}


# --- weekly series ----------------------------------------------------------


def test_weeks_param_gives_that_many_zero_filled_weeks_oldest_first_ending_this_week(client, auth):
    add(client, auth)
    week_starts = [w["week_start"] for w in stats(client, auth, weeks=4)["per_week"]]
    monday = monday_of_this_week()
    assert week_starts == [(monday - timedelta(weeks=i)).isoformat() for i in (3, 2, 1, 0)]


def test_applications_are_bucketed_by_monday_start_week(client, auth):
    monday = monday_of_this_week()
    add(client, auth, applied=monday)  # first day of this week
    add(client, auth, applied=monday - timedelta(days=1))  # Sunday: last week
    add(client, auth, applied=monday - timedelta(days=7), n=2)  # Monday of last week
    per_week = {w["week_start"]: w["count"] for w in stats(client, auth, weeks=3)["per_week"]}
    assert per_week[monday.isoformat()] == 1
    assert per_week[(monday - timedelta(days=7)).isoformat()] == 3  # Sunday + 2 Mondays
    assert per_week[(monday - timedelta(days=14)).isoformat()] == 0


def test_window_scopes_everything_not_just_the_chart(client, auth):
    monday = monday_of_this_week()
    add(client, auth, "interview", applied=monday)
    add(client, auth, "rejected", applied=monday - timedelta(weeks=10))  # outside a 4-week window
    inside = stats(client, auth, weeks=4)
    assert inside["total"] == 1
    assert counts_by_status(inside)["rejected"] == 0
    assert inside["response"] == {"responded": 1, "eligible": 1, "rate": 1.0}
    assert sum(w["count"] for w in inside["per_week"]) == inside["total"]  # chart agrees with totals


def test_week_boundary_is_inclusive_of_the_first_day_of_the_window(client, auth):
    monday = monday_of_this_week()
    add(client, auth, applied=monday - timedelta(weeks=3))  # exactly the first day of a 4-week window
    add(client, auth, applied=monday - timedelta(weeks=3, days=1))  # one day before it
    assert stats(client, auth, weeks=4)["total"] == 1


def test_all_time_spans_from_the_first_application_week(client, auth):
    monday = monday_of_this_week()
    add(client, auth, applied=monday - timedelta(weeks=6) + timedelta(days=2))  # a Wednesday, 6 weeks back
    body = stats(client, auth)
    assert body["total"] == 1
    assert len(body["per_week"]) == 7  # 6 weeks back through this week
    assert body["per_week"][0]["week_start"] == (monday - timedelta(weeks=6)).isoformat()
    assert body["per_week"][-1]["week_start"] == monday.isoformat()
    assert sum(w["count"] for w in body["per_week"]) == 1


def test_applications_dated_after_this_week_are_left_out_everywhere(client, auth):
    add(client, auth, applied=monday_of_this_week() + timedelta(days=7))  # next week
    body = stats(client, auth, weeks=4)
    assert body["total"] == 0
    assert sum(w["count"] for w in body["per_week"]) == 0


@pytest.mark.parametrize("weeks", [0, -1, 521])
def test_weeks_must_be_in_range(client, auth, weeks):
    assert client.get("/stats", params={"weeks": weeks}, headers=auth).status_code == 422


# --- isolation --------------------------------------------------------------


def test_only_counts_the_logged_in_users_applications(client, auth, other_auth):
    add(client, auth, "offer")
    add(client, other_auth, "offer", n=5)
    body = stats(client, auth)
    assert body["total"] == 1
    assert sum(w["count"] for w in body["per_week"]) == 1
    assert stats(client, other_auth)["total"] == 5
