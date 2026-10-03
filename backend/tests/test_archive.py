import csv
import io
from datetime import date, timedelta

import pytest

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def patch(client, auth, app_id, **fields):
    return client.patch(f"/applications/{app_id}", json=fields, headers=auth)


def companies(client, auth, **params):
    res = client.get("/applications", params={"limit": 200, **params}, headers=auth)
    assert res.status_code == 200, res.text
    return sorted(a["company"] for a in res.json()["items"])


def stats(client, auth, **params):
    return client.get("/stats", params=params, headers=auth).json()


def archive(client, auth, app_id):
    res = patch(client, auth, app_id, archived=True)
    assert res.status_code == 200, res.text
    return res.json()


# --- archiving and bringing back --------------------------------------------------


def test_a_new_application_is_not_archived(client, auth):
    app = create(client, auth)
    assert (app["archived"], app["archived_at"]) == (False, None)


def test_archiving_marks_it_and_records_when(client, auth):
    app = create(client, auth, status="rejected")
    done = archive(client, auth, app["id"])
    assert done["archived"] is True and done["archived_at"] is not None
    got = client.get(f"/applications/{app['id']}", headers=auth).json()
    assert (got["archived"], got["archived_at"]) == (True, done["archived_at"])


def test_unarchiving_brings_it_back(client, auth):
    app = create(client, auth)
    archive(client, auth, app["id"])
    back = patch(client, auth, app["id"], archived=False).json()
    assert (back["archived"], back["archived_at"]) == (False, None)


def test_archiving_twice_keeps_the_first_time(client, auth):
    app = create(client, auth)
    first = archive(client, auth, app["id"])["archived_at"]
    assert archive(client, auth, app["id"])["archived_at"] == first


def test_unarchiving_something_not_archived_is_harmless(client, auth):
    app = create(client, auth)
    assert patch(client, auth, app["id"], archived=False).json()["archived"] is False


def test_null_is_not_a_way_to_archive_or_unarchive(client, auth):
    app = create(client, auth)
    assert patch(client, auth, app["id"], archived=None).status_code == 422


@pytest.mark.parametrize("bad", ["yes", "true", 1, 0, "false"])
def test_only_a_real_boolean_is_accepted(client, auth, bad):
    app = create(client, auth)
    assert patch(client, auth, app["id"], archived=bad).status_code == 422  # a stray "yes" must not hide anything
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["archived"] is False


def test_it_works_on_any_status(client, auth):
    for status in ("saved", "applied", "interview", "offer", "offer_accepted", "offer_declined", "rejected", "withdrawn"):
        app = create(client, auth, status=status, company=status)
        assert archive(client, auth, app["id"])["archived"] is True


def test_another_users_application_cannot_be_archived(client, auth, other_auth):
    theirs = create(client, other_auth)
    assert patch(client, auth, theirs["id"], archived=True).status_code == 404
    assert client.get(f"/applications/{theirs['id']}", headers=other_auth).json()["archived"] is False


# --- the lists --------------------------------------------------------------------


def test_archived_applications_are_left_out_of_the_default_list(client, auth):
    create(client, auth, company="Active")
    old = create(client, auth, company="Old rejection", status="rejected")
    archive(client, auth, old["id"])
    assert companies(client, auth) == ["Active"]
    res = client.get("/applications", headers=auth).json()
    assert res["total"] == 1  # the count follows what is shown, so paging stays right


def test_the_filter_can_include_or_show_only_archived(client, auth):
    create(client, auth, company="Active")
    old = create(client, auth, company="Old", status="rejected")
    archive(client, auth, old["id"])
    assert companies(client, auth, archived="hide") == ["Active"]
    assert companies(client, auth, archived="include") == ["Active", "Old"]
    assert companies(client, auth, archived="only") == ["Old"]


def test_an_unknown_archived_value_is_refused(client, auth):
    assert client.get("/applications", params={"archived": "maybe"}, headers=auth).status_code == 422


def test_unarchiving_returns_it_to_the_default_list(client, auth):
    app = create(client, auth, company="Back again")
    archive(client, auth, app["id"])
    assert companies(client, auth) == []
    patch(client, auth, app["id"], archived=False)
    assert companies(client, auth) == ["Back again"]


def test_the_other_filters_still_apply_to_archived_ones(client, auth):
    a = create(client, auth, company="Alpha", status="rejected")
    b = create(client, auth, company="Beta", status="withdrawn")
    archive(client, auth, a["id"])
    archive(client, auth, b["id"])
    assert companies(client, auth, archived="only", status="rejected") == ["Alpha"]
    assert companies(client, auth, archived="include", q="beta") == ["Beta"]


def test_a_single_archived_application_can_still_be_opened_by_its_link(client, auth):
    app = create(client, auth)
    archive(client, auth, app["id"])
    assert client.get(f"/applications/{app['id']}", headers=auth).status_code == 200


def test_archived_applications_stay_out_of_the_follow_up_reminders(client, auth):
    soon = (date.today() + timedelta(days=1)).isoformat()
    keep = create(client, auth, company="Visible", follow_up_date=soon)
    gone = create(client, auth, company="Archived", follow_up_date=soon)
    archive(client, auth, gone["id"])
    assert [a["company"] for a in client.get("/applications/upcoming", headers=auth).json()] == ["Visible"]
    assert keep["archived"] is False


# --- a view preference, not a deletion: figures and export are unchanged ----------


