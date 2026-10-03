"""The daily follow-up digest: who is due an email, and sending it exactly once.

Render's free plan has no cron, so a GitHub Actions workflow calls POST /internal/send-follow-up-reminders once a
day (see .github/workflows/follow-up-reminders.yml). Everything that decides what gets sent is here, apart from
the endpoint, so it can be tested directly.

The rules:
- opt-in only: `users.reminder_emails` is false until the user turns it on;
- verified addresses only: an unverified address is counted and skipped, never emailed;
- the digest covers open, non-archived applications whose follow-up date is today or earlier (overdue ones keep
  appearing each day until the date or status is changed: that is the point of a reminder);
- one email per user per day, however many things are due, and never a second one for the same day: the day is
  claimed in one UPDATE before sending, so a retried or double-fired run cannot send twice. If the send fails,
  the claim is released so the next run can try again.
"""

import base64
import hashlib
import hmac
import logging
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.mailer import DigestItem, EmailSender, follow_up_digest_message
from app.models import CLOSED_STATUSES, Application, User

logger = logging.getLogger("joblogga.reminders")

# How many items one email lists. The rest are counted ("and 12 more"): a screenful is what is useful.
MAX_LISTED = 20
# A breather between emails, so a long run stays well under the email service's rate limit.
SEND_PAUSE_SECONDS = 0.2


def today() -> date:
    """The date reminders are judged against: UTC, because the job runs at one fixed UTC time. Tests move it."""
    return datetime.now(UTC).date()


def _label(status) -> str:
    return status.value.replace("_", " ").capitalize()


# --- the unsubscribe link ----------------------------------------------------------


def unsubscribe_token(user_id: int) -> str:
    """"<user id>.<signature>": proves a link came from us, so it can switch off one account's reminders with no login.

    Signed with the app's secret key (with a purpose in the signed text, so the signature is good for nothing else).
    It never expires, deliberately: an old email must still be able to stop the emails. All it can do is turn
    reminders off, so a leaked link is a nuisance, not a risk.
    """
    mac = hmac.new(settings.secret_key.encode(), f"unsubscribe-reminders:{user_id}".encode(), hashlib.sha256).digest()
    return f"{user_id}.{base64.urlsafe_b64encode(mac).decode().rstrip('=')}"


def user_id_from_unsubscribe_token(token: str) -> int | None:
    """The user the token is for, or None for anything that is not a valid token (never says why)."""
    head, _, _ = token.partition(".")
    if not head.isascii() or not head.isdigit() or len(head) > 12:
        return None
    return int(head) if hmac.compare_digest(token.encode(), unsubscribe_token(int(head)).encode()) else None


# --- the run ------------------------------------------------------------------------


@dataclass
class RunResult:
    date: date
    sent: int = 0
    failed: int = 0
    skipped_unverified: int = 0
    remaining: int = 0


@dataclass
class _Due:
    user_id: int
    email: str
    verified: bool
    last_sent_on: date | None
    items: list[DigestItem]


def _users_with_something_due(db: Session, on: date) -> list[_Due]:
    """Opted-in users who have not had today's digest and have at least one open follow-up due, by user id."""
    rows = db.execute(
        select(
            User.id,
            User.email,
            User.email_verified_at.is_not(None),
            User.reminder_last_sent_on,
            Application.company,
            Application.role,
            Application.status,
            Application.follow_up_date,
        )
        .join(Application, Application.user_id == User.id)
        .where(
            User.reminder_emails.is_(True),
            or_(User.reminder_last_sent_on.is_(None), User.reminder_last_sent_on < on),
            Application.follow_up_date.is_not(None),
            Application.follow_up_date <= on,
            Application.status.not_in(CLOSED_STATUSES),
            Application.archived_at.is_(None),  # archived means "stop showing me this"
        )
        .order_by(User.id, Application.follow_up_date, Application.id)
    )
    users: dict[int, _Due] = {}
    for user_id, email, verified, last_sent_on, company, role, status, due_on in rows:
        due = users.setdefault(user_id, _Due(user_id, email, bool(verified), last_sent_on, []))
        due.items.append(DigestItem(company, role, _label(status), (on - due_on).days))
    return list(users.values())


def run_follow_up_digests(db: Session, sender: EmailSender, on: date | None = None, limit: int = 200) -> RunResult:
    """Email each eligible user one digest. At most `limit` users per call; `remaining` says if more are waiting."""
    on = on or today()
    result = RunResult(date=on)
    due = _users_with_something_due(db, on)
    result.skipped_unverified = sum(1 for d in due if not d.verified)
    eligible = [d for d in due if d.verified]
    batch, result.remaining = eligible[:limit], max(0, len(eligible) - limit)

    for position, user in enumerate(batch):
        # Claim today for this user in one statement. If the row no longer matches (a parallel run got there first,
        # or they just switched reminders off) nothing is claimed and nothing is sent.
        claimed = db.execute(
            update(User)
            .where(
                User.id == user.user_id,
                User.reminder_emails.is_(True),
                User.email_verified_at.is_not(None),
                or_(User.reminder_last_sent_on.is_(None), User.reminder_last_sent_on < on),
            )
            .values(reminder_last_sent_on=on)
            .execution_options(synchronize_session=False)
        ).rowcount
        db.commit()
        if not claimed:
            continue
        try:
            sender.send(
                follow_up_digest_message(
                    user.email,
                    user.items[:MAX_LISTED],
                    len(user.items),
                    f"{settings.frontend_base}/applications",
                    f"{settings.frontend_base}/account",
                    f"{settings.frontend_base}/unsubscribe#token={unsubscribe_token(user.user_id)}",
                )
            )
            result.sent += 1
        except Exception:
            # Never the address or the contents in the log. The claim is given back so the next run tries again.
            logger.exception("Sending a follow-up digest failed")
            db.execute(
                update(User)
                .where(User.id == user.user_id, User.reminder_last_sent_on == on)
                .values(reminder_last_sent_on=user.last_sent_on)
                .execution_options(synchronize_session=False)
            )
            db.commit()
            result.failed += 1
        if position < len(batch) - 1:
            time.sleep(SEND_PAUSE_SECONDS)
    return result
