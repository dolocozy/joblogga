"""Runs database migrations when the API starts.

Startup does one of three things, decided by what is already in the database:

1. Brand new database: run every migration, creating the schema.
2. Database that Alembic already manages: run any migrations it has not applied.
3. "Legacy" database: created by the app's old startup code (`create_all`), so it
   has tables but no Alembic record. Its data must not be touched. We check the
   tables really match the baseline, then mark it as being at the baseline
   without running anything, and continue as in (2).

All of it happens in one transaction, and on Postgres (whose DDL is transactional)
a failure rolls the database back to exactly where it started. A failure also
stops the app from starting, and the host keeps serving the previous version.
"""

import logging
from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import Connection, Engine, inspect, text

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.db import Base

logger = logging.getLogger("joblogga.migrations")

BACKEND_DIR = Path(__file__).resolve().parent.parent
BASELINE = "0001"

# An arbitrary constant naming "the migration lock". Two API instances starting at
# once would otherwise both try to migrate; Postgres makes the second one wait.
_ADVISORY_LOCK_KEY = 7_281_936_450


class SchemaDriftError(RuntimeError):
    """The database does not match the schema this version of the app expects."""


def alembic_config(connection: Connection | None = None, script_location: Path | None = None) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(script_location or BACKEND_DIR / "alembic"))
    if connection is not None:
        config.attributes["connection"] = connection
    return config


def schema_differences(connection: Connection) -> list:
    """What differs between the live database and the models (empty = they match).

    This is the same comparison `alembic revision --autogenerate` makes. Types are
    compared too, so a column of the wrong length counts as a difference.
    """
    context = MigrationContext.configure(connection, opts={"compare_type": True})
    return compare_metadata(context, Base.metadata)


def _is_legacy(connection: Connection) -> bool:
    tables = set(inspect(connection).get_table_names())
    return "alembic_version" not in tables and "users" in tables


def upgrade_database(engine: Engine, script_location: Path | None = None) -> None:
    """Bring the database up to the latest schema. See the module docstring.

    `script_location` exists so tests can run a different set of migrations.
    """
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            # Held until this transaction ends, so concurrent starters queue up.
            connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _ADVISORY_LOCK_KEY})

        config = alembic_config(connection, script_location)
        if _is_legacy(connection):
            differences = schema_differences(connection)
            if differences:
                raise SchemaDriftError(
                    "The database has tables but no migration history, and they do not match "
                    f"the expected schema, so it will not be marked as up to date: {differences}"
                )
            logger.info("Existing database recognised; marking it as at baseline %s (no changes made)", BASELINE)
            command.stamp(config, BASELINE)

        command.upgrade(config, "head")
