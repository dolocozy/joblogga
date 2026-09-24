import shutil
import threading
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text

from app.config import normalize_database_url
from app.db import Base
from app.migrations import BACKEND_DIR, BASELINE, SchemaDriftError, alembic_config, schema_differences, upgrade_database
from tests.conftest import TEST_DATABASE_URL, reset_database

ON_POSTGRES = not TEST_DATABASE_URL.startswith("sqlite")
TABLES = {"users", "applications", "status_changes"}


@pytest.fixture
def engine(tmp_path):
    """An empty database of the kind the suite is running against (a temporary
    SQLite file, or the Postgres service in CI)."""
    if ON_POSTGRES:
        eng = create_engine(normalize_database_url(TEST_DATABASE_URL))
        reset_database(eng)
    else:
        eng = create_engine(f"sqlite:///{tmp_path / 'migrations.db'}")
    yield eng
    if ON_POSTGRES:
        reset_database(eng)
    eng.dispose()


def tables(engine) -> set[str]:
    return set(inspect(engine).get_table_names())


def version(engine) -> str | None:
    with engine.connect() as conn:
        if "alembic_version" not in tables(engine):
            return None
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def seed_rows(engine) -> None:
    """A user with an application and its history: the kind of data production holds."""
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, email, hashed_password, created_at) VALUES (1, 'me@example.com', 'x', '2026-01-01 00:00:00')"))
        conn.execute(
            text(
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, created_at, updated_at) "
                "VALUES (1, 1, 'Acme', 'Engineer', '2026-03-01', 'interview', '2026-03-01 00:00:00', '2026-03-01 00:00:00')"
            )
        )
        conn.execute(text("INSERT INTO status_changes (id, application_id, to_status, changed_at) VALUES (1, 1, 'interview', '2026-03-01 00:00:00')"))


def counts(engine) -> tuple[int, int, int]:
    with engine.connect() as conn:
        return tuple(conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar() for t in ("users", "applications", "status_changes"))  # type: ignore[return-value]


# --- a brand-new database ---------------------------------------------------


def test_a_new_database_is_built_from_the_migrations(engine):
    upgrade_database(engine)
    assert TABLES <= tables(engine)
    assert version(engine) == BASELINE


def test_migrated_schema_matches_the_models_exactly(engine):
    """The drift guard. If someone changes a model (adds a column, an index, changes
    a length) without writing a migration, this fails and tells them what differs."""
    upgrade_database(engine)
    with engine.connect() as conn:
        assert schema_differences(conn) == []


def test_running_it_again_changes_nothing(engine):
    upgrade_database(engine)
    seed_rows(engine)
    upgrade_database(engine)
    upgrade_database(engine)
    assert version(engine) == BASELINE
    assert counts(engine) == (1, 1, 1)


def test_downgrading_to_nothing_removes_the_tables(engine):
    upgrade_database(engine)
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "base")
    assert not (TABLES & tables(engine))


# --- adopting the database production already has ---------------------------


def test_a_database_made_by_the_old_startup_code_is_adopted_with_its_data_untouched(engine):
    Base.metadata.create_all(engine)  # exactly what the app did before migrations existed
    seed_rows(engine)
    assert version(engine) is None  # no migration history

    upgrade_database(engine)

    assert version(engine) == BASELINE
    assert counts(engine) == (1, 1, 1)  # nothing dropped, nothing recreated
    with engine.connect() as conn:
        assert conn.execute(text("SELECT company FROM applications")).scalar() == "Acme"
        assert schema_differences(conn) == []


def test_adopting_only_records_a_version_and_creates_nothing_else(engine):
    Base.metadata.create_all(engine)
    before = tables(engine)
    upgrade_database(engine)
    assert tables(engine) == before | {"alembic_version"}


def test_an_existing_database_that_does_not_match_is_refused_and_left_alone(engine):
    Base.metadata.create_all(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("DROP INDEX ix_applications_status"))  # drift: someone changed the schema by hand

    with pytest.raises(SchemaDriftError, match="ix_applications_status"):
        upgrade_database(engine)

    assert version(engine) is None  # not stamped: we will not vouch for a schema we did not check
    assert counts(engine) == (1, 1, 1)


