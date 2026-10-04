import csv
import io

import pytest

from app.currencies import ADDED, COMMON, CURRENCIES, DEFAULT_CURRENCY, REMOVED, normalize_currency

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def patch(client, auth, app_id, **fields):
    return client.patch(f"/applications/{app_id}", json=fields, headers=auth)


# --- the list of currencies ---------------------------------------------------------------


def test_the_list_is_iso_shaped_and_has_the_currencies_most_salaries_are_in():
    assert all(len(c) == 3 and c.isalpha() and c.isupper() for c in CURRENCIES)
    assert all(CURRENCIES[c] for c in CURRENCIES)  # every code has a name
    for code in ("USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "INR", "CNY"):
        assert code in CURRENCIES
    assert set(COMMON) <= set(CURRENCIES) and DEFAULT_CURRENCY in COMMON


def test_the_list_is_the_vendored_places_data_corrected_in_documented_ways():
    """Ties the list to the data it was generated from: a refreshed dataset that adds a currency fails here until it is added."""
    from app.migrations import BACKEND_DIR

    with open(BACKEND_DIR / "data" / "geo" / "countries.csv", encoding="utf-8", newline="") as f:
        in_data = {r["currency"] for r in csv.DictReader(f) if r["currency"]}
    assert set(CURRENCIES) == (in_data - REMOVED) | set(ADDED)
    assert "AAD" not in CURRENCIES  # not an ISO currency
    assert {"SLE", "ZWG", "SLL", "ZWL"} <= set(CURRENCIES)  # the new codes, and the retired ones that old salaries may use


@pytest.mark.parametrize("raw,expected", [("usd", "USD"), (" Eur ", "EUR"), ("CAD", "CAD")])
def test_normalising(raw, expected):
    assert normalize_currency(raw) == expected


def test_the_endpoint_lists_the_common_ones_first_then_the_rest_by_code(client, auth):
    got = client.get("/currencies", headers=auth).json()
    codes = [c["code"] for c in got]
    assert codes[: len(COMMON)] == list(COMMON)
    assert codes[len(COMMON) :] == sorted(codes[len(COMMON) :])
    assert len(codes) == len(set(codes)) == len(CURRENCIES)
    assert next(c for c in got if c["code"] == "EUR") == {"code": "EUR", "name": "Euro", "common": True}
    assert next(c for c in got if c["code"] == "ZAR")["common"] is True and next(c for c in got if c["code"] == "KES")["common"] is False


def test_the_endpoint_needs_a_login(client):
    assert client.get("/currencies").status_code == 401


# --- saving and showing -------------------------------------------------------------------


def test_a_new_application_defaults_to_usd(client, auth):
    assert create(client, auth)["salary_currency"] == "USD"


def test_the_currency_saves_and_comes_back_everywhere(client, auth):
    app = create(client, auth, salary_min=100000, salary_max=120000, salary_currency="EUR")
    assert app["salary_currency"] == "EUR"
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["salary_currency"] == "EUR"
    assert client.get("/applications", headers=auth).json()["items"][0]["salary_currency"] == "EUR"


def test_two_salaries_that_look_the_same_are_no_longer_the_same(client, auth):
    a = create(client, auth, company="A", salary_min=120000, salary_currency="USD")
    b = create(client, auth, company="B", salary_min=120000, salary_currency="EUR")
    assert (a["salary_min"], a["salary_currency"]) != (b["salary_min"], b["salary_currency"])


@pytest.mark.parametrize("raw", ["usd", " eur ", "Cad"])
def test_lower_case_and_spaces_are_tidied(client, auth, raw):
    assert create(client, auth, salary_currency=raw)["salary_currency"] == raw.strip().upper()


def test_it_can_be_changed_and_editing_other_things_leaves_it(client, auth):
    app = create(client, auth, salary_currency="EUR")
    assert patch(client, auth, app["id"], notes="x", salary_min=1).json()["salary_currency"] == "EUR"
    assert patch(client, auth, app["id"], salary_currency="gbp").json()["salary_currency"] == "GBP"


@pytest.mark.parametrize("bad", ["", "US", "USDD", "USS", "$", "123", "ABC", "AAD", "us$", None, 5, True, ["USD"]])
def test_anything_that_is_not_a_real_code_is_refused_and_nothing_is_saved(client, auth, bad):
    assert client.post("/applications", json={**BASE, "salary_currency": bad}, headers=auth).status_code == 422
    app = create(client, auth)
    assert patch(client, auth, app["id"], salary_currency=bad).status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["salary_currency"] == "USD"


def test_the_message_says_what_a_currency_is(client, auth):
    res = client.post("/applications", json={**BASE, "salary_currency": "USS"}, headers=auth)
    assert "three-letter currency code" in res.text


def test_nothing_is_converted_and_the_amounts_are_stored_as_given(client, auth):
    app = create(client, auth, salary_min=5000000, salary_max=8000000, salary_currency="JPY")
    assert (app["salary_min"], app["salary_max"]) == (5000000, 8000000)


def test_a_rejected_currency_change_changes_nothing_else_in_the_request(client, auth):
    app = create(client, auth)
    assert patch(client, auth, app["id"], salary_currency="USS", notes="should not stick").status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["notes"] is None


# --- export and import -----------------------------------------------------------------------


def rows(client, auth):
    text = client.get("/applications/export.csv", headers=auth).text.lstrip("﻿")
    return {r["Company"]: r for r in csv.DictReader(io.StringIO(text))}


def do_import(client, auth, data: bytes):
    res = client.post("/applications/import", content=data, headers={**auth, "Content-Type": "text/csv"})
    assert res.status_code == 200, res.text
    return res.json()


def csv_bytes(header, *body):
    out = io.StringIO()
    csv.writer(out, lineterminator="\r\n").writerows([header, *body])
    return out.getvalue().encode()


def test_the_export_has_a_salary_currency_column(client, auth):
    create(client, auth, company="Euro Co", salary_min=1, salary_currency="EUR")
    create(client, auth, company="Default Co")
    exported = rows(client, auth)
    assert exported["Euro Co"]["Salary currency"] == "EUR"
    assert exported["Default Co"]["Salary currency"] == "USD"


def test_exporting_then_importing_reproduces_the_currency(client, auth):
    from tests.conftest import make_user

    create(client, auth, company="Euro Co", salary_min=100000, salary_max=120000, salary_currency="EUR")
    create(client, auth, company="Yen Co", salary_min=9000000, salary_currency="JPY")
    create(client, auth, company="Plain Co")
    fresh = make_user(client, email="fresh@example.com")
    result = do_import(client, fresh, client.get("/applications/export.csv", headers=auth).content)
    assert result["added"] == 3 and not [n for n in result["adjusted"] if "currency" in n["reason"]]
    got = {a["company"]: (a["salary_min"], a["salary_max"], a["salary_currency"]) for a in client.get("/applications", params={"limit": 50}, headers=fresh).json()["items"]}
    assert got == {"Euro Co": (100000, 120000, "EUR"), "Yen Co": (9000000, None, "JPY"), "Plain Co": (None, None, "USD")}


def test_a_file_with_a_salary_and_no_currency_column_assumes_usd_and_says_so(client, auth):
    result = do_import(client, auth, csv_bytes(["Company", "Role", "Salary min"], ["Acme", "Eng", "90000"], ["Globex", "Eng", ""]))
    assert [n["reason"] for n in result["adjusted"] if "currency" in n["reason"]] == ["no salary currency given, so USD was assumed"]  # only the row with a salary
    assert {a["company"]: a["salary_currency"] for a in client.get("/applications", headers=auth).json()["items"]} == {"Acme": "USD", "Globex": "USD"}


@pytest.mark.parametrize("cell,expected", [("eur", "EUR"), (" GBP ", "GBP"), ("Cad", "CAD")])
def test_currency_codes_in_a_file_are_tidied(client, auth, cell, expected):
    do_import(client, auth, csv_bytes(["Company", "Role", "Salary min", "Currency"], ["Acme", "Eng", "90000", cell]))
    assert client.get("/applications", headers=auth).json()["items"][0]["salary_currency"] == expected


@pytest.mark.parametrize("cell", ["$", "US Dollars", "USS", "AAD"])
def test_an_unrecognised_currency_in_a_file_becomes_usd_with_a_note_and_the_row_is_kept(client, auth, cell):
    result = do_import(client, auth, csv_bytes(["Company", "Role", "Salary min", "Salary currency"], ["Acme", "Eng", "90000", cell]))
    assert result["added"] == 1
    assert any("is not a currency code" in n["reason"] and "USD was assumed" in n["reason"] for n in result["adjusted"])
    assert client.get("/applications", headers=auth).json()["items"][0]["salary_currency"] == "USD"


def test_currency_is_filled_in_silently_when_there_is_no_salary(client, auth):
    result = do_import(client, auth, csv_bytes(["Company", "Role"], ["Acme", "Eng"]))
    assert not [n for n in result["adjusted"] if "currency" in n["reason"]]
