"""Loads tests/fixtures/geo into a test database, independently of migration 0008's loader."""

import csv
import gzip
from pathlib import Path

from app.geo import search_key
from app.models import City, Country, State

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "geo"


def load_fixture_places(db) -> dict:
    """Insert the fixture places. Returns ids by name: ids["Springfield", "Illinois"], ids["United States"] ..."""
    ids: dict = {}
    with open(FIXTURE_DIR / "countries.csv", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            db.add(Country(id=int(row["id"]), name=row["name"], iso2=row["iso2"], iso3=row["iso3"]))
            ids[row["name"]] = int(row["id"])
    db.flush()
    states = {}
    with open(FIXTURE_DIR / "states.csv", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            db.add(State(id=int(row["id"]), country_id=int(row["country_id"]), name=row["name"]))
            states[int(row["id"])] = row["name"]
            ids[("state", row["name"])] = int(row["id"])
    db.flush()
    with gzip.open(FIXTURE_DIR / "csv-cities.csv.gz", "rt", encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            name = row["name"].strip()
            db.add(
                City(
                    id=int(row["id"]),
                    state_id=int(row["state_id"]),
                    country_id=int(row["country_id"]),
                    name=name,
                    search_name=search_key(name),
                    population=int(row["population"]) if row["population"] else None,
                )
            )
            ids.setdefault((name, states[int(row["state_id"])]), int(row["id"]))
    db.commit()
    return ids
