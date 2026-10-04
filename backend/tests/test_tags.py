import csv
import io

import pytest
from sqlalchemy import func, select

from app.models import Application, ApplicationTag
from app.tags import MAX_TAG_LENGTH, MAX_TAGS, normalize_tag, normalize_tags, parse_tag_cell

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


# --- the normalising -------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Dream Job", "dream job"),
        ("dream job", "dream job"),
        ("  dream   job  ", "dream job"),
        ("DREAM\tJOB", "dream job"),
        ("Referral", "referral"),
        ("Café", "café"),  # "e" + combining accent is the same tag as "é"
        ("", ""),
        ("   ", ""),
    ],
)
def test_one_tag_however_it_was_typed(raw, expected):
    assert normalize_tag(raw) == expected


def test_a_list_is_normalised_deduplicated_and_sorted():
    assert normalize_tags(["Dream Job", "dream job", " Referral ", "DREAM  JOB", "", "backup option"]) == ["backup option", "dream job", "referral"]


def test_an_empty_list_is_fine():
    assert normalize_tags([]) == []
    assert normalize_tags(["", "  "]) == []


@pytest.mark.parametrize("bad", ["a,b", "a;b", "bell\x07", "x" * (MAX_TAG_LENGTH + 1)])
def test_a_tag_that_cannot_be_stored_is_refused_with_a_reason(bad):
    with pytest.raises(ValueError):
        normalize_tags([bad])


def test_exactly_the_maximum_length_is_fine():
    assert normalize_tags(["x" * MAX_TAG_LENGTH]) == ["x" * MAX_TAG_LENGTH]


def test_the_length_is_measured_after_normalising():
    assert normalize_tags(["  " + "x" * MAX_TAG_LENGTH + "   "]) == ["x" * MAX_TAG_LENGTH]


def test_too_many_tags_are_refused_but_repeats_do_not_count():
    assert len(normalize_tags([f"t{i}" for i in range(MAX_TAGS)])) == MAX_TAGS
    with pytest.raises(ValueError, match="at most"):
        normalize_tags([f"t{i}" for i in range(MAX_TAGS + 1)])
    assert len(normalize_tags(["Same", "same", "SAME"] * 10)) == 1


def test_a_cell_is_split_on_commas_and_semicolons_and_never_raises():
    assert parse_tag_cell("Dream Job; referral, Backup Option") == (["backup option", "dream job", "referral"], [])
    assert parse_tag_cell("") == ([], [])
    assert parse_tag_cell(" ; , ;") == ([], [])


def test_a_cell_keeps_what_it_can_and_describes_what_it_drops():
    tags, problems = parse_tag_cell("ok; " + "y" * 40 + "; fine")
    assert tags == ["fine", "ok"]
    assert len(problems) == 1 and "longer than" in problems[0]
    many, problems = parse_tag_cell(";".join(f"t{i:02d}" for i in range(15)))
    assert len(many) == MAX_TAGS and "only 10 tags are kept" in problems[0]


# --- saving and reading them -------------------------------------------------------------


def test_a_new_application_has_no_tags(client, auth):
    assert create(client, auth)["tags"] == []


def test_tags_are_saved_normalised_and_sorted_and_come_back_everywhere(client, auth):
    app = create(client, auth, tags=["Referral", "Dream Job", "dream job"])
    assert app["tags"] == ["dream job", "referral"]
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["tags"] == ["dream job", "referral"]
    assert client.get("/applications", headers=auth).json()["items"][0]["tags"] == ["dream job", "referral"]


def test_an_application_can_have_several_tags(client, auth):
    app = create(client, auth, tags=[f"tag {i}" for i in range(MAX_TAGS)])
    assert len(app["tags"]) == MAX_TAGS


def test_dream_job_and_dream_job_are_the_same_tag_across_applications(client, auth):
    create(client, auth, company="A", tags=["Dream Job"])
    create(client, auth, company="B", tags=["dream  job"])
    assert client.get("/applications/tags", headers=auth).json() == [{"tag": "dream job", "count": 2}]


def test_tags_can_be_replaced_added_to_and_cleared_with_patch(client, auth):
    app = create(client, auth, tags=["a", "b"])
    assert patch(client, auth, app["id"], tags=["b", "c"]).json()["tags"] == ["b", "c"]
    assert patch(client, auth, app["id"], tags=["b", "c", "d"]).json()["tags"] == ["b", "c", "d"]
    assert patch(client, auth, app["id"], tags=[]).json()["tags"] == []


def test_patching_something_else_leaves_the_tags_alone(client, auth):
    app = create(client, auth, tags=["keep me"])
    assert patch(client, auth, app["id"], notes="called back", status="interview").json()["tags"] == ["keep me"]


