import csv
import io

import pytest
from sqlalchemy import func, select

from app.contacts import MAX_CONTACTS, contact_line, parse_contacts_cell
from app.models import ApplicationContact

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def add(client, auth, app_id, **fields):
    return client.post(f"/applications/{app_id}/contacts", json={"name": "Jane Doe", **fields}, headers=auth)


def detail(client, auth, app_id):
    return client.get(f"/applications/{app_id}", headers=auth).json()


# --- the CSV line format ----------------------------------------------------------------


@pytest.mark.parametrize(
    "fields,line",
    [
        (("Jane Doe", "Recruiter", "jane@acme.com", "https://linkedin.com/in/jane"), "Jane Doe | Recruiter | jane@acme.com | https://linkedin.com/in/jane"),
        (("Jane Doe", None, None, None), "Jane Doe"),
        (("Jane Doe", "Recruiter", None, None), "Jane Doe | Recruiter"),
        (("Jane Doe", None, "jane@acme.com", None), "Jane Doe |  | jane@acme.com"),  # an empty title keeps its place
        (("Jane Doe", None, None, "https://linkedin.com/in/jane"), "Jane Doe |  |  | https://linkedin.com/in/jane"),
    ],
)
def test_a_contact_is_one_positional_line(fields, line):
    assert contact_line(*fields) == line


def test_reading_a_cell_gives_back_what_was_written():
    cell = "\n".join(
        [contact_line("Jane Doe", "Recruiter", "jane@acme.com", None), contact_line("Sam Lee", None, None, "https://linkedin.com/in/sam")]
    )
    assert parse_contacts_cell(cell) == [("Jane Doe", "Recruiter", "jane@acme.com", ""), ("Sam Lee", "", "", "https://linkedin.com/in/sam")]


def test_reading_is_forgiving_about_spacing_blank_lines_and_line_endings():
    assert parse_contacts_cell("Jane|Recruiter\r\n\r\n  Sam  |  |  s@x.co  \n") == [("Jane", "Recruiter", "", ""), ("Sam", "", "s@x.co", "")]
    assert parse_contacts_cell("") == [] and parse_contacts_cell("  \n \n") == []


# --- adding, reading, changing, removing ---------------------------------------------------


def test_a_new_application_has_no_contacts(client, auth):
    assert create(client, auth)["contacts"] == []


def test_adding_a_contact_with_everything(client, auth):
    app = create(client, auth)
    res = add(client, auth, app["id"], title="Recruiter", email="jane@acme.com", linkedin_url="https://linkedin.com/in/jane")
    assert res.status_code == 201
    assert res.json() == {"id": res.json()["id"], "name": "Jane Doe", "title": "Recruiter", "email": "jane@acme.com", "linkedin_url": "https://linkedin.com/in/jane"}


def test_only_a_name_is_needed(client, auth):
    app = create(client, auth)
    got = add(client, auth, app["id"]).json()
    assert (got["title"], got["email"], got["linkedin_url"]) == (None, None, None)


def test_blank_optional_fields_become_empty_and_text_is_trimmed(client, auth):
    app = create(client, auth)
    got = client.post(f"/applications/{app['id']}/contacts", json={"name": "  Jane Doe  ", "title": "  ", "email": "", "linkedin_url": "   "}, headers=auth).json()
    assert got == {"id": got["id"], "name": "Jane Doe", "title": None, "email": None, "linkedin_url": None}


def test_an_application_can_have_several_contacts_which_the_detail_lists_in_the_order_added(client, auth):
    app = create(client, auth)
    add(client, auth, app["id"], name="Jane Doe", title="Recruiter")
    add(client, auth, app["id"], name="Sam Lee", title="Hiring manager")
    assert [(c["name"], c["title"]) for c in detail(client, auth, app["id"])["contacts"]] == [("Jane Doe", "Recruiter"), ("Sam Lee", "Hiring manager")]


def test_contacts_are_in_the_detail_but_not_the_list(client, auth):
    app = create(client, auth)
    add(client, auth, app["id"])
    assert "contacts" not in client.get("/applications", headers=auth).json()["items"][0]
    assert len(detail(client, auth, app["id"])["contacts"]) == 1


