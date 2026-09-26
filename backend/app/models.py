import enum
import secrets
from datetime import UTC, date, datetime

from sqlalchemy import Date, Enum, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, UtcDateTime
from app.geo import place_label


def _now() -> datetime:
    return datetime.now(UTC)


def _new_session_version() -> int:
    return secrets.randbelow(2**30)  # fits a 32-bit column with room for the resets that bump it


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
    # password change. New accounts start at a random value, not 0: a database may
    # hand a deleted account's id to the next signup (SQLite does), and the old
    # token must not then open the new account. The server default lets code from
    # before this column existed keep inserting users during a deploy.
    session_version: Mapped[int] = mapped_column(default=_new_session_version, server_default="0")
    # When the owner proved they can read mail sent to this address (by opening a
    # verification link, or by completing a password reset, which is the same proof).
    # NULL means not yet. Accounts that existed before verification was added were
    # marked verified by the migration.
    email_verified_at: Mapped[datetime | None] = mapped_column(UtcDateTime)

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


class Country(Base):
    """A country or territory, loaded once from the vendored dataset (see app/geo.py).

    The primary key is the dataset's own id, not a number we generate: an application that
    points at a country points at that exact dataset row.
    """

    __tablename__ = "countries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(120))
    iso2: Mapped[str | None] = mapped_column(String(2))
    iso3: Mapped[str | None] = mapped_column(String(3))


class State(Base):
    """A state, province, region or similar: the first division under a country."""

    __tablename__ = "states"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    country_id: Mapped[int] = mapped_column(ForeignKey("countries.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))

    country: Mapped[Country] = relationship(lazy="joined", innerjoin=True)


class City(Base):
    """A city, town or district. Every city belongs to exactly one state, so picking a city fixes the state too."""

    __tablename__ = "cities"
    # Autocomplete asks "in this country, names starting with ...": one index answers it.
    __table_args__ = (Index("ix_cities_country_id_search_name", "country_id", "search_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    state_id: Mapped[int] = mapped_column(ForeignKey("states.id"), index=True)
    country_id: Mapped[int] = mapped_column(ForeignKey("countries.id"))
    name: Mapped[str] = mapped_column(String(120))
    # The name lower-cased with accents removed (app.geo.search_key): what searches are matched against.
    search_name: Mapped[str] = mapped_column(String(120), index=True)
    # For ranking matches, biggest first. Unknown for some places.
    population: Mapped[int | None] = mapped_column()

    state: Mapped[State] = relationship(lazy="joined", innerjoin=True)
    country: Mapped[Country] = relationship(lazy="joined", innerjoin=True)


class ApplicationStatus(enum.StrEnum):
    """The pipeline stages. Declaration order is the typical progression."""

    # A job you are interested in but have not applied to. It has no applied date, and it is
    # left out of every applied-only figure (see docs/status-audit.md).
    SAVED = "saved"
    APPLIED = "applied"
    SCREENING = "screening"
    INTERVIEW = "interview"
    OFFER = "offer"
    # Two endings that follow an offer. Declining is YOUR decision, not the employer's
    # rejection, so it has its own status (see docs/status-audit.md).
    OFFER_ACCEPTED = "offer_accepted"
    OFFER_DECLINED = "offer_declined"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class WorkMode(enum.StrEnum):
    """Where the job is done. Optional on an application: plenty of postings don't say."""

    REMOTE = "remote"
    HYBRID = "hybrid"
    IN_PERSON = "in_person"


def _work_mode_enum() -> Enum:
    # A plain string like the status, so a new value later is a code change, not a migration.
    return Enum(WorkMode, native_enum=False, length=20, values_callable=lambda e: [m.value for m in e])


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
    # NULL only while the job is Saved: there is no real "applied on" date until you apply.
    # Leaving Saved fills it in (today, unless one was given).
    date_applied: Mapped[date | None] = mapped_column(Date, index=True)
    resume_version: Mapped[str | None] = mapped_column(String(100))
    salary_min: Mapped[int | None] = mapped_column()
    salary_max: Mapped[int | None] = mapped_column()
    # The readable place. For a picked city it is generated ("Springfield, Illinois, United States");
    # otherwise it is whatever was typed. Existing applications' free text stays exactly as it was.
    location: Mapped[str | None] = mapped_column(String(200))
    # The structure behind it, when a place was picked from the dataset. A city fixes its country.
    # SET NULL: if a dataset row ever went away, the application keeps its readable location text.
    country_id: Mapped[int | None] = mapped_column(ForeignKey("countries.id", ondelete="SET NULL"), index=True)
    city_id: Mapped[int | None] = mapped_column(ForeignKey("cities.id", ondelete="SET NULL"), index=True)
    # NULL means "not specified", which is the honest default: nothing forces a guess.
    work_mode: Mapped[WorkMode | None] = mapped_column(_work_mode_enum())
    notes: Mapped[str | None] = mapped_column(Text)
    # Lightweight interview progress: "round 2 of 3". Both optional and independent of the status:
    # they keep their last values after the application moves on, as a record of how far it got.
    interview_round: Mapped[int | None] = mapped_column()
    interview_rounds_total: Mapped[int | None] = mapped_column()

    status: Mapped[ApplicationStatus] = mapped_column(_status_enum(), index=True)
    follow_up_date: Mapped[date | None] = mapped_column(Date, index=True)

    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now, onupdate=_now)

    country: Mapped[Country | None] = relationship(lazy="joined")
    city: Mapped[City | None] = relationship(lazy="joined")

    @property
    def location_display(self) -> str | None:
        """The place as it reads everywhere it is shown.

        A picked city: "Springfield, Illinois, United States" (its state is part of it, so two
        Springfields never look alike). A country with a typed place: "Somewhere, Canada". A country
        alone: "Canada". Otherwise the typed text, exactly as entered.
        """
        if self.city is not None and self.country is not None:
            return place_label(self.city.name, self.city.state.name, self.country.name)
        if self.country is not None:
            return place_label(self.location, None, self.country.name) if self.location else self.country.name
        return self.location

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


class EmailVerificationToken(Base):
    """A one-time link that proves an address belongs to the person who signed up.

    Stored exactly like a password reset token: only the hash, so a copy of this
    table cannot be used to verify (or take over) anything.
    """

    __tablename__ = "email_verification_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=_now)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
