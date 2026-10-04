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
TABLES = {"users", "applications", "status_changes", "password_reset_tokens", "email_verification_tokens", "countries", "states", "cities", "application_tags", "application_contacts"}


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
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, created_at, updated_at) "
                "VALUES (99, 1, 'Old code', 'Eng', '2026-03-02', 'applied', '2026-03-02 00:00:00', '2026-03-02 00:00:00')"
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


# --- 0006: saved jobs (applied date becomes optional) ------------------------


def date_column_is_nullable(engine) -> bool:
    return next(c for c in inspect(engine).get_columns("applications") if c["name"] == "date_applied")["nullable"]


def test_existing_applications_keep_their_dates_and_the_column_becomes_optional(engine):
    migrate_to(engine, "0005")
    seed_rows(engine)
    assert not date_column_is_nullable(engine)

    upgrade_database(engine)

    assert date_column_is_nullable(engine)
    assert counts(engine) == (1, 1, 1)
    with engine.connect() as conn:
        assert str(conn.execute(text("SELECT date_applied FROM applications")).scalar()) == "2026-03-01"
        assert schema_differences(conn) == []  # models and migrations agree, including the index on the column


def test_a_saved_job_can_be_stored_without_a_date_after_the_upgrade(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, created_at, updated_at) "
                "VALUES (50, 1, 'Wish', 'Eng', NULL, 'saved', '2026-03-02 00:00:00', '2026-03-02 00:00:00')"
            )
        )
        assert conn.execute(text("SELECT COUNT(*) FROM applications WHERE date_applied IS NULL")).scalar() == 1


def test_downgrading_removes_saved_jobs_and_their_history_but_keeps_everything_else(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, created_at, updated_at) "
                "VALUES (50, 1, 'Wish', 'Eng', NULL, 'saved', '2026-03-02 00:00:00', '2026-03-02 00:00:00')"
            )
        )
        conn.execute(text("INSERT INTO status_changes (id, application_id, from_status, to_status, changed_at) VALUES (50, 50, NULL, 'saved', '2026-03-02 00:00:00')"))

    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0005")

    assert version(engine) == "0005"
    assert not date_column_is_nullable(engine)
    assert counts(engine) == (1, 1, 1)  # the dated application and its history are untouched; no orphaned history row


# --- 0007: interview rounds ---------------------------------------------------


def test_existing_applications_have_no_rounds_recorded_after_the_upgrade(engine):
    migrate_to(engine, "0006")
    seed_rows(engine)

    upgrade_database(engine)

    assert version(engine) == HEAD
    with engine.connect() as conn:
        assert conn.execute(text("SELECT interview_round, interview_rounds_total FROM applications")).one() == (None, None)
        assert schema_differences(conn) == []
    assert counts(engine) == (1, 1, 1)


def test_old_code_can_still_add_applications_while_the_round_columns_are_live(engine):
    migrate_to(engine, "0006")
    seed_rows(engine)
    upgrade_database(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, created_at, updated_at) "
                "VALUES (98, 1, 'Old code', 'Eng', '2026-03-02', 'applied', '2026-03-02 00:00:00', '2026-03-02 00:00:00')"
            )
        )
        assert conn.execute(text("SELECT interview_round FROM applications WHERE id = 98")).scalar() is None


def test_downgrading_drops_only_the_round_columns(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE applications SET interview_round = 2, interview_rounds_total = 3"))
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0006")
    columns = {c["name"] for c in inspect(engine).get_columns("applications")}
    assert not {"interview_round", "interview_rounds_total"} & columns
    assert counts(engine) == (1, 1, 1)


# --- 0008: real places, and a structured location ------------------------------

LOCATIONS = ["Springfield", "Remote", "Zürich, Switzerland", "  spaced  ", "東京", "New York, NY / Hybrid", ""]


def seed_locations(engine) -> None:
    """Applications as they were before places existed: whatever people typed."""
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, email, hashed_password, created_at) VALUES (1, 'me@example.com', 'x', '2026-01-01 00:00:00')"))
        for i, value in enumerate(LOCATIONS, start=1):
            conn.execute(
                text(
                    "INSERT INTO applications (id, user_id, company, role, date_applied, status, location, created_at, updated_at) "
                    "VALUES (:id, 1, :company, 'Eng', '2026-03-01', 'applied', :location, '2026-03-01 00:00:00', '2026-03-01 00:00:00')"
                ),
                {"id": i, "company": f"Co {i}", "location": value},
            )
        conn.execute(
            text(
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, location, created_at, updated_at) "
                "VALUES (50, 1, 'No location', 'Eng', '2026-03-01', 'applied', NULL, '2026-03-01 00:00:00', '2026-03-01 00:00:00')"
            )
        )


def stored_locations(engine) -> dict[int, str | None]:
    with engine.connect() as conn:
        return {row[0]: row[1] for row in conn.execute(text("SELECT id, location FROM applications ORDER BY id"))}


