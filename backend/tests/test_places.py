import csv
import io

import pytest

from app.geo import next_key, place_label, search_key

BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


def create(client, auth, **fields):
    res = client.post("/applications", json={**BASE, **fields}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def patch(client, auth, app_id, **fields):
    return client.patch(f"/applications/{app_id}", json=fields, headers=auth)


def companies(client, auth, **params):
    return sorted(a["company"] for a in client.get("/applications", params=params, headers=auth).json()["items"])


def cities(client, auth, country, q, **params):
    res = client.get("/geo/cities", params={"country_id": country, "q": q, **params}, headers=auth)
    assert res.status_code == 200, res.text
    return res.json()


# --- the helpers ---------------------------------------------------------------


@pytest.mark.parametrize(
    "text,key",
    [("Zürich", "zurich"), ("ZURICH", "zurich"), (" São Paulo ", "sao paulo"), ("Ålesund", "alesund"), ("Łódź", "lodz"), ("Bjørnafjorden", "bjornafjorden"), ("Straße", "strasse"), ("Reykjavík", "reykjavik")],
)
def test_search_key_ignores_case_and_accents(text, key):
    assert search_key(text) == key


def test_next_key_bounds_a_prefix_search():
    assert next_key("spr") == "sps"
    assert "spring" >= "spr" and "spring" < next_key("spr")
    assert "sps" >= next_key("spr")  # the first string that is no longer a match


def test_place_label_joins_what_is_present():
    assert place_label("Springfield", "Illinois", "United States") == "Springfield, Illinois, United States"
    assert place_label("Toronto", None, "Canada") == "Toronto, Canada"


# --- the lookups ---------------------------------------------------------------


def test_lookups_need_a_login(client, geo):
    assert client.get("/geo/countries").status_code == 401
    assert client.get("/geo/states", params={"country_id": 1}).status_code == 401
    assert client.get("/geo/cities", params={"country_id": 1, "q": "to"}).status_code == 401


def test_countries_are_listed_by_name(client, auth, geo):
    names = [c["name"] for c in client.get("/geo/countries", headers=auth).json()]
    assert names == sorted(names)
    assert {"United States", "Canada", "Switzerland"} <= set(names)
    assert client.get("/geo/countries", headers=auth).json()[0].keys() == {"id", "name", "iso2"}


def test_states_of_one_country_only(client, auth, geo):
    res = client.get("/geo/states", params={"country_id": geo["United States"]}, headers=auth).json()
    assert [s["name"] for s in res] == ["Illinois", "Kentucky", "Missouri", "Ohio"]
    assert client.get("/geo/states", headers=auth).status_code == 422  # a country is required


def test_a_city_search_returns_each_place_with_its_state(client, auth, geo):
    res = cities(client, auth, geo["United States"], "spring")
    assert [m["label"] for m in res] == [
        "Springfield, Missouri, United States",  # biggest first
        "Springfield, Illinois, United States",
        "Springfield, Ohio, United States",
    ]
    assert [m["state"] for m in res] == ["Missouri", "Illinois", "Ohio"]
    assert len({m["id"] for m in res}) == 3  # three different dataset rows


def test_two_places_with_one_name_in_different_countries_are_kept_apart_by_the_country_filter(client, auth, geo):
    assert [m["label"] for m in cities(client, auth, geo["Canada"], "london")] == ["London, Ontario, Canada"]
    assert [m["label"] for m in cities(client, auth, geo["United Kingdom"], "london")] == ["London, England, United Kingdom"]
    assert sorted(m["label"] for m in cities(client, auth, geo["United States"], "london")) == ["London, Kentucky, United States", "London, Ohio, United States"]


def test_the_search_ignores_accents_and_case_in_both_directions(client, auth, geo):
    ch = geo["Switzerland"]
    for q in ("zur", "ZÜR", "Zürich", "zurich"):
        assert cities(client, auth, ch, q)[0]["name"] == "Zürich", q
    assert [m["name"] for m in cities(client, auth, geo["Canada"], "ales")] == ["Ålesund"]


def test_it_matches_from_the_start_of_the_name_only(client, auth, geo):
    assert cities(client, auth, geo["United States"], "field") == []


def test_a_place_listed_twice_under_one_name_and_state_is_offered_once_but_both_rows_stay(client, auth, geo, db):
    from sqlalchemy import func, select

    from app.models import City

    ch = cities(client, auth, geo["China"], "huang")
    assert [m["label"] for m in ch] == ["Huangshan, Anhui, China"]  # not two identical lines
    assert db.scalar(select(func.count()).select_from(City).where(City.name == "Huangshan")) == 2  # nothing deleted
    springfield = cities(client, auth, geo["United States"], "springfield")
    assert len([m for m in springfield if m["state"] == "Illinois"]) == 1  # the "Springfield " row that was trimmed to a repeat


def test_unknown_sizes_sort_last_and_the_limit_is_respected(client, auth, geo):
    zurich = cities(client, auth, geo["Switzerland"], "zurich")
    assert [m["name"] for m in zurich] == ["Zürich", "Zürich (Kreis 1)"]  # the one without a population last
    assert len(cities(client, auth, geo["United States"], "sp", limit=2)) == 2


def test_the_search_needs_a_country_and_at_least_two_letters(client, auth, geo):
    assert client.get("/geo/cities", params={"q": "sp"}, headers=auth).status_code == 422
    assert client.get("/geo/cities", params={"country_id": 1, "q": "s"}, headers=auth).status_code == 422
    assert client.get("/geo/cities", params={"country_id": 1, "q": "sp", "limit": 26}, headers=auth).status_code == 422


def test_nothing_matching_is_an_empty_list(client, auth, geo):
    assert cities(client, auth, geo["United States"], "zzzz") == []
    assert cities(client, auth, geo["Antarctica"], "sp") == []


def test_a_query_of_only_symbols_is_handled(client, auth, geo):
    assert cities(client, auth, geo["United States"], "%%") == []  # never a wildcard: it is compared as text


# --- saving a picked place -----------------------------------------------------


def test_picking_a_city_stores_that_exact_row_and_generates_the_readable_place(client, auth, geo):
    app = create(client, auth, city_id=geo["Springfield", "Missouri"])
    assert app["city"] == {"id": geo["Springfield", "Missouri"], "name": "Springfield", "state": {"id": geo[("state", "Missouri")], "name": "Missouri"}}
    assert app["country"] == {"id": geo["United States"], "name": "United States"}
    assert app["location"] == "Springfield, Missouri, United States"
    assert app["location_display"] == "Springfield, Missouri, United States"


def test_two_applications_in_different_springfields_never_look_alike(client, auth, geo):
    a = create(client, auth, company="A", city_id=geo["Springfield", "Illinois"])
    b = create(client, auth, company="B", city_id=geo["Springfield", "Ohio"])
    assert a["city"]["name"] == b["city"]["name"] == "Springfield"
    assert a["location_display"] != b["location_display"]
    assert a["city"]["id"] != b["city"]["id"]
    assert (a["city"]["state"]["name"], b["city"]["state"]["name"]) == ("Illinois", "Ohio")


def test_the_place_survives_reading_it_back(client, auth, geo):
    app = create(client, auth, city_id=geo["Toronto", "Ontario"])
    for got in (client.get(f"/applications/{app['id']}", headers=auth).json(), client.get("/applications", headers=auth).json()["items"][0]):
        assert got["location_display"] == "Toronto, Ontario, Canada"
        assert got["city"]["id"] == geo["Toronto", "Ontario"]


def test_the_client_cannot_make_the_text_disagree_with_the_id(client, auth, geo):
    app = create(client, auth, city_id=geo["Toronto", "Ontario"], location="Paris, France")
    assert app["location"] == "Toronto, Ontario, Canada"


def test_a_country_alone_or_with_a_typed_place(client, auth, geo):
    only = create(client, auth, country_id=geo["Canada"])
    assert (only["country"]["name"], only["city"], only["location"], only["location_display"]) == ("Canada", None, None, "Canada")
    typed = create(client, auth, country_id=geo["Canada"], location="Nowheresville")
    assert (typed["location"], typed["location_display"]) == ("Nowheresville", "Nowheresville, Canada")


def test_free_text_alone_is_still_fine_and_has_no_structure(client, auth, geo):
    app = create(client, auth, location="Somewhere remote")
    assert (app["country"], app["city"], app["location_display"]) == (None, None, "Somewhere remote")


def test_a_city_and_a_matching_country_together_are_accepted(client, auth, geo):
    app = create(client, auth, city_id=geo["London", "Ontario"], country_id=geo["Canada"])
    assert app["location_display"] == "London, Ontario, Canada"


def test_a_city_in_another_country_is_refused(client, auth, geo):
    res = client.post("/applications", json={**BASE, "city_id": geo["London", "Ontario"], "country_id": geo["United Kingdom"]}, headers=auth)
    assert res.status_code == 422
    assert "not in that country" in res.text


@pytest.mark.parametrize("field", ["city_id", "country_id"])
def test_an_id_that_is_not_in_the_dataset_is_refused(client, auth, geo, field):
    res = client.post("/applications", json={**BASE, field: 999999}, headers=auth)
    assert res.status_code == 422
    assert client.get("/applications", headers=auth).json()["total"] == 0  # nothing was saved


@pytest.mark.parametrize("bad", [0, -1, 1.5, "1", True])
def test_an_id_must_be_a_positive_whole_number(client, auth, geo, bad):
    for field in ("city_id", "country_id"):
        assert client.post("/applications", json={**BASE, field: bad}, headers=auth).status_code == 422, (field, bad)


# --- changing it ---------------------------------------------------------------


def test_picking_a_city_on_an_existing_free_text_application_keeps_nothing_stale(client, auth, geo):
    app = create(client, auth, location="Springfield")  # the old, ambiguous kind of entry
    res = patch(client, auth, app["id"], city_id=geo["Springfield", "Ohio"]).json()
    assert res["location"] == res["location_display"] == "Springfield, Ohio, United States"


def test_switching_to_a_different_city_rewrites_the_readable_place(client, auth, geo):
    app = create(client, auth, city_id=geo["Springfield", "Ohio"])
    res = patch(client, auth, app["id"], city_id=geo["Toronto", "Ontario"]).json()
    assert (res["country"]["name"], res["location"]) == ("Canada", "Toronto, Ontario, Canada")


def test_clearing_the_city_and_typing_a_place_instead(client, auth, geo):
    app = create(client, auth, city_id=geo["Toronto", "Ontario"])
    res = patch(client, auth, app["id"], city_id=None, location="Somewhere near Toronto").json()
    assert (res["city"], res["location"], res["country"]["name"]) == (None, "Somewhere near Toronto", "Canada")
    assert res["location_display"] == "Somewhere near Toronto, Canada"


def test_clearing_everything(client, auth, geo):
    app = create(client, auth, city_id=geo["Toronto", "Ontario"])
    res = patch(client, auth, app["id"], city_id=None, country_id=None, location=None).json()
    assert (res["city"], res["country"], res["location"], res["location_display"]) == (None, None, None, None)


def test_changing_the_country_while_a_city_stays_is_refused(client, auth, geo):
    app = create(client, auth, city_id=geo["Toronto", "Ontario"])
    assert patch(client, auth, app["id"], country_id=geo["France"]).status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["country"]["name"] == "Canada"


def test_editing_something_else_leaves_the_place_alone(client, auth, geo):
    app = create(client, auth, city_id=geo["Springfield", "Illinois"])
    res = patch(client, auth, app["id"], notes="phone screen booked").json()
    assert res["location_display"] == "Springfield, Illinois, United States"
    assert res["city"]["id"] == geo["Springfield", "Illinois"]


def test_a_rejected_place_change_changes_nothing_else_in_the_request(client, auth, geo):
    app = create(client, auth, city_id=geo["Toronto", "Ontario"])
    assert patch(client, auth, app["id"], city_id=999999, notes="should not stick").status_code == 422
    assert client.get(f"/applications/{app['id']}", headers=auth).json()["notes"] is None


def test_existing_free_text_is_returned_exactly_as_entered(client, auth, geo):
    app = create(client, auth, location="  Springfield  ")  # trimmed by the same rule as before
    assert (app["location"], app["location_display"], app["country"], app["city"]) == ("Springfield", "Springfield", None, None)


# --- filtering and searching ---------------------------------------------------


def seed_applications(client, auth, geo):
    create(client, auth, company="Illinois Co", city_id=geo["Springfield", "Illinois"])
    create(client, auth, company="Missouri Co", city_id=geo["Springfield", "Missouri"])
    create(client, auth, company="Ohio Co", city_id=geo["London", "Ohio"])
    create(client, auth, company="Toronto Co", city_id=geo["Toronto", "Ontario"])
    create(client, auth, company="Canada Only Co", country_id=geo["Canada"])
    create(client, auth, company="Typed Co", location="Springfield")


def test_filter_by_country(client, auth, geo):
    seed_applications(client, auth, geo)
    assert companies(client, auth, country_id=geo["United States"]) == ["Illinois Co", "Missouri Co", "Ohio Co"]
    assert companies(client, auth, country_id=geo["Canada"]) == ["Canada Only Co", "Toronto Co"]  # a picked city and a bare country
    assert companies(client, auth, country_id=geo["France"]) == []


def test_filter_by_state_separates_the_springfields(client, auth, geo):
    seed_applications(client, auth, geo)
    assert companies(client, auth, state_id=geo[("state", "Illinois")]) == ["Illinois Co"]
    assert companies(client, auth, state_id=geo[("state", "Missouri")]) == ["Missouri Co"]
    assert companies(client, auth, state_id=geo[("state", "Ontario")]) == ["Toronto Co"]


def test_state_and_country_filters_combine_with_each_other_and_with_the_rest(client, auth, geo):
    seed_applications(client, auth, geo)
    assert companies(client, auth, country_id=geo["United States"], state_id=geo[("state", "Ohio")]) == ["Ohio Co"]
    assert companies(client, auth, country_id=geo["Canada"], state_id=geo[("state", "Ohio")]) == []
    assert companies(client, auth, country_id=geo["United States"], q="missouri") == ["Missouri Co"]
    assert client.get("/applications", params={"country_id": geo["United States"], "limit": 1}, headers=auth).json()["total"] == 3


def test_free_text_entries_are_not_in_a_country_or_state_filter(client, auth, geo):
    seed_applications(client, auth, geo)
    assert "Typed Co" not in companies(client, auth, country_id=geo["United States"])


def test_keyword_search_finds_a_city_a_state_or_a_country_name(client, auth, geo):
    seed_applications(client, auth, geo)
    assert companies(client, auth, q="Toronto") == ["Toronto Co"]
    assert companies(client, auth, q="ontario") == ["Toronto Co"]
    assert companies(client, auth, q="canada") == ["Canada Only Co", "Toronto Co"]  # including the country-only one
    assert companies(client, auth, q="springfield") == ["Illinois Co", "Missouri Co", "Typed Co"]


def test_invalid_filter_values_are_refused(client, auth, geo):
    for params in ({"country_id": 0}, {"state_id": -1}, {"country_id": "x"}):
        assert client.get("/applications", params=params, headers=auth).status_code == 422, params


def test_filters_never_show_another_users_applications(client, auth, other_auth, geo):
    create(client, other_auth, company="Theirs", city_id=geo["Toronto", "Ontario"])
    create(client, auth, company="Mine", city_id=geo["Toronto", "Ontario"])
    assert companies(client, auth, country_id=geo["Canada"]) == ["Mine"]
    assert companies(client, auth, state_id=geo[("state", "Ontario")]) == ["Mine"]


# --- export --------------------------------------------------------------------


def export_rows(client, auth):
    text = client.get("/applications/export.csv", headers=auth).text.lstrip("﻿")
    return {r["Company"]: r for r in csv.DictReader(io.StringIO(text))}


def test_the_csv_keeps_the_location_column_and_adds_country_state_and_city(client, auth, geo):
    seed_applications(client, auth, geo)
    rows = export_rows(client, auth)
    assert (rows["Illinois Co"]["Location"], rows["Illinois Co"]["Country"], rows["Illinois Co"]["State"], rows["Illinois Co"]["City"]) == (
        "Springfield, Illinois, United States",
        "United States",
        "Illinois",
        "Springfield",
    )
    assert (rows["Toronto Co"]["Country"], rows["Toronto Co"]["State"], rows["Toronto Co"]["City"]) == ("Canada", "Ontario", "Toronto")


def test_duplicate_city_names_stay_distinguishable_in_the_export(client, auth, geo):
    seed_applications(client, auth, geo)
    rows = export_rows(client, auth)
    a, b = rows["Illinois Co"], rows["Missouri Co"]
    assert a["City"] == b["City"] == "Springfield"
    assert a["Location"] != b["Location"]
    assert (a["State"], b["State"]) == ("Illinois", "Missouri")


def test_free_text_and_country_only_rows_export_without_dropping_anything(client, auth, geo):
    seed_applications(client, auth, geo)
    rows = export_rows(client, auth)
    typed = rows["Typed Co"]
    assert (typed["Location"], typed["Country"], typed["State"], typed["City"]) == ("Springfield", "", "", "")  # exactly what was typed
    only = rows["Canada Only Co"]
    assert (only["Location"], only["Country"], only["State"], only["City"]) == ("Canada", "Canada", "", "")


def test_the_export_still_neutralises_formulas_in_the_place(client, auth, geo):
    create(client, auth, company="Formula Co", location="=HYPERLINK(1)")
    assert export_rows(client, auth)["Formula Co"]["Location"] == "'=HYPERLINK(1)"
