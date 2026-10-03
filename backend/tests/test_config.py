import pytest

from app.config import normalize_database_url


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        # What hosts hand out -> the psycopg 3 driver SQLAlchemy needs to be told about
        ("postgres://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("postgresql://u:p@host/db?sslmode=require", "postgresql+psycopg://u:p@host/db?sslmode=require"),
        # Already explicit, or not Postgres: left alone
        ("postgresql+psycopg://u:p@host/db", "postgresql+psycopg://u:p@host/db"),
        ("sqlite:///./joblogga.db", "sqlite:///./joblogga.db"),
        ("sqlite://", "sqlite://"),
    ],
)
def test_normalize_database_url(given, expected):
    assert normalize_database_url(given) == expected


def test_only_the_scheme_is_rewritten():
    # A password or host that happens to contain "postgres://" must not be touched.
    url = "postgres://user:pa@postgres://ss@host/db"
    assert normalize_database_url(url) == "postgresql+psycopg://user:pa@postgres://ss@host/db"


# --- the reminder secret ---------------------------------------------------------


def test_the_reminder_secret_is_optional_and_an_empty_value_means_unset():
    from app.config import Settings

    assert Settings(secret_key="x" * 40, reminder_secret=None).reminder_secret is None
    assert Settings(secret_key="x" * 40, reminder_secret="").reminder_secret is None


def test_a_short_reminder_secret_is_refused_at_startup_rather_than_used():
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError, match="at least 32 characters"):
        Settings(secret_key="x" * 40, reminder_secret="short")
    assert Settings(secret_key="x" * 40, reminder_secret="s" * 32).reminder_secret == "s" * 32
