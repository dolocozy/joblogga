from datetime import date, timedelta

import pytest

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


# --- create -----------------------------------------------------------------


def test_create_minimal_applies_defaults(client, auth):
    app = create(client, auth)
    assert app["company"] == "Acme Corp"
    assert app["status"] == "applied"
    assert app["date_applied"] == date.today().isoformat()
    assert app["job_url"] is None and app["notes"] is None


def test_create_with_all_fields(client, auth):
    app = create(
        client,
        auth,
        job_url="https://example.com/jobs/1",
        date_applied="2026-03-01",
        resume_version="tech-focused",
        salary_min=90000,
        salary_max=120000,
        location="Remote",
        notes="Referred by Sam",
        status="screening",
        follow_up_date="2026-03-10",
    )
    assert app["resume_version"] == "tech-focused"
    assert (app["salary_min"], app["salary_max"]) == (90000, 120000)
    assert app["status"] == "screening"
    assert app["follow_up_date"] == "2026-03-10"


def test_create_records_initial_history_row(client, auth):
    app = create(client, auth, status="screening")
    assert [(h["from_status"], h["to_status"]) for h in app["history"]] == [(None, "screening")]


def test_create_trims_whitespace_and_blanks_become_null(client, auth):
    app = create(client, auth, company="  Acme  ", location="   ", notes="")
    assert app["company"] == "Acme"
    assert app["location"] is None and app["notes"] is None


@pytest.mark.parametrize(
    "bad",
    [
        {"company": ""},
        {"company": "   "},
        {"role": ""},
        {"status": "ghosted"},
        {"salary_min": -1},
        {"salary_min": 200, "salary_max": 100},
        {"job_url": "javascript:alert(1)"},
        {"job_url": "ftp://example.com/x"},
        {"date_applied": "not-a-date"},
    ],
)
def test_create_rejects_invalid_input(client, auth, bad):
    res = client.post("/applications", json={**BASE, **bad}, headers=auth)
    assert res.status_code == 422


def test_create_requires_login(client):
    assert client.post("/applications", json=BASE).status_code == 401


# --- read -------------------------------------------------------------------


def test_get_returns_application_with_history(client, auth):
    created = create(client, auth)
    res = client.get(f"/applications/{created['id']}", headers=auth)
    assert res.status_code == 200
    assert res.json()["id"] == created["id"]
    assert len(res.json()["history"]) == 1


def test_get_missing_is_404(client, auth):
    assert client.get("/applications/999", headers=auth).status_code == 404


# --- per-user isolation -----------------------------------------------------


def test_users_cannot_read_update_or_delete_each_others_applications(client, auth, other_auth):
    mine = create(client, auth)
    url = f"/applications/{mine['id']}"

    # Same 404 as "doesn't exist": the API doesn't reveal the id is in use.
    assert client.get(url, headers=other_auth).status_code == 404
    assert client.patch(url, json={"company": "Hacked"}, headers=other_auth).status_code == 404
    assert client.delete(url, headers=other_auth).status_code == 404

    # ...and nothing was changed or deleted.
    still = client.get(url, headers=auth).json()
    assert still["company"] == "Acme Corp"


def test_lists_only_show_own_applications(client, auth, other_auth):
    create(client, auth, company="Mine")
    create(client, other_auth, company="Theirs", follow_up_date=date.today().isoformat())

    mine = client.get("/applications", headers=auth).json()
    assert [a["company"] for a in mine["items"]] == ["Mine"]
    assert mine["total"] == 1
    assert client.get("/applications/upcoming", headers=auth).json() == []


# --- update -----------------------------------------------------------------


def test_patch_updates_only_sent_fields(client, auth):
    app = create(client, auth, location="Remote", notes="hi")
    res = client.patch(f"/applications/{app['id']}", json={"notes": "updated"}, headers=auth)
    assert res.status_code == 200
    body = res.json()
    assert body["notes"] == "updated"
    assert body["location"] == "Remote"  # untouched
    assert body["company"] == "Acme Corp"  # untouched