def test_archiving_does_not_change_any_dashboard_figure(client, auth):
    today = date.today()
    ids = [
        create(client, auth, company="A", status="rejected", date_applied=(today - timedelta(days=60)).isoformat())["id"],
        create(client, auth, company="B", status="interview", date_applied=(today - timedelta(days=45)).isoformat())["id"],
        create(client, auth, company="C", status="applied", date_applied=(today - timedelta(days=40)).isoformat())["id"],
        create(client, auth, company="D", status="withdrawn", date_applied=today.isoformat())["id"],
    ]
    before = stats(client, auth), stats(client, auth, weeks=4)
    for app_id in ids:
        archive(client, auth, app_id)
    assert companies(client, auth) == []  # everything is hidden from the list...
    assert (stats(client, auth), stats(client, auth, weeks=4)) == before  # ...and not one number moved
    assert before[0]["total"] == 4 and before[0]["response"]["responded"] == 2


def test_the_response_rate_and_no_reply_count_still_include_archived(client, auth):
    old = (date.today() - timedelta(days=90)).isoformat()
    unanswered = create(client, auth, company="Quiet", status="applied", date_applied=old)
    answered = create(client, auth, company="Replied", status="rejected", date_applied=old)
    archive(client, auth, unanswered["id"])
    archive(client, auth, answered["id"])
    body = stats(client, auth)
    assert body["response"] == {"responded": 1, "eligible": 2, "rate": 0.5}
    assert body["no_reply"]["count"] == 1


def export_rows(client, auth):
    text = client.get("/applications/export.csv", headers=auth).text.lstrip("﻿")
    return {r["Company"]: r for r in csv.DictReader(io.StringIO(text))}


def test_the_export_includes_archived_applications_and_says_when(client, auth):
    create(client, auth, company="Active")
    old = create(client, auth, company="Old", status="rejected")
    archive(client, auth, old["id"])
    rows = export_rows(client, auth)
    assert set(rows) == {"Active", "Old"}
    assert rows["Active"]["Archived"] == ""
    assert rows["Old"]["Archived"] == date.today().isoformat()


def test_duplicates_still_see_archived_applications(client, auth):
    app = create(client, auth)
    archive(client, auth, app["id"])
    found = client.get("/applications/duplicates", params={"company": "Acme Corp", "role": "Backend Engineer"}, headers=auth).json()
    assert [d["id"] for d in found] == [app["id"]]


# --- archived state survives everything else ---------------------------------------


@pytest.mark.parametrize(
    "change",
    [
        {"status": "interview"},
        {"status": "applied"},
        {"status": "saved"},
        {"notes": "called back"},
        {"company": "Renamed", "role": "Other"},
        {"follow_up_date": "2030-01-01"},
        {"work_mode": "remote"},
        {"interview_round": 2},
        {"salary_min": 1, "salary_max": 2},
        {"city_id": None, "country_id": None, "location": "Nowhere"},
    ],
)
def test_other_edits_never_unarchive(client, auth, change):
    app = create(client, auth, status="rejected", date_applied="2026-03-01")
    first = archive(client, auth, app["id"])["archived_at"]
    res = patch(client, auth, app["id"], **change)
    assert res.status_code == 200, res.text
    assert (res.json()["archived"], res.json()["archived_at"]) == (True, first)


def test_a_status_change_and_an_unarchive_in_one_request_both_happen(client, auth):
    app = create(client, auth, status="rejected")
    archive(client, auth, app["id"])
    res = patch(client, auth, app["id"], status="applied", archived=False).json()
    assert (res["status"], res["archived"]) == ("applied", False)


def test_moving_an_archived_application_does_not_resurface_it(client, auth):
    app = create(client, auth, status="rejected")
    archive(client, auth, app["id"])
    patch(client, auth, app["id"], status="withdrawn")
    assert companies(client, auth) == []


def test_archiving_leaves_the_status_history_alone(client, auth):
    app = create(client, auth, status="interview")
    res = archive(client, auth, app["id"])
    assert [h["to_status"] for h in res["history"]] == ["interview"]


# --- import brings the archive state back ------------------------------------------


def do_import(client, auth, data: bytes):
    res = client.post("/applications/import", content=data, headers={**auth, "Content-Type": "text/csv"})
    assert res.status_code == 200, res.text
    return res.json()


def test_exporting_then_importing_restores_what_was_archived(client, auth):
    from tests.conftest import make_user

    create(client, auth, company="Active")
    old = create(client, auth, company="Old", status="rejected")
    archive(client, auth, old["id"])
    fresh = make_user(client, email="fresh@example.com")
    assert do_import(client, fresh, client.get("/applications/export.csv", headers=auth).content)["added"] == 2
    assert companies(client, fresh) == ["Active"]
    assert companies(client, fresh, archived="only") == ["Old"]
    assert export_rows(client, fresh)["Old"]["Archived"] == date.today().isoformat()


@pytest.mark.parametrize("cell,archived", [("2026-02-03", True), ("yes", True), ("TRUE", True), ("", False), ("no", False), ("maybe", False)])
def test_an_archived_column_in_a_hand_made_file(client, auth, cell, archived):
    data = f"Company,Role,Archived\r\nAcme,Engineer,{cell}\r\n".encode()
    do_import(client, auth, data)
    (app,) = client.get("/applications", params={"archived": "include"}, headers=auth).json()["items"]
    assert app["archived"] is archived
    if cell == "2026-02-03":
        assert app["archived_at"].startswith("2026-02-03")