def test_the_application_update_response_includes_the_contacts_too(client, auth):
    app = create(client, auth)
    add(client, auth, app["id"])
    res = client.patch(f"/applications/{app['id']}", json={"notes": "x"}, headers=auth)
    assert len(res.json()["contacts"]) == 1


def test_editing_a_contact_changes_only_what_was_sent(client, auth):
    app = create(client, auth)
    contact = add(client, auth, app["id"], title="Recruiter", email="jane@acme.com").json()
    res = client.patch(f"/applications/{app['id']}/contacts/{contact['id']}", json={"title": "Hiring manager"}, headers=auth)
    assert res.status_code == 200
    assert (res.json()["name"], res.json()["title"], res.json()["email"]) == ("Jane Doe", "Hiring manager", "jane@acme.com")


def test_null_clears_an_optional_field_but_never_the_name(client, auth):
    app = create(client, auth)
    contact = add(client, auth, app["id"], title="Recruiter").json()
    url = f"/applications/{app['id']}/contacts/{contact['id']}"
    assert client.patch(url, json={"title": None}, headers=auth).json()["title"] is None
    assert client.patch(url, json={"name": None}, headers=auth).status_code == 422
    assert client.patch(url, json={"name": "   "}, headers=auth).status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["contacts"][0]["name"] == "Jane Doe"


def test_removing_a_contact_leaves_the_others(client, auth):
    app = create(client, auth)
    a = add(client, auth, app["id"], name="Jane").json()
    add(client, auth, app["id"], name="Sam")
    assert client.delete(f"/applications/{app['id']}/contacts/{a['id']}", headers=auth).status_code == 204
    assert [c["name"] for c in detail(client, auth, app["id"])["contacts"]] == ["Sam"]


def test_editing_a_contact_does_not_touch_the_application(client, auth):
    app = create(client, auth, notes="keep")
    contact = add(client, auth, app["id"]).json()
    client.patch(f"/applications/{app['id']}/contacts/{contact['id']}", json={"name": "New"}, headers=auth)
    got = detail(client, auth, app["id"])
    assert (got["notes"], got["status"], got["updated_at"]) == ("keep", app["status"], app["updated_at"])


# --- validation ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "field,value",
    [
        ("email", "not-an-email"),
        ("email", "a@b"),
        ("linkedin_url", "linkedin.com/in/jane"),
        ("linkedin_url", "javascript:alert(1)"),
        ("linkedin_url", "ftp://x.example"),
        ("name", ""),
        ("name", "x" * 201),
        ("title", "x" * 101),
        ("name", "Jane | Doe"),
        ("title", "line one\nline two"),
        ("email", "a|b@example.com"),
        ("linkedin_url", "https://x.example/a|b"),
    ],
)
def test_bad_values_are_refused_with_a_reason_and_nothing_is_saved(client, auth, db, field, value):
    app = create(client, auth)
    res = client.post(f"/applications/{app['id']}/contacts", json={"name": "Jane", field: value}, headers=auth) if field != "name" else client.post(f"/applications/{app['id']}/contacts", json={"name": value}, headers=auth)
    assert res.status_code == 422
    assert db.scalar(select(func.count()).select_from(ApplicationContact)) == 0


def test_the_email_message_is_the_servers_own(client, auth):
    app = create(client, auth)
    res = add(client, auth, app["id"], email="not-an-email")
    assert res.status_code == 422 and "email" in res.text.lower()


def test_a_missing_name_is_refused(client, auth):
    app = create(client, auth)
    assert client.post(f"/applications/{app['id']}/contacts", json={"title": "Recruiter"}, headers=auth).status_code == 422


def test_a_bad_value_on_edit_is_refused_and_leaves_the_contact_as_it_was(client, auth):
    app = create(client, auth)
    contact = add(client, auth, app["id"], email="jane@acme.com").json()
    assert client.patch(f"/applications/{app['id']}/contacts/{contact['id']}", json={"email": "nope"}, headers=auth).status_code == 422
    assert detail(client, auth, app["id"])["contacts"][0]["email"] == "jane@acme.com"


