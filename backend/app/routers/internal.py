"""Endpoints for our own automation, not for people. Hidden from the API docs."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app import ratelimit, reminders
from app.config import settings
from app.db import get_db
from app.deps import client_ip, get_email_sender
from app.mailer import EmailSender, UnconfiguredSender
from app.routers.auth import too_many_attempts
from app.schemas import ReminderRunOut

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


@router.post("/send-follow-up-reminders", response_model=ReminderRunOut)
def send_follow_up_reminders(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    ip: Annotated[str, Depends(client_ip)],
    sender: Annotated[EmailSender, Depends(get_email_sender)],
    x_reminder_secret: Annotated[str | None, Header()] = None,
    limit: Annotated[int, Query(ge=1, le=500, description="Most digests to send in this call; the reply says if more remain")] = 200,
) -> ReminderRunOut:
    """Send today's follow-up digests. Called once a day by a GitHub Actions workflow, authenticated by a shared secret.

    Safe to call again: each user gets at most one digest per day, so a retry sends nothing twice.
    """
    # Fails closed: with no secret configured nobody can trigger this, not even with an empty header.
    if not settings.reminder_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Reminders are not configured")
    blocked = ratelimit.limits.check_internal_secret(ip)
    if blocked:
        raise too_many_attempts(request, blocked[0], ip, blocked[1])
    # Compared in constant time, so the response time says nothing about how much of a guess was right.
    if not x_reminder_secret or not hmac.compare_digest(x_reminder_secret.encode(), settings.reminder_secret.encode()):
        ratelimit.limits.record_internal_secret_failure(ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid secret")
    # Without an email key every "send" is a no-op that would still use up the day's claim: refuse instead.
    if isinstance(sender, UnconfiguredSender):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Email is not configured")
    run = reminders.run_follow_up_digests(db, sender, limit=limit)
    return ReminderRunOut(date=run.date, sent=run.sent, failed=run.failed, skipped_unverified=run.skipped_unverified, remaining=run.remaining)