def test_patch_null_clears_optional_field(client, auth):
    app = create(client, auth, location="Remote")
    body = client.patch(f"/applications/{app['id']}", json={"location": None}, headers=auth).json()
    assert body["location"] is None


@pytest.mark.parametrize("field", ["company", "role", "date_applied", "status"])
def test_patch_null_on_required_field_is_rejected(client, auth, field):
    app = create(client, auth)
    res = client.patch(f"/applications/{app['id']}", json={field: None}, headers=auth)
    assert res.status_code == 422


def test_patch_salary_is_checked_against_stored_value(client, auth):
    app = create(client, auth, salary_min=50000, salary_max=60000)
    res = client.patch(f"/applications/{app['id']}", json={"salary_min": 70000}, headers=auth)
    assert res.status_code == 422


def test_patch_rejects_javascript_url(client, auth):
    app = create(client, auth)
    res = client.patch(f"/applications/{app['id']}", json={"job_url": "javascript:x"}, headers=auth)
    assert res.status_code == 422


def test_status_change_is_recorded_in_history(client, auth):
    app = create(client, auth)
    url = f"/applications/{app['id']}"
    client.patch(url, json={"status": "screening"}, headers=auth)
    body = client.patch(url, json={"status": "interview"}, headers=auth).json()
    assert body["status"] == "interview"
    assert [(h["from_status"], h["to_status"]) for h in body["history"]] == [
        (None, "applied"),
        ("applied", "screening"),
        ("screening", "interview"),
    ]


def test_same_status_or_other_edits_do_not_add_history(client, auth):
    app = create(client, auth)
    url = f"/applications/{app['id']}"
    client.patch(url, json={"status": "applied", "notes": "x"}, headers=auth)
    body = client.get(url, headers=auth).json()
    assert len(body["history"]) == 1


def test_status_can_move_backwards(client, auth):
    """Corrections are allowed, e.g. a rejection that was marked by mistake."""
    app = create(client, auth, status="rejected")
    res = client.patch(f"/applications/{app['id']}", json={"status": "interview"}, headers=auth)
    assert res.json()["status"] == "interview"


def test_patch_missing_is_404(client, auth):
    assert client.patch("/applications/999", json={"notes": "x"}, headers=auth).status_code == 404


# --- delete -----------------------------------------------------------------


def test_delete_removes_application_and_history(client, auth, db):
    app = create(client, auth)
    client.patch(f"/applications/{app['id']}", json={"status": "offer"}, headers=auth)
    assert client.delete(f"/applications/{app['id']}", headers=auth).status_code == 204
    assert client.get(f"/applications/{app['id']}", headers=auth).status_code == 404

    from app.models import StatusChange

    assert db.query(StatusChange).count() == 0


# --- list / filter / search -------------------------------------------------


@pytest.fixture
def sample(client, auth):
    create(client, auth, company="Acme", role="Backend Engineer", date_applied="2026-01-10", location="Remote")
    create(client, auth, company="Globex", role="Data Analyst", date_applied="2026-02-10", status="interview", notes="Great team")
    create(client, auth, company="Initech", role="Backend Developer", date_applied="2026-03-10", status="rejected")


def companies(client, auth, **params):
    res = client.get("/applications", params=params, headers=auth)
    assert res.status_code == 200, res.text
    return [a["company"] for a in res.json()["items"]]


def test_list_is_newest_first(client, auth, sample):
    assert companies(client, auth) == ["Initech", "Globex", "Acme"]


def test_filter_by_status(client, auth, sample):
    assert companies(client, auth, status="interview") == ["Globex"]


def test_filter_by_multiple_statuses(client, auth, sample):
    assert companies(client, auth, status=["applied", "rejected"]) == ["Initech", "Acme"]