def test_the_limit_is_ten_contacts_per_application_and_applies_per_application(client, auth):
    app, other = create(client, auth), create(client, auth, company="Other")
    for i in range(MAX_CONTACTS):
        assert add(client, auth, app["id"], name=f"Person {i}").status_code == 201
    res = add(client, auth, app["id"], name="One too many")
    assert res.status_code == 422 and "at most 10 contacts" in res.json()["detail"]
    assert add(client, auth, other["id"]).status_code == 201


# --- ownership --------------------------------------------------------------------------------


def test_every_contact_route_needs_a_login(client, auth):
    app = create(client, auth)
    contact = add(client, auth, app["id"]).json()
    assert client.post(f"/applications/{app['id']}/contacts", json={"name": "x"}).status_code == 401
    assert client.patch(f"/applications/{app['id']}/contacts/{contact['id']}", json={"name": "x"}).status_code == 401
    assert client.delete(f"/applications/{app['id']}/contacts/{contact['id']}").status_code == 401


def test_another_users_application_and_its_contacts_are_not_reachable(client, auth, other_auth):
    theirs = create(client, other_auth)
    contact = add(client, other_auth, theirs["id"]).json()
    assert add(client, auth, theirs["id"]).status_code == 404
    assert client.patch(f"/applications/{theirs['id']}/contacts/{contact['id']}", json={"name": "x"}, headers=auth).status_code == 404
    assert client.delete(f"/applications/{theirs['id']}/contacts/{contact['id']}", headers=auth).status_code == 404
    assert detail(client, other_auth, theirs["id"])["contacts"][0]["name"] == "Jane Doe"  # untouched


def test_a_contact_cannot_be_reached_through_a_different_application_of_your_own(client, auth):
    a, b = create(client, auth, company="A"), create(client, auth, company="B")
    contact = add(client, auth, a["id"]).json()
    assert client.patch(f"/applications/{b['id']}/contacts/{contact['id']}", json={"name": "x"}, headers=auth).status_code == 404
    assert client.delete(f"/applications/{b['id']}/contacts/{contact['id']}", headers=auth).status_code == 404
    assert len(detail(client, auth, a["id"])["contacts"]) == 1


def test_a_missing_contact_is_a_404(client, auth):
    app = create(client, auth)
    assert client.patch(f"/applications/{app['id']}/contacts/9999", json={"name": "x"}, headers=auth).status_code == 404
    assert client.delete(f"/applications/{app['id']}/contacts/9999", headers=auth).status_code == 404


# --- deleting things --------------------------------------------------------------------------


def test_deleting_an_application_deletes_its_contacts_and_only_its_own(client, auth, db):
    a, b = create(client, auth, company="A"), create(client, auth, company="B")
    add(client, auth, a["id"], name="One")
    add(client, auth, a["id"], name="Two")
    add(client, auth, b["id"], name="Keep")
    assert client.delete(f"/applications/{a['id']}", headers=auth).status_code == 204
    assert [c.name for c in db.scalars(select(ApplicationContact))] == ["Keep"]  # no orphans


def test_deleting_the_account_deletes_every_contact(client, auth, db):
    app = create(client, auth)
    add(client, auth, app["id"])
    assert client.post("/auth/delete-account", json={"password": "correct-horse-battery"}, headers=auth).status_code == 204
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(ApplicationContact)) == 0


def test_archiving_and_editing_the_application_keep_its_contacts(client, auth):
    app = create(client, auth, status="rejected")
    add(client, auth, app["id"])
    client.patch(f"/applications/{app['id']}", json={"archived": True, "status": "applied", "tags": ["x"]}, headers=auth)
    assert len(detail(client, auth, app["id"])["contacts"]) == 1


# --- export and import ----------------------------------------------------------------------------


def rows(client, auth):
    text = client.get("/applications/export.csv", headers=auth).text.lstrip("﻿")
    return {r["Company"]: r for r in csv.DictReader(io.StringIO(text))}


def test_the_export_has_a_contacts_column_with_a_line_per_contact(client, auth):
    app = create(client, auth, company="Acme")
    add(client, auth, app["id"], name="Jane Doe", title="Recruiter", email="jane@acme.com", linkedin_url="https://linkedin.com/in/jane")
    add(client, auth, app["id"], name="Sam Lee", title="Hiring manager")
    create(client, auth, company="Nobody")
    exported = rows(client, auth)
    assert exported["Acme"]["Contacts"] == "Jane Doe | Recruiter | jane@acme.com | https://linkedin.com/in/jane\nSam Lee | Hiring manager"
    assert exported["Nobody"]["Contacts"] == ""


