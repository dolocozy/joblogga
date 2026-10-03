import pytest

from app.duplicates import duplicate_key, normalize

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def check(client, auth, company="Acme Corp", role="Backend Engineer", **extra):
    res = client.get("/applications/duplicates", params={"company": company, "role": role, **extra}, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


# --- how two entries are compared ---------------------------------------------


@pytest.mark.parametrize(
    "a,b",
    [("Acme Corp", "acme corp"), ("  Acme Corp  ", "Acme Corp"), ("Acme   Corp", "Acme Corp"), ("ACME\tCORP", "acme corp"), ("École", "école"), ("Straße", "STRASSE")],
)
def test_case_and_extra_whitespace_do_not_make_a_difference(a, b):
    assert normalize(a) == normalize(b)


@pytest.mark.parametrize("a,b", [("Acme Corp", "Acme Corporation"), ("Data Analyst", "Senior Data Analyst"), ("Acme", "Acme Inc"), ("Zürich AG", "Zurich AG")])
def test_nothing_fuzzier_than_that_matches(a, b):
    assert normalize(a) != normalize(b)


def test_the_key_is_company_and_role_together():
    assert duplicate_key("Acme", "Engineer") != duplicate_key("Engineer", "Acme")


# --- the check ------------------------------------------------------------------


def test_it_needs_a_login(client):
    assert client.get("/applications/duplicates", params={"company": "A", "role": "B"}).status_code == 401


def test_an_exact_match_is_found_with_what_the_warning_needs(client, auth):
    app = create(client, auth, date_applied="2026-03-01", status="interview")
    (found,) = check(client, auth)
    assert found["id"] == app["id"]
    assert (found["company"], found["role"], found["status"], found["date_applied"]) == ("Acme Corp", "Backend Engineer", "interview", "2026-03-01")
    assert "created_at" in found


@pytest.mark.parametrize("company,role", [("acme corp", "BACKEND ENGINEER"), ("  Acme Corp ", "Backend  Engineer"), ("ACME CORP", "backend engineer")])
def test_case_and_spacing_variants_still_match(client, auth, company, role):
    create(client, auth)
    assert len(check(client, auth, company=company, role=role)) == 1


def test_a_different_role_at_the_same_company_is_not_a_duplicate(client, auth):
    create(client, auth)
    assert check(client, auth, role="Frontend Engineer") == []
    assert check(client, auth, role="Senior Backend Engineer") == []


def test_the_same_role_at_a_different_company_is_not_a_duplicate(client, auth):
    create(client, auth)
    assert check(client, auth, company="Globex") == []
    assert check(client, auth, company="Acme Corp Ltd") == []


def test_nothing_matches_with_no_applications(client, auth):
    assert check(client, auth) == []


def test_every_existing_match_is_listed_oldest_first(client, auth):
    first = create(client, auth)
    second = create(client, auth, company="acme corp")
    assert [d["id"] for d in check(client, auth)] == [first["id"], second["id"]]


def test_saved_jobs_and_closed_applications_count_too(client, auth):
    create(client, auth, status="saved")
    create(client, auth, status="rejected")
    assert {d["status"] for d in check(client, auth)} == {"saved", "rejected"}


def test_at_most_five_are_returned(client, auth):
    for _ in range(7):
        create(client, auth)
    assert len(check(client, auth)) == 5


def test_the_application_being_edited_does_not_match_itself(client, auth):
    mine = create(client, auth)
    assert check(client, auth, exclude_id=mine["id"]) == []
    other = create(client, auth)
    assert [d["id"] for d in check(client, auth, exclude_id=mine["id"])] == [other["id"]]


def test_another_users_applications_are_never_matched_or_revealed(client, auth, other_auth):
    create(client, other_auth)
    assert check(client, auth) == []
    assert check(client, other_auth) != []


@pytest.mark.parametrize("params", [{"company": "", "role": "x"}, {"company": "x", "role": ""}, {"company": "x"}, {"role": "x"}, {"company": "x", "role": "y", "exclude_id": 0}])
def test_bad_input_is_refused(client, auth, params):
    assert client.get("/applications/duplicates", params=params, headers=auth).status_code == 422


# --- it warns, it never blocks --------------------------------------------------


def test_saving_a_duplicate_is_still_allowed(client, auth):
    create(client, auth)
    again = client.post("/applications", json=BASE, headers=auth)
    assert again.status_code == 201
    assert client.get("/applications", headers=auth).json()["total"] == 2


def test_editing_into_a_duplicate_is_still_allowed(client, auth):
    create(client, auth)
    other = create(client, auth, company="Globex")
    res = client.patch(f"/applications/{other['id']}", json={"company": "Acme Corp"}, headers=auth)
    assert res.status_code == 200