def test_filter_by_company_is_case_insensitive_substring(client, auth, sample):
    assert companies(client, auth, company="glo") == ["Globex"]


def test_keyword_search_covers_company_role_location_notes(client, auth, sample):
    assert companies(client, auth, q="backend") == ["Initech", "Acme"]  # role
    assert companies(client, auth, q="remote") == ["Acme"]  # location
    assert companies(client, auth, q="great team") == ["Globex"]  # notes
    assert companies(client, auth, q="initech") == ["Initech"]  # company


def test_search_treats_percent_literally(client, auth, sample):
    assert companies(client, auth, q="%") == []


def test_filter_by_date_range_is_inclusive(client, auth, sample):
    assert companies(client, auth, date_from="2026-02-10", date_to="2026-03-10") == ["Initech", "Globex"]
    assert companies(client, auth, date_from="2026-02-11") == ["Initech"]


def test_filters_combine_with_and(client, auth, sample):
    assert companies(client, auth, q="backend", status="rejected") == ["Initech"]


def test_pagination_reports_total(client, auth, sample):
    res = client.get("/applications", params={"limit": 2, "offset": 2}, headers=auth).json()
    assert res["total"] == 3
    assert [a["company"] for a in res["items"]] == ["Acme"]


def test_limit_is_bounded(client, auth):
    assert client.get("/applications", params={"limit": 1000}, headers=auth).status_code == 422


# --- upcoming follow-ups ----------------------------------------------------


def days_from_now(n):
    return (date.today() + timedelta(days=n)).isoformat()


def test_upcoming_includes_overdue_and_soon_excludes_later_and_unset(client, auth):
    create(client, auth, company="Overdue", follow_up_date=days_from_now(-3))
    create(client, auth, company="Today", follow_up_date=days_from_now(0))
    create(client, auth, company="InFiveDays", follow_up_date=days_from_now(5))
    create(client, auth, company="NextMonth", follow_up_date=days_from_now(30))
    create(client, auth, company="NoDate")

    res = client.get("/applications/upcoming", headers=auth).json()
    # Soonest (most overdue) first; default window is 7 days.
    assert [a["company"] for a in res] == ["Overdue", "Today", "InFiveDays"]


def test_upcoming_days_parameter_widens_window(client, auth):
    create(client, auth, company="NextMonth", follow_up_date=days_from_now(30))
    res = client.get("/applications/upcoming", params={"days": 60}, headers=auth).json()
    assert [a["company"] for a in res] == ["NextMonth"]


def test_upcoming_excludes_closed_applications(client, auth):
    create(client, auth, company="Rejected", status="rejected", follow_up_date=days_from_now(1))
    create(client, auth, company="Withdrawn", status="withdrawn", follow_up_date=days_from_now(1))
    create(client, auth, company="Accepted", status="offer_accepted", follow_up_date=days_from_now(1))
    create(client, auth, company="Declined", status="offer_declined", follow_up_date=days_from_now(1))
    create(client, auth, company="Offer", status="offer", follow_up_date=days_from_now(1))  # awaiting your answer: still open
    res = client.get("/applications/upcoming", headers=auth).json()
    assert [a["company"] for a in res] == ["Offer"]


# --- timestamps -------------------------------------------------------------


def test_timestamps_are_utc_when_read_back_from_the_database(client, auth):
    """Regression: SQLite returns naive datetimes; the API must still say UTC.

    Without a "Z"/offset, browsers parse the value as *local* time and show the
    wrong hour. A fresh GET goes through the database, so it exercises this.
    """
    created = create(client, auth)
    client.patch(f"/applications/{created['id']}", json={"status": "offer"}, headers=auth)
    body = client.get(f"/applications/{created['id']}", headers=auth).json()

    stamps = [body["created_at"], body["updated_at"]] + [h["changed_at"] for h in body["history"]]
    assert len(stamps) == 4
    for stamp in stamps:
        assert stamp.endswith("Z") or stamp.endswith("+00:00"), stamp
