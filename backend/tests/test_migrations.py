import shutil
import threading
from pathlib import Path

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.config import normalize_database_url
from app.migrations import BACKEND_DIR, alembic_config, schema_differences, upgrade_database
from tests.conftest import TEST_DATABASE_URL, reset_database

ON_POSTGRES = not TEST_DATABASE_URL.startswith("sqlite")
BASELINE = "0001"
HEAD = ScriptDirectory(str(BACKEND_DIR / "alembic")).get_current_head()  # moves with every new migration
TABLES = {"users", "applications", "status_changes", "password_reset_tokens", "email_verification_tokens"}


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
    if "alembic_version" not in tables(engine):
        return None
    with engine.connect() as conn:
        return conn.execute(text("SELECT version_num FROM alembic_version")).scalar()


def migrate_to(engine, revision: str, scripts: Path | None = None) -> None:
    with engine.begin() as conn:
        command.upgrade(alembic_config(conn, scripts), revision)


def seed_rows(engine) -> None:
    """A user with an application and its history, written the way the code that
    existed at the baseline wrote them (no `session_version`)."""
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
    assert version(engine) == HEAD


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
    assert version(engine) == HEAD
    assert counts(engine) == (1, 1, 1)


def test_downgrading_to_nothing_removes_the_tables(engine):
    upgrade_database(engine)
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "base")
    assert not (TABLES & tables(engine))


# --- upgrading the production database: at the baseline, holding real rows --


def test_upgrading_a_database_that_holds_rows_keeps_them_and_gives_users_a_default_session_version(engine):
    migrate_to(engine, BASELINE)  # production as it was before this change
    seed_rows(engine)
    assert version(engine) == BASELINE
    assert "password_reset_tokens" not in tables(engine)

    upgrade_database(engine)  # what the next start does

    assert version(engine) == HEAD
    assert counts(engine) == (1, 1, 1)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT company FROM applications")).scalar() == "Acme"
        assert conn.execute(text("SELECT session_version FROM users")).scalar() == 0  # existing sessions stay valid
        assert conn.execute(text("SELECT COUNT(*) FROM password_reset_tokens")).scalar() == 0
        # Accounts that predate verification are trusted, not nagged: verified as of their creation.
        assert conn.execute(text("SELECT email_verified_at IS NOT NULL FROM users")).scalar()
        assert conn.execute(text("SELECT COUNT(*) FROM email_verification_tokens")).scalar() == 0
        assert schema_differences(conn) == []


def test_old_code_can_still_add_users_while_the_new_schema_is_live(engine):
    """During a deploy the previous version keeps serving against the new schema. Its
    INSERT knows nothing about session_version, so the column must fill itself."""
    upgrade_database(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (email, hashed_password, created_at) VALUES ('old@example.com', 'x', '2026-01-01 00:00:00')"))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT session_version FROM users")).scalar() == 0


def test_the_upgrade_can_be_rolled_back_without_losing_rows(engine):
    migrate_to(engine, BASELINE)
    seed_rows(engine)
    upgrade_database(engine)

    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), BASELINE)

    assert version(engine) == BASELINE
    assert counts(engine) == (1, 1, 1)
    assert "password_reset_tokens" not in tables(engine)
    assert "session_version" not in {c["name"] for c in inspect(engine).get_columns("users")}


# --- a failure must not leave a half-migrated database (Postgres only) ------


def add_broken_migration(tmp_path: Path) -> Path:
    """A copy of the real migrations plus one more that fails part-way through."""
    scripts = tmp_path / "alembic"
    shutil.copytree(BACKEND_DIR / "alembic", scripts, ignore=shutil.ignore_patterns("__pycache__"))
    (scripts / "versions" / "2099_01_01_0900-9999_broken.py").write_text(
        f'''"""broken"""
import sqlalchemy as sa
from alembic import op

revision = "9999"
down_revision = "{HEAD}"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("applications", sa.Column("priority", sa.Integer(), nullable=True))
    op.execute("SELECT 1/0")  # fails after the column was added


def downgrade() -> None:
    op.drop_column("applications", "priority")
'''
    )
    return scripts


@pytest.mark.skipif(not ON_POSTGRES, reason="SQLite does not roll back schema changes")
def test_a_failing_migration_rolls_everything_back(engine, tmp_path):
    migrate_to(engine, HEAD)
    seed_rows(engine)
    scripts = add_broken_migration(tmp_path)

    with pytest.raises(Exception, match="division by zero"):
        upgrade_database(engine, scripts)

    # The half-done step is undone: still at the previous head, no stray column, rows intact.
    assert version(engine) == HEAD
    assert "priority" not in {c["name"] for c in inspect(engine).get_columns("applications")}
    assert counts(engine) == (1, 1, 1)


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
    assert version(engine) == HEAD


# --- 0004: a declined offer used to be recorded as a rejection ---------------


