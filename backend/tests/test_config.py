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
