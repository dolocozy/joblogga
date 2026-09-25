import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime

from sqlalchemy import DateTime, Engine, TypeDecorator, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

# SQLite only allows a connection to be used by the thread that created it, but
# FastAPI may run a request's code on different threads, so we relax that check.
# It's safe here because each request gets its own session (see get_db).
_is_sqlite = settings.sqlalchemy_url.startswith("sqlite")
_connect_args = {"check_same_thread": False} if _is_sqlite else {}
# Hosted Postgres (Neon) suspends an idle database after a few minutes and drops
# its connections. pool_pre_ping tests a pooled connection before using it, and
# pool_recycle retires connections before the host would, so the first request
# after a quiet spell reconnects instead of failing.
_pool_options = {} if _is_sqlite else {"pool_pre_ping": True, "pool_recycle": 300}

engine = create_engine(settings.sqlalchemy_url, connect_args=_connect_args, **_pool_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@event.listens_for(Engine, "connect")
def _enforce_foreign_keys_on_sqlite(dbapi_connection, _record) -> None:
    """SQLite ignores foreign keys (and so ON DELETE CASCADE) unless told otherwise,
    once per connection. Postgres always enforces them, so without this the local
    database would quietly allow orphaned rows that production would never hold."""
    if isinstance(dbapi_connection, sqlite3.Connection):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


class UtcDateTime(TypeDecorator):
    """A timestamp that is always timezone-aware UTC in Python.

    SQLite has no time zone support: it stores the time and hands back a *naive*
    datetime, which the API would serialize without a "Z" and browsers would then
    read as local time. Postgres would behave differently, so we normalise here:
    store UTC, and re-attach UTC when reading. Same behavior on both databases.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("Naive datetime: timestamps must be timezone-aware")
        return value.astimezone(UTC)

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one DB session per request, always closed afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