def test_every_existing_location_survives_untouched_and_unparsed(engine):
    migrate_to(engine, "0007")
    seed_locations(engine)
    before = stored_locations(engine)

    upgrade_database(engine)

    assert stored_locations(engine) == before  # not one character changed, nothing renamed, nothing "cleverly" parsed
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM applications WHERE country_id IS NOT NULL OR city_id IS NOT NULL")).scalar() == 0
        assert schema_differences(conn) == []


def test_the_upgrade_loads_the_place_tables_from_the_configured_folder(engine):
    upgrade_database(engine)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM countries")).scalar() == 7
        assert conn.execute(text("SELECT COUNT(*) FROM states")).scalar() == 9
        assert conn.execute(text("SELECT COUNT(*) FROM cities")).scalar() == 15
        # trimmed on the way in, accents folded into the search column, an unknown size kept unknown
        assert conn.execute(text("SELECT name, search_name FROM cities WHERE id = 113")).one() == ("Springfield", "springfield")
        assert conn.execute(text("SELECT search_name FROM cities WHERE id = 105")).scalar() == "zurich"
        assert conn.execute(text("SELECT population FROM cities WHERE id = 106")).scalar() is None


def test_the_loaded_places_are_consistent(engine):
    upgrade_database(engine)
    with engine.connect() as conn:
        orphans = conn.execute(
            text(
                "SELECT COUNT(*) FROM cities c JOIN states s ON s.id = c.state_id WHERE s.country_id <> c.country_id"
            )
        ).scalar()
        assert orphans == 0  # every city's state belongs to the city's country


def test_old_code_can_still_add_applications_while_the_new_columns_are_live(engine):
    migrate_to(engine, "0007")
    seed_locations(engine)
    upgrade_database(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, location, created_at, updated_at) "
                "VALUES (97, 1, 'Old code', 'Eng', '2026-03-02', 'applied', 'Paris', '2026-03-02 00:00:00', '2026-03-02 00:00:00')"
            )
        )
        assert conn.execute(text("SELECT country_id, city_id FROM applications WHERE id = 97")).one() == (None, None)


def test_downgrading_keeps_every_location_and_drops_only_the_places(engine):
    upgrade_database(engine)
    seed_locations(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE applications SET country_id = 6, city_id = 108, location = 'Springfield, Illinois, United States' WHERE id = 1"))
    before = stored_locations(engine)

    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0007")

    assert version(engine) == "0007"
    assert stored_locations(engine) == before  # the readable place is still there, structure or not
    assert not {"countries", "states", "cities"} & tables(engine)
    columns = {c["name"] for c in inspect(engine).get_columns("applications")}
    assert not {"country_id", "city_id"} & columns


# --- 0009: archive ------------------------------------------------------------------


def test_existing_applications_are_not_archived_after_the_upgrade(engine):
    migrate_to(engine, "0008")
    seed_rows(engine)
    upgrade_database(engine)
    assert version(engine) == HEAD
    with engine.connect() as conn:
        assert conn.execute(text("SELECT archived_at FROM applications")).scalar() is None  # still in the default list
        assert schema_differences(conn) == []
    assert counts(engine) == (1, 1, 1)


def test_old_code_can_still_add_applications_while_archived_at_is_live(engine):
    migrate_to(engine, "0008")
    seed_rows(engine)
    upgrade_database(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, created_at, updated_at) "
                "VALUES (96, 1, 'Old code', 'Eng', '2026-03-02', 'applied', '2026-03-02 00:00:00', '2026-03-02 00:00:00')"
            )
        )
        assert conn.execute(text("SELECT archived_at FROM applications WHERE id = 96")).scalar() is None


def test_downgrading_drops_only_the_archive_column(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE applications SET archived_at = '2026-04-01 00:00:00'"))
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0008")
    assert "archived_at" not in {c["name"] for c in inspect(engine).get_columns("applications")}
    assert counts(engine) == (1, 1, 1)


# --- 0010: follow-up reminder emails -----------------------------------------------------


def test_every_existing_account_is_off_for_reminders_after_the_upgrade(engine):
    migrate_to(engine, "0009")
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, email, hashed_password, created_at) VALUES (2, 'two@example.com', 'x', '2026-01-02 00:00:00')"))

    upgrade_database(engine)

    assert version(engine) == HEAD
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT reminder_emails, reminder_last_sent_on FROM users ORDER BY id")).all()
        assert [bool(r[0]) for r in rows] == [False, False]  # opt-in only: nobody starts receiving mail because of a deploy
        assert [r[1] for r in rows] == [None, None]
        assert schema_differences(conn) == []