def test_an_extra_column_is_also_drift(engine):
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN surprise TEXT"))
    with pytest.raises(SchemaDriftError, match="surprise"):
        upgrade_database(engine)


def test_a_column_of_the_wrong_size_is_drift_too(engine):
    if not ON_POSTGRES:
        pytest.skip("SQLite does not enforce or report column lengths")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE applications ALTER COLUMN company TYPE VARCHAR(50)"))
    with pytest.raises(SchemaDriftError):
        upgrade_database(engine)


# --- the next schema change, applied to a database that has real rows -------


def add_priority_migration(tmp_path: Path) -> Path:
    """A copy of the real migrations plus a made-up 0002, to rehearse what the first real change will do."""
    scripts = tmp_path / "alembic"
    shutil.copytree(BACKEND_DIR / "alembic", scripts, ignore=shutil.ignore_patterns("__pycache__"))
    (scripts / "versions" / "2026_10_01_0900-0002_add_priority.py").write_text(
        '''"""add priority"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.add_column(sa.Column("priority", sa.Integer(), nullable=False, server_default="3"))


def downgrade() -> None:
    with op.batch_alter_table("applications") as batch:
        batch.drop_column("priority")
'''
    )
    return scripts


def test_a_later_migration_keeps_existing_rows_and_fills_new_columns(engine, tmp_path):
    Base.metadata.create_all(engine)  # production as it is today
    seed_rows(engine)
    scripts = add_priority_migration(tmp_path)

    upgrade_database(engine, scripts)  # adopt, then apply 0002 in the same start

    assert version(engine) == "0002"
    assert counts(engine) == (1, 1, 1)
    with engine.connect() as conn:
        row = conn.execute(text("SELECT company, priority FROM applications")).one()
    assert tuple(row) == ("Acme", 3)  # the old row got the default; nothing was lost


def test_that_migration_can_be_rolled_back_without_losing_rows(engine, tmp_path):
    Base.metadata.create_all(engine)
    seed_rows(engine)
    scripts = add_priority_migration(tmp_path)
    upgrade_database(engine, scripts)

    with engine.begin() as conn:
        command.downgrade(alembic_config(conn, scripts), "0001")

    assert version(engine) == BASELINE
    assert counts(engine) == (1, 1, 1)
    assert "priority" not in {c["name"] for c in inspect(engine).get_columns("applications")}


# --- a failure must not leave a half-migrated database (Postgres only) ------


@pytest.mark.skipif(not ON_POSTGRES, reason="SQLite does not roll back schema changes")
def test_a_failing_migration_rolls_everything_back(engine, tmp_path):
    scripts = add_priority_migration(tmp_path)
    broken = next((scripts / "versions").glob("*0002*.py"))
    broken.write_text(broken.read_text().replace("    with op.batch_alter_table(\"applications\") as batch:\n        batch.add_column", "    op.execute('SELECT 1/0')\n    with op.batch_alter_table(\"applications\") as batch:\n        batch.add_column", 1))

    with pytest.raises(Exception, match="division by zero"):
        upgrade_database(engine, scripts)

    # Not even the baseline: the whole start-up upgrade is one transaction.
    assert not (TABLES & tables(engine))
    assert version(engine) is None


@pytest.mark.skipif(not ON_POSTGRES, reason="needs Postgres advisory locks")
def test_two_instances_starting_at_once_do_not_collide(engine):
    errors: list[Exception] = []

    def start():
        second = create_engine(normalize_database_url(TEST_DATABASE_URL))
        try:
            upgrade_database(second)
        except Exception as e:  # noqa: BLE001 - reported below
            errors.append(e)
        finally:
            second.dispose()

    threads = [threading.Thread(target=start) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    assert errors == []
    assert TABLES <= tables(engine)
    assert version(engine) == BASELINE