def seed_outcomes(engine) -> None:
    """Four applications as the code before `offer_declined` could have written them."""
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, email, hashed_password, created_at) VALUES (1, 'me@example.com', 'x', '2026-01-01 00:00:00')"))
        apps = [
            (1, "Declined it", "rejected"),  # offer, then "rejected": really the person declining
            (2, "Plain rejection", "rejected"),  # applied, then rejected: a real rejection
            (3, "Still an offer", "offer"),
            (4, "Withdrew after offer", "withdrawn"),  # ambiguous, deliberately left alone
        ]
        for id_, company, status in apps:
            conn.execute(
                text(
                    "INSERT INTO applications (id, user_id, company, role, date_applied, status, created_at, updated_at) "
                    f"VALUES ({id_}, 1, '{company}', 'Engineer', '2026-03-01', '{status}', '2026-03-01 00:00:00', '2026-03-01 00:00:00')"
                )
            )
        history = [
            (1, None, "applied"), (1, "applied", "offer"), (1, "offer", "rejected"),
            (2, None, "applied"), (2, "applied", "rejected"),
            (3, None, "applied"), (3, "applied", "offer"),
            (4, None, "applied"), (4, "applied", "offer"), (4, "offer", "withdrawn"),
        ]  # fmt: skip
        for app_id, from_status, to_status in history:
            frm = "NULL" if from_status is None else f"'{from_status}'"
            conn.execute(
                text(f"INSERT INTO status_changes (application_id, from_status, to_status, changed_at) VALUES ({app_id}, {frm}, '{to_status}', '2026-03-02 00:00:00')")
            )


def statuses(engine) -> dict[int, str]:
    with engine.connect() as conn:
        return {row[0]: row[1] for row in conn.execute(text("SELECT id, status FROM applications ORDER BY id"))}


def transitions(engine, application_id: int) -> list[tuple[str | None, str]]:
    with engine.connect() as conn:
        rows = conn.execute(text(f"SELECT from_status, to_status FROM status_changes WHERE application_id = {application_id} ORDER BY id"))
        return [(r[0], r[1]) for r in rows]


def test_a_rejection_that_followed_an_offer_becomes_a_declined_offer(engine):
    migrate_to(engine, "0003")
    seed_outcomes(engine)

    upgrade_database(engine)

    assert statuses(engine) == {1: "offer_declined", 2: "rejected", 3: "offer", 4: "withdrawn"}
    # The record is corrected too, not just the current value, so the timeline reads true.
    assert transitions(engine, 1) == [(None, "applied"), ("applied", "offer"), ("offer", "offer_declined")]
    assert transitions(engine, 2) == [(None, "applied"), ("applied", "rejected")]  # untouched
    assert transitions(engine, 4) == [(None, "applied"), ("applied", "offer"), ("offer", "withdrawn")]
    with engine.connect() as conn:
        assert schema_differences(conn) == []


def test_the_outcome_migration_is_safe_on_an_empty_database_and_on_rerun(engine):
    upgrade_database(engine)
    upgrade_database(engine)
    assert version(engine) == HEAD


def test_downgrading_maps_the_new_statuses_back_so_older_code_can_read_every_row(engine):
    migrate_to(engine, "0003")
    seed_outcomes(engine)
    upgrade_database(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE applications SET status = 'offer_accepted' WHERE id = 3"))
        conn.execute(text("UPDATE status_changes SET to_status = 'offer_accepted' WHERE application_id = 3 AND to_status = 'offer'"))

    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0003")

    assert version(engine) == "0003"
    assert set(statuses(engine).values()) <= {"applied", "screening", "interview", "offer", "rejected", "withdrawn"}
    assert statuses(engine)[1] == "rejected" and statuses(engine)[3] == "offer"
    assert transitions(engine, 1)[-1] == ("offer", "rejected")


# --- 0005: work mode ---------------------------------------------------------


def test_existing_applications_get_no_work_mode_and_the_upgrade_does_not_error(engine):
    migrate_to(engine, "0004")
    seed_rows(engine)  # an application entered before the field existed

    upgrade_database(engine)

    assert version(engine) == HEAD
    assert counts(engine) == (1, 1, 1)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT work_mode FROM applications")).scalar() is None  # not specified, nothing guessed
        assert conn.execute(text("SELECT company FROM applications")).scalar() == "Acme"
        assert schema_differences(conn) == []


def test_old_code_can_still_add_applications_while_the_new_column_is_live(engine):
    """During a deploy the previous version keeps serving. It doesn't know work_mode; the column must not stop it."""
    migrate_to(engine, "0004")
    seed_rows(engine)
    upgrade_database(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO applications (user_id, company, role, date_applied, status, created_at, updated_at) "
                "VALUES (1, 'Old code', 'Eng', '2026-03-02', 'applied', '2026-03-02 00:00:00', '2026-03-02 00:00:00')"
            )
        )
        assert conn.execute(text("SELECT work_mode FROM applications WHERE company = 'Old code'")).scalar() is None


def test_a_stored_work_mode_survives_the_downgrade_of_a_later_step_and_dropping_it_loses_only_that_column(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE applications SET work_mode = 'hybrid'"))

    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0004")

    assert "work_mode" not in {c["name"] for c in inspect(engine).get_columns("applications")}
    assert counts(engine) == (1, 1, 1)  # every row still there