def test_old_code_can_still_add_users_while_the_reminder_columns_are_live(engine):
    migrate_to(engine, "0009")
    upgrade_database(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (email, hashed_password, created_at) VALUES ('old@example.com', 'x', '2026-01-01 00:00:00')"))
        assert bool(conn.execute(text("SELECT reminder_emails FROM users")).scalar()) is False


def test_downgrading_drops_only_the_reminder_columns(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET reminder_emails = :on"), {"on": True})
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0009")
    columns = {c["name"] for c in inspect(engine).get_columns("users")}
    assert not {"reminder_emails", "reminder_last_sent_on"} & columns
    assert counts(engine) == (1, 1, 1)


# --- 0011: tags ----------------------------------------------------------------------------


def test_the_tags_table_is_created_and_existing_applications_simply_have_none(engine):
    migrate_to(engine, "0010")
    seed_rows(engine)
    upgrade_database(engine)
    assert version(engine) == HEAD
    assert "application_tags" in tables(engine)
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM application_tags")).scalar() == 0
        assert schema_differences(conn) == []
    assert counts(engine) == (1, 1, 1)


def test_a_tag_cannot_repeat_on_one_application_and_goes_with_it(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO application_tags (application_id, tag) VALUES (1, 'x')"))
    with pytest.raises(Exception):
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO application_tags (application_id, tag) VALUES (1, 'x')"))
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM applications WHERE id = 1"))
        assert conn.execute(text("SELECT COUNT(*) FROM application_tags")).scalar() == 0  # cascade


def test_downgrading_drops_only_the_tags_table(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO application_tags (application_id, tag) VALUES (1, 'x')"))
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0010")
    assert "application_tags" not in tables(engine)
    assert counts(engine) == (1, 1, 1)


@pytest.mark.skipif(ON_POSTGRES, reason="SQLite's foreign-key switch")
def test_sqlite_enforces_foreign_keys_on_a_connection_that_has_just_run_the_migrations(engine):
    """The migration runner switches enforcement off, and its attempt to restore it is ignored inside a
    transaction. A connection handed out afterwards must still enforce, or cascades silently stop working."""
    upgrade_database(engine)
    seed_rows(engine)
    with engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM users WHERE id = 1"))
        assert conn.execute(text("SELECT COUNT(*) FROM applications")).scalar() == 0  # the cascade fired


# --- 0012: contacts -------------------------------------------------------------------------


def test_the_contacts_table_is_created_empty_and_existing_applications_are_untouched(engine):
    migrate_to(engine, "0011")
    seed_rows(engine)
    upgrade_database(engine)
    assert version(engine) == HEAD
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM application_contacts")).scalar() == 0
        assert schema_differences(conn) == []
    assert counts(engine) == (1, 1, 1)


def test_contacts_go_with_their_application_and_the_downgrade_drops_only_the_table(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO application_contacts (application_id, name) VALUES (1, 'Jane')"))
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM applications WHERE id = 1"))
        assert conn.execute(text("SELECT COUNT(*) FROM application_contacts")).scalar() == 0  # cascade

    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0011")
    assert "application_contacts" not in tables(engine)
    assert counts(engine)[0] == 1  # the user is still there


# --- 0013: salary currency -------------------------------------------------------------------


def test_every_existing_application_becomes_usd_and_none_is_left_null(engine):
    migrate_to(engine, "0012")
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE applications SET salary_min = 100000, salary_max = 120000 WHERE id = 1"))
        conn.execute(
            text(
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, created_at, updated_at) "
                "VALUES (2, 1, 'No salary', 'Eng', '2026-03-02', 'applied', '2026-03-02 00:00:00', '2026-03-02 00:00:00')"
            )
        )

    upgrade_database(engine)

    assert version(engine) == HEAD
    with engine.connect() as conn:
        assert conn.execute(text("SELECT salary_currency FROM applications ORDER BY id")).scalars().all() == ["USD", "USD"]
        assert conn.execute(text("SELECT COUNT(*) FROM applications WHERE salary_currency IS NULL")).scalar() == 0
        assert conn.execute(text("SELECT salary_min, salary_max FROM applications WHERE id = 1")).one() == (100000, 120000)  # the amounts are untouched
        assert schema_differences(conn) == []
    assert counts(engine)[1] == 2


def test_old_code_can_still_add_applications_while_the_currency_column_is_live(engine):
    migrate_to(engine, "0012")
    seed_rows(engine)
    upgrade_database(engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO applications (id, user_id, company, role, date_applied, status, created_at, updated_at) "
                "VALUES (95, 1, 'Old code', 'Eng', '2026-03-02', 'applied', '2026-03-02 00:00:00', '2026-03-02 00:00:00')"
            )
        )
        assert conn.execute(text("SELECT salary_currency FROM applications WHERE id = 95")).scalar() == "USD"


def test_downgrading_drops_only_the_currency_column(engine):
    upgrade_database(engine)
    seed_rows(engine)
    with engine.begin() as conn:
        conn.execute(text("UPDATE applications SET salary_currency = 'EUR', salary_min = 5"))
    with engine.begin() as conn:
        command.downgrade(alembic_config(conn), "0012")
    assert "salary_currency" not in {c["name"] for c in inspect(engine).get_columns("applications")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT salary_min FROM applications")).scalar() == 5