def test_null_is_not_a_way_to_clear_tags(client, auth):
    app = create(client, auth, tags=["keep me"])
    assert patch(client, auth, app["id"], tags=None).status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["tags"] == ["keep me"]


@pytest.mark.parametrize("bad", [["a,b"], ["a;b"], ["x" * 31], [f"t{i}" for i in range(11)], "referral", [1, 2], [None], {"a": 1}])
def test_bad_tags_are_refused_on_create_and_edit_and_nothing_is_saved(client, auth, bad):
    assert client.post("/applications", json={**BASE, "tags": bad}, headers=auth).status_code == 422
    app = create(client, auth)
    assert patch(client, auth, app["id"], tags=bad).status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["tags"] == []


def test_a_rejected_tag_change_changes_nothing_else_in_the_request(client, auth):
    app = create(client, auth, tags=["a"])
    assert patch(client, auth, app["id"], tags=["x" * 40], notes="should not stick").status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["notes"] is None


def test_removing_a_tag_deletes_its_row_and_leaves_the_others(client, auth, db):
    app = create(client, auth, tags=["a", "b", "c"])
    patch(client, auth, app["id"], tags=["b"])
    assert [t.tag for t in db.scalars(select(ApplicationTag).where(ApplicationTag.application_id == app["id"]))] == ["b"]


def test_tags_are_removed_with_their_application(client, auth, db):
    app = create(client, auth, tags=["a", "b"])
    create(client, auth, company="Other", tags=["a"])
    client.delete(f"/applications/{app['id']}", headers=auth)
    assert db.scalar(select(func.count()).select_from(ApplicationTag)) == 1


def test_tags_are_removed_with_the_account(client, auth, db):
    create(client, auth, tags=["a", "b"])
    assert client.post("/auth/delete-account", json={"password": "correct-horse-battery"}, headers=auth).status_code == 204
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(ApplicationTag)) == 0 and db.scalar(select(func.count()).select_from(Application)) == 0


def test_archiving_and_status_changes_do_not_touch_tags(client, auth):
    app = create(client, auth, tags=["x"], status="rejected")
    assert patch(client, auth, app["id"], archived=True).json()["tags"] == ["x"]
    assert patch(client, auth, app["id"], status="applied").json()["tags"] == ["x"]


# --- the filter ---------------------------------------------------------------------------


def seed(client, auth):
    create(client, auth, company="Both", tags=["dream job", "referral"])
    create(client, auth, company="Dream only", tags=["dream job"])
    create(client, auth, company="Referral only", tags=["referral"])
    create(client, auth, company="Untagged")


def test_filter_by_a_tag(client, auth):
    seed(client, auth)
    assert companies(client, auth, tag="dream job") == ["Both", "Dream only"]
    assert companies(client, auth, tag="referral") == ["Both", "Referral only"]


def test_the_filter_ignores_case_and_spacing_like_saving_does(client, auth):
    seed(client, auth)
    assert companies(client, auth, tag="  Dream   JOB ") == ["Both", "Dream only"]


def test_several_tags_must_all_be_present(client, auth):
    seed(client, auth)
    assert companies(client, auth, tag=["dream job", "referral"]) == ["Both"]


def test_a_tag_nobody_has_is_an_empty_list_not_an_error(client, auth):
    seed(client, auth)
    res = client.get("/applications", params={"tag": "nonexistent"}, headers=auth)
    assert res.status_code == 200 and res.json() == {"items": [], "total": 0}


def test_a_blank_tag_filter_is_ignored(client, auth):
    seed(client, auth)
    assert len(companies(client, auth, tag="   ")) == 4


def test_a_tag_is_matched_whole_not_as_part_of_another(client, auth):
    create(client, auth, company="Longer", tags=["dream job later"])
    assert companies(client, auth, tag="dream job") == []


def test_the_filter_combines_with_the_others_and_total_follows_it(client, auth):
    create(client, auth, company="A", tags=["x"], status="interview")
    create(client, auth, company="B", tags=["x"], status="applied")
    create(client, auth, company="C", tags=["y"], status="interview")
    res = client.get("/applications", params={"tag": "x", "status": "interview"}, headers=auth).json()
    assert [a["company"] for a in res["items"]] == ["A"] and res["total"] == 1
    paged = client.get("/applications", params={"tag": "x", "limit": 1}, headers=auth).json()
    assert len(paged["items"]) == 1 and paged["total"] == 2


def test_it_respects_the_archived_filter_too(client, auth):
    app = create(client, auth, company="Old", tags=["x"], status="rejected")
    patch(client, auth, app["id"], archived=True)
    assert companies(client, auth, tag="x") == []
    assert companies(client, auth, tag="x", archived="include") == ["Old"]


