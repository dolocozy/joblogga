from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.models import StatusChange

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def offers(client, auth, **params):
    res = client.get("/applications/offers", params=params, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


def names(client, auth, **params):
    return [o["company"] for o in offers(client, auth, **params)]


def at(day: int, month: int = 6) -> datetime:
    return datetime(2026, month, day, 12, tzinfo=UTC)


def walk(client, auth, db, steps, applied="2026-06-01", **fields):
    """Create an application and walk it through `steps` [(status, when)], setting the history to exactly those times."""
    res = client.post("/applications", json={**BASE, "status": steps[0][0], "date_applied": applied, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    app_id = res.json()["id"]
    for status, _ in steps[1:]:
        assert client.patch(f"/applications/{app_id}", json={"status": status}, headers=auth).status_code == 200
    rows = db.scalars(select(StatusChange).where(StatusChange.application_id == app_id).order_by(StatusChange.id)).all()
    for row, (_, when) in zip(rows, steps, strict=True):
        row.changed_at = when
    db.commit()
    return app_id


def test_it_needs_a_login(client):
    assert client.get("/applications/offers").status_code == 401


def test_no_offers_is_an_empty_list(client, auth):
    create(client, auth)
    assert offers(client, auth) == []


@pytest.mark.parametrize("status", ["offer", "offer_accepted", "offer_declined"])
def test_every_offer_stage_is_included(client, auth, status):
    create(client, auth, company="Has an offer", status=status)
    assert names(client, auth) == ["Has an offer"]


@pytest.mark.parametrize("status", ["saved", "applied", "screening", "interview", "rejected", "withdrawn"])
def test_nothing_else_is_included(client, auth, status):
    create(client, auth, company="Not an offer", status=status)
    assert offers(client, auth) == []


def test_it_selects_exactly_the_offer_stage_applications_among_others(client, auth):
    for company, status in [("A", "offer"), ("B", "applied"), ("C", "offer_accepted"), ("D", "rejected"), ("E", "offer_declined"), ("F", "interview"), ("G", "saved")]:
        create(client, auth, company=company, status=status)
    assert sorted(names(client, auth)) == ["A", "C", "E"]


def test_it_carries_what_a_decision_needs_side_by_side(client, auth):
    create(
        client,
        auth,
        company="Acme",
        status="offer",
        salary_min=100000,
        salary_max=120000,
        salary_currency="EUR",
        work_mode="hybrid",
        location="Lisbon",
        notes="Great team, long commute",
        interview_round=4,
        interview_rounds_total=4,
        tags=["dream job"],
        job_url="https://jobs.example.com/acme",
    )
    (o,) = offers(client, auth)
    assert (o["salary_min"], o["salary_max"], o["salary_currency"]) == (100000, 120000, "EUR")
    assert (o["work_mode"], o["location_display"], o["notes"]) == ("hybrid", "Lisbon", "Great team, long commute")
    assert (o["interview_round"], o["interview_rounds_total"], o["tags"], o["job_url"]) == (4, 4, ["dream job"], "https://jobs.example.com/acme")
    assert (o["status"], o["role"], o["company"]) == ("offer", "Backend Engineer", "Acme")


def test_archived_offers_are_left_out_unless_asked_for(client, auth):
    keep = create(client, auth, company="Keep", status="offer")
    old = create(client, auth, company="Old", status="offer_declined")
    client.patch(f"/applications/{old['id']}", json={"archived": True}, headers=auth)
    assert names(client, auth) == ["Keep"]
    assert sorted(names(client, auth, archived="include")) == ["Keep", "Old"]
    assert keep["archived"] is False
    assert names(client, auth, archived="only") == ["Old"]
    assert client.get("/applications/offers", params={"archived": "maybe"}, headers=auth).status_code == 422


def test_only_your_own_offers(client, auth, other_auth):
    create(client, other_auth, company="Theirs", status="offer")
    create(client, auth, company="Mine", status="offer")
    assert names(client, auth) == ["Mine"]


# --- how long the offer took ---------------------------------------------------------------


def test_days_to_offer_is_from_the_applied_date_to_the_day_the_offer_was_recorded(client, auth, db):
    walk(client, auth, db, [("applied", at(1)), ("screening", at(5)), ("interview", at(12)), ("offer", at(24))], applied="2026-06-01")
    (o,) = offers(client, auth)
    assert (o["offer_recorded_on"], o["days_to_offer"]) == ("2026-06-24", 23)


def test_it_is_the_first_time_an_offer_status_was_reached(client, auth, db):
    walk(client, auth, db, [("applied", at(1)), ("offer", at(10)), ("offer_declined", at(20))], applied="2026-06-01")
    (o,) = offers(client, auth)
    assert (o["offer_recorded_on"], o["days_to_offer"]) == ("2026-06-10", 9)  # not the day it was declined


def test_an_offer_that_went_straight_to_accepted_still_counts_from_that_status(client, auth, db):
    walk(client, auth, db, [("applied", at(1)), ("offer_accepted", at(15))], applied="2026-06-01")
    (o,) = offers(client, auth)
    assert (o["offer_recorded_on"], o["days_to_offer"]) == ("2026-06-15", 14)


def test_an_offer_that_was_withdrawn_from_and_came_back_uses_the_first_offer(client, auth, db):
    walk(client, auth, db, [("applied", at(1)), ("offer", at(8)), ("interview", at(9)), ("offer", at(20))], applied="2026-06-01")
    (o,) = offers(client, auth)
    assert o["offer_recorded_on"] == "2026-06-08"


def test_the_days_are_unknown_not_negative_when_dates_are_out_of_order(client, auth, db):
    walk(client, auth, db, [("applied", at(1)), ("offer", at(3))], applied="2026-06-20")  # "applied" after the offer was recorded
    (o,) = offers(client, auth)
    assert (o["offer_recorded_on"], o["days_to_offer"]) == ("2026-06-03", None)


def test_the_days_are_unknown_without_an_applied_date(client, auth, db):
    app_id = walk(client, auth, db, [("saved", at(1)), ("offer", at(10))])
    from app.models import Application

    db.get(Application, app_id).date_applied = None
    db.commit()
    (o,) = offers(client, auth)
    assert (o["offer_recorded_on"], o["days_to_offer"]) == ("2026-06-10", None)


def test_the_newest_offer_comes_first_and_an_undated_one_last(client, auth, db):
    walk(client, auth, db, [("applied", at(1)), ("offer", at(10))], company="Older")
    walk(client, auth, db, [("applied", at(1)), ("offer", at(20))], company="Newer")
    walk(client, auth, db, [("applied", at(1)), ("offer", at(15))], company="Middle")
    assert names(client, auth) == ["Newer", "Middle", "Older"]


def test_it_changes_nothing(client, auth, db):
    app_id = walk(client, auth, db, [("applied", at(1)), ("offer", at(10))])
    before = client.get(f"/applications/{app_id}", headers=auth).json()
    offers(client, auth)
    assert client.get(f"/applications/{app_id}", headers=auth).json() == before
