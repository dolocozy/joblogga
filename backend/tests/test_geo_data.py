"""The real, vendored place data (backend/data/geo): what is in it, and that migration 0008 loads it correctly.

Everything else in the suite uses the tiny stand-in in tests/fixtures/geo; this file is the one place that
touches the full files, so a changed, truncated or corrupted copy fails here.
"""

import csv
import gzip
import hashlib
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from app.config import normalize_database_url
from app.geo import search_key
from app.migrations import BACKEND_DIR, schema_differences, upgrade_database
from tests.conftest import TEST_DATABASE_URL, reset_database

DATA = BACKEND_DIR / "data" / "geo"
csv.field_size_limit(10**9)

# Recorded in data/geo/NOTICE.md. Change all three places together, with a new migration, when the data is updated.
SHA256 = {
    "countries.csv": "20e8e03a30167325db001fcce8b9ca8b80f4862df0ef83a86b37b304e3177e3e",
    "states.csv": "367fa287e25497a1089fc69a5d73541bf986d7e474d4da1666f43c49d91c7dc2",
    "csv-cities.csv.gz": "3cd409d7215ab6e81a696878d23da5149d76dda4e336e726cc23b8d91765b282",
}
COUNTS = {"countries": 250, "states": 5308, "cities": 152970}


def rows(name: str) -> list[dict]:
    path = DATA / name
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


# --- the files themselves ------------------------------------------------------


@pytest.mark.parametrize("name,digest", SHA256.items())
def test_the_files_are_exactly_the_pinned_upstream_versions(name, digest):
    assert hashlib.sha256((DATA / name).read_bytes()).hexdigest() == digest


def test_the_license_and_notice_travel_with_the_data():
    assert "Open Database License" in (DATA / "LICENSE").read_text()
    notice = (DATA / "NOTICE.md").read_text()
    assert "ODbL" in notice and "dr5hn/countries-states-cities-database" in notice
    for digest in SHA256.values():
        assert digest in notice  # the NOTICE records the same checksums the build verifies


def test_the_files_hold_the_expected_number_of_rows():
    assert (len(rows("countries.csv")), len(rows("states.csv")), len(rows("csv-cities.csv.gz"))) == tuple(COUNTS.values())


def test_the_hierarchy_is_intact_with_no_orphans_or_duplicates():
    countries, states, cities = rows("countries.csv"), rows("states.csv"), rows("csv-cities.csv.gz")
    country_ids = {r["id"] for r in countries}
    state_country = {r["id"]: r["country_id"] for r in states}
    assert len(country_ids) == len(countries) and len(state_country) == len(states) and len({r["id"] for r in cities}) == len(cities)
    assert all(c in country_ids for c in state_country.values())
    assert all(r["state_id"] in state_country and state_country[r["state_id"]] == r["country_id"] for r in cities)
    assert all(r["name"].strip() for r in countries + states + cities)


def test_the_well_known_duplicates_are_really_in_the_data():
    """The reason the picker stores an id and shows the state: these are all different places."""
    cities = rows("csv-cities.csv.gz")
    us = next(r["id"] for r in rows("countries.csv") if r["iso2"] == "US")
    springfields = {r["state_name"] for r in cities if r["name"] == "Springfield" and r["country_id"] == us}
    assert len(springfields) >= 15 and {"Illinois", "Missouri", "Ohio"} <= springfields
    assert len({r["country_code"] for r in cities if r["name"] == "London"}) >= 3


# --- migration 0008 with the real files ----------------------------------------


@pytest.fixture
def real_engine(tmp_path, monkeypatch):
    monkeypatch.delenv("JOBLOGGA_GEO_DIR", raising=False)  # the suite points this at the tiny fixture; use the real folder
    if TEST_DATABASE_URL.startswith("sqlite"):
        eng = create_engine(f"sqlite:///{tmp_path / 'geo.db'}")
    else:
        eng = create_engine(normalize_database_url(TEST_DATABASE_URL))
        reset_database(eng)
    yield eng
    if not TEST_DATABASE_URL.startswith("sqlite"):
        reset_database(eng)
    eng.dispose()


def test_the_migration_loads_every_row_of_the_real_dataset(real_engine):
    upgrade_database(real_engine)
    with real_engine.connect() as conn:
        for table, expected in COUNTS.items():
            assert conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() == expected, table
        assert schema_differences(conn) == []


def test_the_loaded_names_are_trimmed_and_the_search_column_agrees_with_the_app_function(real_engine):
    """The migration carries its own copy of search_key (migrations never import app code). They must agree on every name."""
    upgrade_database(real_engine)
    with real_engine.connect() as conn:
        stored = conn.execute(text("SELECT name, search_name FROM cities")).all()
    assert len(stored) == COUNTS["cities"]
    assert all(name == name.strip() for name, _ in stored)
    disagreements = [(name, key) for name, key in stored if key != search_key(name)]
    assert disagreements == []


def test_every_loaded_city_can_be_found_by_typing_its_own_name(real_engine):
    """A search for a name's own key always lands in that name's range, so no city is unreachable."""
    from app.geo import next_key

    upgrade_database(real_engine)
    with real_engine.connect() as conn:
        keys = [row[0] for row in conn.execute(text("SELECT DISTINCT search_name FROM cities"))]
    assert all(k and k >= k and k < next_key(k) for k in keys)


def test_the_real_dataset_answers_the_springfield_question_from_our_own_database(real_engine):
    upgrade_database(real_engine)
    with real_engine.connect() as conn:
        us = conn.execute(text("SELECT id FROM countries WHERE iso2 = 'US'")).scalar()
        found = conn.execute(
            text(
                "SELECT s.name FROM cities c JOIN states s ON s.id = c.state_id "
                "WHERE c.country_id = :us AND c.search_name = 'springfield'"
            ),
            {"us": us},
        ).scalars().all()
        assert len(set(found)) >= 15 and {"Illinois", "Missouri", "Ohio"} <= set(found)
        assert conn.execute(text("SELECT COUNT(*) FROM cities WHERE search_name = 'zurich'")).scalar() >= 1  # accents folded


def test_running_the_upgrade_again_does_not_reload_anything(real_engine):
    upgrade_database(real_engine)
    upgrade_database(real_engine)
    with real_engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM cities")).scalar() == COUNTS["cities"]
