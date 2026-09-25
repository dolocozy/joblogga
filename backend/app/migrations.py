"""Runs database migrations when the API starts.

Every start brings the database up to the latest schema: a brand-new database is
built from the migrations, and one Alembic already manages gets whatever it has not
yet applied. It all happens in one transaction, and on Postgres (whose DDL is
transactional) a failure rolls the database back to exactly where it started. A
failure also stops the app from starting, and the host keeps serving the previous
version.

(Before migrations existed the app built its tables with `create_all`. The one
production database and the one development database made that way were adopted
into Alembic by marking them as being at the baseline, and that adoption code has
been removed: every database is now created by, and tracked by, the migrations.)
"""

from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import Connection, Engine, text

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.db import Base

BACKEND_DIR = Path(__file__).resolve().parent.parent

# An arbitrary constant naming "the migration lock". Two API instances starting at
# once would otherwise both try to migrate; Postgres makes the second one wait.
_ADVISORY_LOCK_KEY = 7_281_936_450


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


def upgrade_database(engine: Engine, script_location: Path | None = None) -> None:
    """Bring the database up to the latest schema. See the module docstring.

    `script_location` exists so tests can run a different set of migrations.
    """
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            # Held until this transaction ends, so concurrent starters queue up.
            connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _ADVISORY_LOCK_KEY})
        command.upgrade(alembic_config(connection, script_location), "head")