def test_the_export_keeps_every_field_so_it_is_still_a_backup(client, auth):
    app = create(client, auth, company="Acme")
    add(client, auth, app["id"], name="Jane", email="jane@acme.com", linkedin_url="https://linkedin.com/in/jane")
    cell = rows(client, auth)["Acme"]["Contacts"]
    assert "jane@acme.com" in cell and "https://linkedin.com/in/jane" in cell


def do_import(client, auth, data: bytes):
    res = client.post("/applications/import", content=data, headers={**auth, "Content-Type": "text/csv"})
    assert res.status_code == 200, res.text
    return res.json()


def test_exporting_then_importing_reproduces_every_contact(client, auth):
    from tests.conftest import make_user

    app = create(client, auth, company="Acme")
    add(client, auth, app["id"], name="Jane Doe", title="Recruiter", email="jane@acme.com", linkedin_url="https://linkedin.com/in/jane")
    add(client, auth, app["id"], name="Sam Lee")
    add(client, auth, app["id"], name="Pat Kim", email="pat@acme.com")
    fresh = make_user(client, email="fresh@example.com")
    do_import(client, fresh, client.get("/applications/export.csv", headers=auth).content)
    (restored,) = client.get("/applications", headers=fresh).json()["items"]
    got = [(c["name"], c["title"], c["email"], c["linkedin_url"]) for c in detail(client, fresh, restored["id"])["contacts"]]
    assert got == [
        ("Jane Doe", "Recruiter", "jane@acme.com", "https://linkedin.com/in/jane"),
        ("Sam Lee", None, None, None),
        ("Pat Kim", None, "pat@acme.com", None),
    ]


def test_a_hand_made_contacts_cell_is_read_and_an_invalid_part_is_dropped_and_reported(client, auth):
    cell = "Jane Doe | Recruiter | not-an-email | notalink\n | Orphan Title\nSam Lee | Manager | sam@acme.com"
    out = io.StringIO()
    csv.writer(out, lineterminator="\r\n").writerows([["Company", "Role", "Contacts"], ["Acme", "Eng", cell]])
    result = do_import(client, auth, out.getvalue().encode())
    assert result["added"] == 1
    reasons = " ".join(n["reason"] for n in result["adjusted"])
    assert "email is not valid" in reasons and "LinkedIn link is not valid" in reasons and "contact with no name was left out" in reasons
    (app,) = client.get("/applications", headers=auth).json()["items"]
    got = [(c["name"], c["title"], c["email"], c["linkedin_url"]) for c in detail(client, auth, app["id"])["contacts"]]
    assert got == [("Jane Doe", "Recruiter", None, None), ("Sam Lee", "Manager", "sam@acme.com", None)]  # the row and the good parts survive


def test_contacts_past_the_limit_are_left_out_of_an_import_with_a_note(client, auth):
    cell = "\n".join(f"Person {i}" for i in range(MAX_CONTACTS + 3))
    out = io.StringIO()
    csv.writer(out, lineterminator="\r\n").writerows([["Company", "Role", "Contacts"], ["Acme", "Eng", cell]])
    result = do_import(client, auth, out.getvalue().encode())
    assert any("only 10 contacts are kept" in n["reason"] for n in result["adjusted"])
    (app,) = client.get("/applications", headers=auth).json()["items"]
    assert len(detail(client, auth, app["id"])["contacts"]) == MAX_CONTACTS


def test_a_formula_looking_name_survives_the_round_trip(client, auth):
    from tests.conftest import make_user

    app = create(client, auth, company="Acme")
    add(client, auth, app["id"], name="=SUM(1)")
    assert rows(client, auth)["Acme"]["Contacts"].startswith("'=SUM(1)")  # neutralised for the spreadsheet
    fresh = make_user(client, email="fresh@example.com")
    do_import(client, fresh, client.get("/applications/export.csv", headers=auth).content)
    (restored,) = client.get("/applications", headers=fresh).json()["items"]
    assert detail(client, fresh, restored["id"])["contacts"][0]["name"] == "=SUM(1)"
