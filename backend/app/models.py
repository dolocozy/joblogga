import enum
from datetime import UTC, date, datetime

from sqlalchemy import Date, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UtcDateTime


def _now() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Unique + indexed: lookups by email happen on every login, and the unique
    # constraint is the real guard against duplicate accounts (even under races).
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    # Only ever the bcrypt hash. The plaintext password is never stored or logged.
    hashed_password: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    # Baked into every login token. Bumping it (a password reset does) makes all
    # tokens issued before that stop working, so a stolen session cannot outlive a
    # password change. The server default lets code from before this column existed
    # keep inserting users during a deploy.
    session_version: Mapped[int] = mapped_column(default=0, server_default="0")


class ApplicationStatus(enum.StrEnum):
    """The pipeline stages. Declaration order is the typical progression."""

    APPLIED = "applied"
    SCREENING = "screening"
    INTERVIEW = "interview"
    OFFER = "offer"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


def _status_enum() -> Enum:
    # Stored as a plain string (native_enum=False), not a Postgres ENUM type:
    # adding a status later is then a code change, not a database migration.
    return Enum(
        ApplicationStatus,
        native_enum=False,
        length=20,
        values_callable=lambda e: [m.value for m in e],
    )


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Every query on this table filters by user_id: that is the data-isolation
    # boundary. ondelete=CASCADE so deleting a user removes their data.
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    company: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(200))
    job_url: Mapped[str | None] = mapped_column(String(2048))
    date_applied: Mapped[date] = mapped_column(Date, index=True)
    resume_version: Mapped[str | None] = mapped_column(String(100))
    salary_min: Mapped[int | None] = mapped_column()
    salary_max: Mapped[int | None] = mapped_column()
    location: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)

    status: Mapped[ApplicationStatus] = mapped_column(_status_enum(), index=True)
    follow_up_date: Mapped[date | None] = mapped_column(Date, index=True)

    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now, onupdate=_now)

    history: Mapped[list["StatusChange"]] = relationship(
        back_populates="application",
        order_by="StatusChange.id",
        # Deleting an application deletes its history rows too.
        cascade="all, delete-orphan",
    )


class StatusChange(Base):
    """One row per status transition: an append-only audit log.

    Kept separate from Application.status (which is just the *current* value) so
    we never lose the timeline, e.g. "applied Mar 3, interview Mar 20".
    """

    __tablename__ = "status_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[int] = mapped_column(
        ForeignKey("applications.id", ondelete="CASCADE"), index=True
    )
    # NULL for the first row, which records the application's initial status.
    from_status: Mapped[ApplicationStatus | None] = mapped_column(_status_enum())
    to_status: Mapped[ApplicationStatus] = mapped_column(_status_enum())
    changed_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)

    application: Mapped[Application] = relationship(back_populates="history")


class PasswordResetToken(Base):
    """A one-time link that lets someone choose a new password.

    Only a hash of the token is stored, like a password: the raw token exists only
    in the email, so a copy of this table cannot be used to take over accounts.
    """

    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # SHA-256 of the token, in hex. Unique and indexed: redeeming looks it up.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)
    # Set the moment the token is redeemed; a token with a value here is spent.
    used_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
