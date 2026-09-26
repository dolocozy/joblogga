"""places: real countries, states and cities, and a structured location on applications

Creates the `countries`, `states` and `cities` tables and loads them ONCE from the vendored dataset in
data/geo (countries-states-cities-database, ODbL; see the NOTICE there). Every lookup afterwards reads
this copy: nothing calls an external service. Set JOBLOGGA_GEO_DIR to load a different folder (the test
suite loads a tiny one).

Adds two nullable columns to `applications`: `country_id` and `city_id`, pointing at the exact dataset rows.
Nothing existing is rewritten or renamed. `applications.location` keeps its column and its values, so every
application's location is exactly as it was; from now on it holds the readable place (generated for a picked
city, otherwise whatever was typed). Existing free-text values are deliberately NOT parsed into countries and
cities: guessing would silently corrupt real data, and people can re-pick a place if they want the structure.

Backward compatible with the release running during the deploy: the new columns are nullable, `location` is
untouched, and the old code never reads the new tables.

The name-normalising function below is a frozen copy of app.geo.search_key (migrations never import app code);
a test checks the two give the same answer for every stored name.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-27 11:00:00

"""

import csv
import gzip
import os
import unicodedata
from collections.abc import Iterator, Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "geo"
CHUNK = 5000

_SPECIAL = str.maketrans({"ß": "ss", "ø": "o", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i", "ħ": "h"})


def _search_key(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.strip().lower().translate(_SPECIAL))
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def _read(path: Path) -> Iterator[dict[str, str]]:
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", encoding="utf-8", newline="") as handle:
        yield from csv.DictReader(handle)


def _int_or_none(value: str) -> int | None:
    value = value.strip()
    return int(value) if value.isdigit() else None


def _countries(directory: Path) -> Iterator[tuple]:
    for row in _read(directory / "countries.csv"):
        yield (int(row["id"]), row["name"].strip(), row["iso2"].strip() or None, row["iso3"].strip() or None)


def _states(directory: Path) -> Iterator[tuple]:
    for row in _read(directory / "states.csv"):
        yield (int(row["id"]), int(row["country_id"]), row["name"].strip())


def _cities(directory: Path) -> Iterator[tuple]:
    for row in _read(directory / "csv-cities.csv.gz"):
        name = row["name"].strip()
        yield (int(row["id"]), int(row["state_id"]), int(row["country_id"]), name, _search_key(name), _int_or_none(row["population"]))


def _load(connection, table: str, columns: Sequence[str], rows: Iterator[tuple]) -> None:
    """Bulk-insert `rows`. Postgres gets COPY (seconds for the whole dataset); SQLite gets batched inserts."""
    if connection.dialect.name == "postgresql":
        raw = connection.connection.driver_connection  # the psycopg connection, in the migration's own transaction
        with raw.cursor() as cursor, cursor.copy(f"COPY {table} ({', '.join(columns)}) FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row)
        return
    statement = f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})"
    chunk: list[tuple] = []
    for row in rows:
        chunk.append(row)
        if len(chunk) >= CHUNK:
            connection.exec_driver_sql(statement, chunk)
            chunk = []
    if chunk:
        connection.exec_driver_sql(statement, chunk)


def upgrade() -> None:
    op.create_table(
        "countries",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("iso2", sa.String(length=2), nullable=True),
        sa.Column("iso3", sa.String(length=3), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "states",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("country_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.ForeignKeyConstraint(["country_id"], ["countries.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_states_country_id", "states", ["country_id"])
    op.create_table(
        "cities",
        sa.Column("id", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("state_id", sa.Integer(), nullable=False),
        sa.Column("country_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("search_name", sa.String(length=120), nullable=False),
        sa.Column("population", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["state_id"], ["states.id"]),
        sa.ForeignKeyConstraint(["country_id"], ["countries.id"]),
        sa.PrimaryKeyConstraint("id"),
    )

    directory = Path(os.environ.get("JOBLOGGA_GEO_DIR") or DEFAULT_DATA_DIR)
    connection = op.get_bind()
    _load(connection, "countries", ("id", "name", "iso2", "iso3"), _countries(directory))
    _load(connection, "states", ("id", "country_id", "name"), _states(directory))
    _load(connection, "cities", ("id", "state_id", "country_id", "name", "search_name", "population"), _cities(directory))

    # Indexes after the load: building them once over finished data is faster than maintaining them per row.
    op.create_index("ix_cities_state_id", "cities", ["state_id"])
    op.create_index("ix_cities_search_name", "cities", ["search_name"])
    op.create_index("ix_cities_country_id_search_name", "cities", ["country_id", "search_name"])

    with op.batch_alter_table("applications") as batch:
        batch.add_column(sa.Column("country_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("city_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_applications_country_id_countries", "countries", ["country_id"], ["id"], ondelete="SET NULL")
        batch.create_foreign_key("fk_applications_city_id_cities", "cities", ["city_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_applications_country_id", "applications", ["country_id"])
    op.create_index("ix_applications_city_id", "applications", ["city_id"])


def downgrade() -> None:
    # `location` was never touched, so nothing is lost: applications keep their readable place.
    op.drop_index("ix_applications_city_id", table_name="applications")
    op.drop_index("ix_applications_country_id", table_name="applications")
    with op.batch_alter_table("applications") as batch:
        batch.drop_constraint("fk_applications_city_id_cities", type_="foreignkey")
        batch.drop_constraint("fk_applications_country_id_countries", type_="foreignkey")
        batch.drop_column("city_id")
        batch.drop_column("country_id")
    op.drop_table("cities")
    op.drop_table("states")
    op.drop_table("countries")
