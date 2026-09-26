"""Email verification: prove an address belongs to the person who signed up.

Tokens work like password reset tokens (see password_reset.py): 256 random bits in
the link, only the SHA-256 hash stored, spent by one atomic UPDATE. They are random
and looked up rather than a signed blob (a JWT) on purpose: a stored token can be
retired (only the newest link works), is single-use, and needs no signing key.
"""

import logging
from collections.abc import Callable
from datetime import datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.mailer import EmailSender, already_registered_message, verification_message
from app.models import EmailVerificationToken, User
from app.password_reset import hash_token, new_token, utcnow
from app.security import hash_password

logger = logging.getLogger("joblogga.email_verification")


def issue_token(db: Session, user: User, now: datetime | None = None) -> str:
    """Create a verification token for `user`, returning the raw value for the email.

    Only the newest link works: earlier unused ones are retired. Finished tokens
    older than a day are tidied away. The caller commits.
    """
    now = now or utcnow()
    db.execute(delete(EmailVerificationToken).where(EmailVerificationToken.user_id == user.id, EmailVerificationToken.used_at.is_(None)))
    db.execute(delete(EmailVerificationToken).where(EmailVerificationToken.expires_at < now - timedelta(days=1)))
    raw = new_token()
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token_hash=hash_token(raw),
            created_at=now,
            expires_at=now + timedelta(hours=settings.email_verification_expire_hours),
        )
    )
    return raw


def redeem_token(db: Session, raw: str, now: datetime | None = None) -> int | None:
    """Spend a token and mark its owner verified. Returns the user id, or None.

    None covers every way a token can be bad (unknown, expired, used) without saying
    which. One UPDATE matches only an unused, unexpired token and spends it in the
    same statement, so two simultaneous requests cannot both succeed. The caller commits.
    """
    now = now or utcnow()
    row = db.execute(
        update(EmailVerificationToken)
        .where(
            EmailVerificationToken.token_hash == hash_token(raw),
            EmailVerificationToken.used_at.is_(None),
            EmailVerificationToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(EmailVerificationToken.user_id)
        .execution_options(synchronize_session=False)
    ).first()
    if row is None:
        return None
    # Keeps the first verification time if the address was already verified some other way.
    db.execute(
        update(User).where(User.id == row.user_id, User.email_verified_at.is_(None)).values(email_verified_at=now).execution_options(synchronize_session=False)
    )
    return row.user_id


def verification_link(raw: str) -> str:
    return f"{settings.frontend_base}/verify-email#token={raw}"


def send_verification_email(sender: EmailSender, email: str, raw: str) -> None:
    sender.send(verification_message(email, verification_link(raw), settings.email_verification_expire_hours))


def register_or_notify(session_factory: Callable[[], Session], sender: EmailSender, email: str, password: str) -> None:
    """Everything a signup does, run AFTER the reply has gone out.

    The signup endpoint answers identically for every address and does no database
    work itself, so nothing about the answer or its timing can reveal whether the
    address was already registered. What happens here differs:

    - new address: the account is created (unverified) and sent a verification link;
    - address with an unverified account: sent a fresh link, nothing else changes
      (in particular the password is NOT replaced, or a stranger could take over
      an account someone is already using by signing up again with its address);
    - address with a verified account: sent a "you already have an account" note.

    Errors are logged, never raised, and never include the address or a link.
    """
    try:
        hashed = hash_password(password)  # slow on purpose; here it delays no reply
        with session_factory() as db:
            user = db.scalar(select(User).where(User.email == email))
            if user is None:
                db.add(User(email=email, hashed_password=hashed))
                try:
                    db.commit()
                except IntegrityError:
                    # A simultaneous signup got there first. The unique constraint
                    # decides, so this stays correct without a lock.
                    db.rollback()
                user = db.scalar(select(User).where(User.email == email))
            if user is None:
                return
            if user.email_verified:
                message = already_registered_message(email, f"{settings.frontend_base}/login", f"{settings.frontend_base}/forgot-password")
                raw = None
            else:
                raw = issue_token(db, user)
                db.commit()
                message = None
        if raw is not None:
            send_verification_email(sender, email, raw)
        elif message is not None:
            sender.send(message)
    except Exception:
        logger.exception("Signup processing failed")
