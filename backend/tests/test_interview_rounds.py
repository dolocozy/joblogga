import csv
import io

import pytest

from tests.test_stats import add, first_id, move, stats

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def patch(client, auth, app_id, **fields):
    return client.patch(f"/applications/{app_id}", json=fields, headers=auth)


# --- storing it --------------------------------------------------------------


def test_it_defaults_to_nothing_recorded(client, auth):
    app = create(client, auth)
    assert (app["interview_round"], app["interview_rounds_total"]) == (None, None)


def test_round_and_total_persist_and_come_back_on_read_list_and_detail(client, auth):
    app = create(client, auth, status="interview", interview_round=2, interview_rounds_total=3)
    assert (app["interview_round"], app["interview_rounds_total"]) == (2, 3)
    detail = client.get(f"/applications/{app['id']}", headers=auth).json()
    listed = client.get("/applications", headers=auth).json()["items"][0]
    for row in (detail, listed):
        assert (row["interview_round"], row["interview_rounds_total"]) == (2, 3)


def test_either_can_be_given_alone(client, auth):
    only_round = create(client, auth, interview_round=2)
    only_total = create(client, auth, interview_rounds_total=4)
    assert (only_round["interview_round"], only_round["interview_rounds_total"]) == (2, None)
    assert (only_total["interview_round"], only_total["interview_rounds_total"]) == (None, 4)


def test_they_can_be_changed_advanced_and_cleared_with_patch(client, auth):
    app = create(client, auth, status="interview", interview_round=1, interview_rounds_total=3)
    url_id = app["id"]
    assert patch(client, auth, url_id, interview_round=2).json()["interview_round"] == 2
    assert patch(client, auth, url_id, interview_rounds_total=None).json()["interview_rounds_total"] is None
    cleared = patch(client, auth, url_id, interview_round=None).json()
    assert (cleared["interview_round"], cleared["interview_rounds_total"]) == (None, None)


def test_patching_something_else_leaves_them_alone(client, auth):
    app = create(client, auth, interview_round=2, interview_rounds_total=3)
    res = patch(client, auth, app["id"], notes="went well")
    assert (res.json()["interview_round"], res.json()["interview_rounds_total"]) == (2, 3)


# --- validation --------------------------------------------------------------


@pytest.mark.parametrize("bad", [0, -1, 51, 2.5, "two", True])
def test_a_round_must_be_a_whole_number_from_1_to_50(client, auth, bad):
    for field in ("interview_round", "interview_rounds_total"):
        assert client.post("/applications", json={**BASE, field: bad}, headers=auth).status_code == 422, (field, bad)
        app = create(client, auth)
        assert patch(client, auth, app["id"], **{field: bad}).status_code == 422, (field, bad)


def test_the_round_cannot_be_past_the_total(client, auth):
    res = client.post("/applications", json={**BASE, "interview_round": 4, "interview_rounds_total": 3}, headers=auth)
    assert res.status_code == 422
    assert "interview_round" in res.text


def test_the_round_may_equal_the_total(client, auth):
    assert create(client, auth, interview_round=3, interview_rounds_total=3)["interview_round"] == 3


def test_patching_checks_against_the_stored_value_not_only_what_was_sent(client, auth):
    app = create(client, auth, interview_round=2, interview_rounds_total=3)
    assert patch(client, auth, app["id"], interview_round=4).status_code == 422  # past the stored total
    assert patch(client, auth, app["id"], interview_rounds_total=1).status_code == 422  # below the stored round
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["interview_round"] == 2  # nothing changed
    assert patch(client, auth, app["id"], interview_round=3).status_code == 200


def test_a_rejected_edit_changes_nothing_else_in_the_same_request(client, auth):
    app = create(client, auth, interview_round=2, interview_rounds_total=3)
    assert patch(client, auth, app["id"], interview_round=9, notes="should not stick").status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["notes"] is None


# --- they are a record, not a rule -------------------------------------------


@pytest.mark.parametrize("later", ["offer", "offer_accepted", "offer_declined", "rejected", "withdrawn", "applied"])
def test_they_keep_their_last_values_when_the_status_moves_on(client, auth, later):
    app = create(client, auth, status="interview", interview_round=2, interview_rounds_total=3)
    res = patch(client, auth, app["id"], status=later)
    assert (res.json()["interview_round"], res.json()["interview_rounds_total"]) == (2, 3)


def test_they_can_be_recorded_at_any_status(client, auth):
    assert create(client, auth, status="rejected", interview_round=2)["interview_round"] == 2


def test_they_do_not_change_the_response_rate_or_any_stat(client, auth):
    add(client, auth, "applied")
    add(client, auth, "interview")
    before = stats(client, auth)
    for app in client.get("/applications", headers=auth).json()["items"]:
        patch(client, auth, app["id"], interview_round=2, interview_rounds_total=5)
    assert stats(client, auth) == before


def test_a_round_alone_does_not_make_an_application_count_as_responded(client, auth):
    """Only the status history decides that: a round number on an Applied job is not a reply."""
    add(client, auth, "applied")
    patch(client, auth, first_id(client, auth), interview_round=1)
    assert stats(client, auth)["response"] == {"responded": 0, "eligible": 1, "rate": 0.0}


def test_the_status_history_is_unaffected_by_round_changes(client, auth):
    app = create(client, auth, status="interview")
    res = patch(client, auth, app["id"], interview_round=2)
    assert [h["to_status"] for h in res.json()["history"]] == ["interview"]
    move(client, auth, app["id"], "offer")
    assert [h["to_status"] for h in client.get(f"/applications/{app['id']}", headers=auth).json()["history"]] == ["interview", "offer"]


def test_another_users_application_is_not_reachable_to_change_rounds(client, auth, other_auth):
    theirs = create(client, other_auth, interview_round=1)
    assert patch(client, auth, theirs["id"], interview_round=2).status_code == 404


# --- export ------------------------------------------------------------------


def test_the_csv_export_has_both_columns(client, auth):
    create(client, auth, company="A", interview_round=2, interview_rounds_total=3)
    create(client, auth, company="B")
    rows = {r["Company"]: r for r in csv.DictReader(io.StringIO(client.get("/applications/export.csv", headers=auth).text.lstrip("﻿")))}
    assert (rows["A"]["Interview round"], rows["A"]["Interview rounds total"]) == ("2", "3")
    assert (rows["B"]["Interview round"], rows["B"]["Interview rounds total"]) == ("", "")
