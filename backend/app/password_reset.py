"""Password reset tokens: issue one, redeem it once.

A reset link carries a random token. We store only its SHA-256 hash (like a
password), so a leaked copy of the database cannot be used to reset anyone's
account. Tokens are long random values, so a fast hash is enough: there is nothing
to brute-force, unlike a human-chosen password.
"""

import hashlib
import logging
import secrets
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.mailer import EmailSender, password_reset_message
from app.models import PasswordResetToken, User

logger = logging.getLogger("joblogga.password_reset")


def utcnow() -> datetime:
    """The current time. Callers use this (not datetime.now) so tests can move the clock."""
    return datetime.now(UTC)


def new_token() -> str:
    return secrets.token_urlsafe(32)  # 256 bits of randomness


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(db: Session, user: User, now: datetime | None = None) -> str:
    """Create a reset token for `user` and return the raw value (to put in the email).

    Only the newest link works: any earlier unused links for this account are
    retired, so asking twice can't leave several live links lying around in an
    inbox. Old, finished tokens are tidied away at the same time. The caller commits.
    """
    now = now or utcnow()
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None)))
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.expires_at < now - timedelta(days=1)))
    raw = new_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(raw),
            created_at=now,
            expires_at=now + timedelta(minutes=settings.password_reset_expire_minutes),
        )
    )
    return raw


def redeem_token(db: Session, raw: str, now: datetime | None = None) -> int | None:
    """Spend a token, returning the id of the user it belongs to, or None.

    None covers every way a token can be bad (never existed, expired, already used)
    without saying which. It is one UPDATE that only matches a token that is unused
    AND unexpired, and marks it used in the same statement. There is no "check, then
    mark" gap for two simultaneous requests to slip through: the database lets exactly
    one of them match. The caller commits (with the password change, so the two
    happen together or not at all).
    """
    now = now or utcnow()
    row = db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.token_hash == hash_token(raw),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(PasswordResetToken.user_id)
        .execution_options(synchronize_session=False)
    ).first()
    return row.user_id if row else None


def send_reset_email_if_account_exists(session_factory: Callable[[], Session], sender: EmailSender, email: str) -> None:
    """Runs AFTER the response has been sent (see the endpoint).

    Whether the address has an account decides whether anything happens here, and
    none of it is visible to the caller: the response was already sent and is the
    same either way, and this work (a lookup, a write, an email) cannot change how
    long it took. Errors are logged, not raised, and never include the address or the link.
    """
    try:
        with session_factory() as db:
            user = db.scalar(select(User).where(User.email == email))
            if user is None:
                return
            raw = issue_token(db, user)
            db.commit()
        link = f"{settings.frontend_base}/reset-password#token={raw}"
        sender.send(password_reset_message(email, link, settings.password_reset_expire_minutes))
    except Exception:
        logger.exception("Sending a password reset email failed")
