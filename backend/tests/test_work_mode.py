import csv
import io

import pytest

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def companies(client, auth, **params):
    res = client.get("/applications", params=params, headers=auth)
    assert res.status_code == 200, res.text
    return sorted(a["company"] for a in res.json()["items"])


def seed(client, auth):
    create(client, auth, company="Remote Co", work_mode="remote")
    create(client, auth, company="Hybrid Co", work_mode="hybrid")
    create(client, auth, company="Office Co", work_mode="in_person")
    create(client, auth, company="Unsure Co")  # not specified


# --- storing it --------------------------------------------------------------


def test_it_defaults_to_not_specified_rather_than_forcing_a_guess(client, auth):
    app = create(client, auth)
    assert app["work_mode"] is None
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["work_mode"] is None


@pytest.mark.parametrize("mode", ["remote", "hybrid", "in_person"])
def test_each_mode_persists_and_comes_back_on_read_list_and_detail(client, auth, mode):
    app = create(client, auth, work_mode=mode)
    assert app["work_mode"] == mode
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["work_mode"] == mode
    assert client.get("/applications", headers=auth).json()["items"][0]["work_mode"] == mode


def test_it_can_be_set_changed_and_cleared_with_patch(client, auth):
    app = create(client, auth)
    url = f"/applications/{app['id']}"
    assert client.patch(url, json={"work_mode": "hybrid"}, headers=auth).json()["work_mode"] == "hybrid"
    assert client.patch(url, json={"work_mode": "remote"}, headers=auth).json()["work_mode"] == "remote"
    assert client.patch(url, json={"work_mode": None}, headers=auth).json()["work_mode"] is None  # back to unset


def test_patching_something_else_leaves_it_alone(client, auth):
    app = create(client, auth, work_mode="hybrid")
    res = client.patch(f"/applications/{app['id']}", json={"notes": "called back"}, headers=auth)
    assert res.json()["work_mode"] == "hybrid"


@pytest.mark.parametrize("bad", ["onsite", "REMOTE", "in-person", "", 3, True])
def test_an_unknown_value_is_refused(client, auth, bad):
    res = client.post("/applications", json={**BASE, "work_mode": bad}, headers=auth)
    assert res.status_code == 422
    app = create(client, auth)
    assert client.patch(f"/applications/{app['id']}", json={"work_mode": bad}, headers=auth).status_code == 422


def test_it_is_independent_of_the_free_text_location(client, auth):
    app = create(client, auth, location="Portland, OR", work_mode="hybrid")
    assert (app["location"], app["work_mode"]) == ("Portland, OR", "hybrid")


# --- filtering ---------------------------------------------------------------


def test_filter_by_one_mode(client, auth):
    seed(client, auth)
    assert companies(client, auth, work_mode="remote") == ["Remote Co"]
    assert companies(client, auth, work_mode="in_person") == ["Office Co"]


def test_filter_by_several_modes_at_once(client, auth):
    seed(client, auth)
    assert companies(client, auth, work_mode=["remote", "hybrid"]) == ["Hybrid Co", "Remote Co"]


def test_no_filter_returns_everything_including_unspecified(client, auth):
    seed(client, auth)
    assert len(companies(client, auth)) == 4


def test_a_filtered_mode_excludes_unspecified_applications(client, auth):
    seed(client, auth)
    assert "Unsure Co" not in companies(client, auth, work_mode=["remote", "hybrid", "in_person"])


def test_filter_with_no_match_is_an_empty_page_not_an_error(client, auth):
    create(client, auth, work_mode="remote")
    res = client.get("/applications", params={"work_mode": "hybrid"}, headers=auth)
    assert res.status_code == 200 and res.json() == {"items": [], "total": 0}


def test_an_invalid_filter_value_is_refused(client, auth):
    assert client.get("/applications", params={"work_mode": "onsite"}, headers=auth).status_code == 422


def test_the_filter_combines_with_the_others_and_total_counts_the_filtered_set(client, auth):
    create(client, auth, company="Alpha Remote", work_mode="remote", status="interview")
    create(client, auth, company="Beta Remote", work_mode="remote", status="applied")
    create(client, auth, company="Gamma Hybrid", work_mode="hybrid", status="interview")
    res = client.get("/applications", params={"work_mode": "remote", "status": "interview"}, headers=auth).json()
    assert [a["company"] for a in res["items"]] == ["Alpha Remote"]
    assert res["total"] == 1
    paged = client.get("/applications", params={"work_mode": "remote", "limit": 1}, headers=auth).json()
    assert len(paged["items"]) == 1 and paged["total"] == 2  # total ignores paging, not the filter


def test_the_filter_never_shows_another_users_applications(client, auth, other_auth):
    create(client, other_auth, company="Theirs", work_mode="remote")
    create(client, auth, company="Mine", work_mode="remote")
    assert companies(client, auth, work_mode="remote") == ["Mine"]


# --- export ------------------------------------------------------------------


def test_the_csv_export_has_a_work_mode_column(client, auth):
    create(client, auth, company="A", work_mode="in_person")
    create(client, auth, company="B")
    res = client.get("/applications/export.csv", headers=auth)
    rows = {r["Company"]: r for r in csv.DictReader(io.StringIO(res.text.lstrip("﻿")))}
    assert rows["A"]["Work mode"] == "in_person"
    assert rows["B"]["Work mode"] == ""
