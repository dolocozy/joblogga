from datetime import UTC, datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Unique + indexed: lookups by email happen on every login, and the unique
    # constraint is the real guard against duplicate accounts (even under races).
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    # Only ever the bcrypt hash. The plaintext password is never stored or logged.
    hashed_password: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC))