def test_keyword_search_also_finds_tags(client, auth):
    seed(client, auth)
    assert companies(client, auth, q="dream") == ["Both", "Dream only"]  # "Dream only" is a company name too
    create(client, auth, company="Quiet Co", tags=["backup option"])
    assert companies(client, auth, q="backup") == ["Quiet Co"]


def test_the_filter_never_shows_another_users_applications(client, auth, other_auth):
    create(client, other_auth, company="Theirs", tags=["x"])
    create(client, auth, company="Mine", tags=["x"])
    assert companies(client, auth, tag="x") == ["Mine"]


# --- the list of a user's tags -------------------------------------------------------------


def test_the_tag_list_needs_a_login(client):
    assert client.get("/applications/tags").status_code == 401


def test_the_tag_list_has_counts_sorted_by_name(client, auth):
    seed(client, auth)
    assert client.get("/applications/tags", headers=auth).json() == [{"tag": "dream job", "count": 2}, {"tag": "referral", "count": 2}]


def test_the_tag_list_is_empty_with_no_tags(client, auth):
    create(client, auth)
    assert client.get("/applications/tags", headers=auth).json() == []


def test_the_tag_list_is_only_your_own(client, auth, other_auth):
    create(client, other_auth, tags=["theirs"])
    create(client, auth, tags=["mine"])
    assert client.get("/applications/tags", headers=auth).json() == [{"tag": "mine", "count": 1}]


def test_the_tag_list_counts_archived_applications_so_nothing_disappears_from_the_filter(client, auth):
    app = create(client, auth, tags=["x"], status="rejected")
    patch(client, auth, app["id"], archived=True)
    assert client.get("/applications/tags", headers=auth).json() == [{"tag": "x", "count": 1}]


# --- export and import ------------------------------------------------------------------------


def export_rows(client, auth):
    text = client.get("/applications/export.csv", headers=auth).text.lstrip("﻿")
    return {r["Company"]: r for r in csv.DictReader(io.StringIO(text))}


def test_the_export_has_a_tags_column(client, auth):
    seed(client, auth)
    rows = export_rows(client, auth)
    assert rows["Both"]["Tags"] == "dream job; referral"
    assert rows["Dream only"]["Tags"] == "dream job"
    assert rows["Untagged"]["Tags"] == ""


def do_import(client, auth, data: bytes, **params):
    res = client.post("/applications/import", content=data, params=params, headers={**auth, "Content-Type": "text/csv"})
    assert res.status_code == 200, res.text
    return res.json()


def test_exporting_then_importing_reproduces_every_tag(client, auth):
    from tests.conftest import make_user

    seed(client, auth)
    fresh = make_user(client, email="fresh@example.com")
    do_import(client, fresh, client.get("/applications/export.csv", headers=auth).content)
    got = {a["company"]: a["tags"] for a in client.get("/applications", params={"limit": 50}, headers=fresh).json()["items"]}
    assert got == {"Both": ["dream job", "referral"], "Dream only": ["dream job"], "Referral only": ["referral"], "Untagged": []}


def test_a_hand_made_tags_cell_is_split_normalised_and_deduplicated(client, auth):
    data = b"Company,Role,Tags\r\nAcme,Eng,\"Dream Job, referral; DREAM job\"\r\nGlobex,Eng,\r\n"
    result = do_import(client, auth, data)
    assert [n for n in result["adjusted"] if "dated today" not in n["reason"]] == []  # nothing to complain about
    got = {a["company"]: a["tags"] for a in client.get("/applications", headers=auth).json()["items"]}
    assert got == {"Acme": ["dream job", "referral"], "Globex": []}


def test_a_labels_column_is_understood_too(client, auth):
    do_import(client, auth, b"Company,Role,Labels\r\nAcme,Eng,hot\r\n")
    assert client.get("/applications", headers=auth).json()["items"][0]["tags"] == ["hot"]


def test_a_bad_tag_in_an_import_is_dropped_and_reported_but_the_row_is_kept(client, auth):
    data = f"Company,Role,Tags\r\nAcme,Eng,ok; {'z' * 40}\r\n".encode()
    result = do_import(client, auth, data)
    assert result["added"] == 1
    assert any("longer than" in n["reason"] for n in result["adjusted"])
    assert client.get("/applications", headers=auth).json()["items"][0]["tags"] == ["ok"]


def test_a_tag_that_starts_with_a_formula_character_survives_the_round_trip(client, auth):
    from tests.conftest import make_user

    create(client, auth, tags=["=hot", "+one", "regular"])
    assert export_rows(client, auth)["Acme Corp"]["Tags"].startswith("'+one")  # neutralised for the spreadsheet
    fresh = make_user(client, email="fresh@example.com")
    do_import(client, fresh, client.get("/applications/export.csv", headers=auth).content)
    (restored,) = client.get("/applications", headers=fresh).json()["items"]
    assert restored["tags"] == ["+one", "=hot", "regular"]
