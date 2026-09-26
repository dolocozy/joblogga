from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app import email_verification, password_reset, ratelimit
from app.config import settings
from app.deps import client_ip, get_current_user, get_email_sender, get_session_factory
from app.mailer import EmailSender
from app.models import PasswordResetToken, User
from app.schemas import (
    EmailVerificationConfirm,
    LoginRequest,
    MessageResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    SignupRequest,
    TokenResponse,
    UserOut,
)
from app.security import DUMMY_HASH, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

DbSession = Annotated[Session, Depends(get_db)]
ClientIp = Annotated[str, Depends(client_ip)]


def too_many_attempts(request: Request, scope: str, ip: str, retry_after: int) -> HTTPException:
    ratelimit.log_refusal(
        scope,
        ip,
        request.headers,
        settings.trusted_proxy_hops,
        (settings.trusted_client_ip_header or "").lower() or None,
    )
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        detail=ratelimit.wait_message(retry_after),
        headers={"Retry-After": str(retry_after)},
    )


def _signup_reply() -> str:
    return "Almost there. Check your email for a link to verify your address."


@router.post("/signup", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
def signup(
    body: SignupRequest,
    background: BackgroundTasks,
    request: Request,
    ip: ClientIp,
    sender: Annotated[EmailSender, Depends(get_email_sender)],
    session_factory: Annotated[Callable[[], Session], Depends(get_session_factory)],
) -> MessageResponse:
    """Start an account: the person gets an email either way, and this reply never varies.

    The same status and body come back whether the address is new, unverified or already
    registered, and this function touches neither the database nor bcrypt: creating the
    account, or noticing it exists, happens in a background task once the reply is on
    its way. So neither the answer nor its timing can be used to find out who has an
    account (the old "409 Email already registered" could). Nobody is logged in here:
    the person logs in after, and can do so before verifying (see the /auth/me banner).
    """
    blocked = ratelimit.limits.check_signup(ip)
    if blocked:
        raise too_many_attempts(request, blocked[0], ip, blocked[1])
    ratelimit.limits.record_signup(ip)  # every attempt counts, whatever the address
    if ratelimit.limits.signup_mail_allowed(body.email):
        background.add_task(email_verification.register_or_notify, session_factory, sender, body.email, body.password)
    return MessageResponse(detail=_signup_reply())


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: DbSession, request: Request, ip: ClientIp) -> TokenResponse:
    # Refuse before checking the password: a locked-out caller learns nothing
    # about whether a guess was right, and we skip the (deliberately slow) hash.
    blocked = ratelimit.limits.check_login(ip, body.email)
    if blocked:
        raise too_many_attempts(request, blocked[0], ip, blocked[1])
    user = db.scalar(select(User).where(User.email == body.email))
    # Always run one bcrypt verify, and give one generic error either way, so a
    # caller can't tell "no such email" from "wrong password".
    password_ok = verify_password(body.password, user.hashed_password if user else DUMMY_HASH)
    if user is None or not password_ok:
        # Counted whether or not the email exists, so the limit itself can't be
        # used to find out which emails are registered.
        ratelimit.limits.record_login_failure(ip, body.email)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    ratelimit.limits.record_login_success(ip, body.email)
    return TokenResponse(access_token=create_access_token(user.id, user.session_version))


@router.get("/me", response_model=UserOut)
def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user


# One reply for every request, whether or not the address has an account.
def _reset_request_reply() -> str:
    return (
        "If an account exists for that email, a reset link is on its way. "
        f"It works for {settings.password_reset_expire_minutes} minutes."
    )


INVALID_RESET_LINK = "This reset link is invalid or has expired. Please request a new one."


@router.post("/password-reset/request", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
def request_password_reset(
    body: PasswordResetRequest,
    background: BackgroundTasks,
    request: Request,
    ip: ClientIp,
    sender: Annotated[EmailSender, Depends(get_email_sender)],
    session_factory: Annotated[Callable[[], Session], Depends(get_session_factory)],
) -> MessageResponse:
    """Email a password reset link, if the address has an account.

    Deliberately identical for every address: same status, same body, same work
    before the reply. This function does no database access at all; the lookup,
    the token and the email happen in a background task once the reply is on its
    way, so neither the answer nor how long it takes can reveal whether an account
    exists. The rate limit counts every request the same way for the same reason.
    """
    blocked = ratelimit.limits.check_reset(ip, body.email)
    if blocked:
        raise too_many_attempts(request, blocked[0], ip, blocked[1])
    ratelimit.limits.record_reset(ip, body.email)
    background.add_task(password_reset.send_reset_email_if_account_exists, session_factory, sender, body.email)
    return MessageResponse(detail=_reset_request_reply())


@router.post("/password-reset/confirm", response_model=MessageResponse)
def confirm_password_reset(body: PasswordResetConfirm, db: DbSession, request: Request, ip: ClientIp) -> MessageResponse:
    """Choose a new password using a reset link's token."""
    blocked = ratelimit.limits.check_reset_confirm(ip)
    if blocked:
        raise too_many_attempts(request, blocked[0], ip, blocked[1])

    user_id = password_reset.redeem_token(db, body.token)
    user = db.get(User, user_id) if user_id is not None else None
    if user is None:
        db.rollback()
        ratelimit.limits.record_reset_confirm_failure(ip)
        # One message for a token that never existed, expired, or was already used.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=INVALID_RESET_LINK)

    user.hashed_password = hash_password(body.password)
    # A working reset link proves the person reads this inbox, which is all verification proves.
    if user.email_verified_at is None:
        user.email_verified_at = password_reset.utcnow()
    # Ends every login session issued before now: someone holding a stolen token
    # is signed out the moment the owner changes the password.
    user.session_version += 1
    # Any other unused links for this account (there should be none) die with this one.
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None)))
    db.commit()  # the token is spent and the password changed together, or neither
    return MessageResponse(detail="Your password has been updated. You can log in with it now.")


INVALID_VERIFICATION_LINK = "This verification link is invalid or has expired. Log in to request a new one."


@router.post("/verify-email/confirm", response_model=MessageResponse)
def confirm_email_verification(body: EmailVerificationConfirm, db: DbSession, request: Request, ip: ClientIp) -> MessageResponse:
    """Redeem a verification link. The token is the credential, so no login is needed
    (people often open the email on a different device)."""
    blocked = ratelimit.limits.check_verify_confirm(ip)
    if blocked:
        raise too_many_attempts(request, blocked[0], ip, blocked[1])
    if email_verification.redeem_token(db, body.token) is None:
        db.rollback()
        ratelimit.limits.record_verify_confirm_failure(ip)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=INVALID_VERIFICATION_LINK)
    db.commit()
    return MessageResponse(detail="Your email address is verified.")


@router.post("/verify-email/resend", response_model=MessageResponse, status_code=status.HTTP_202_ACCEPTED)
def resend_verification(
    user: Annotated[User, Depends(get_current_user)],
    background: BackgroundTasks,
    request: Request,
    ip: ClientIp,
    db: DbSession,
    sender: Annotated[EmailSender, Depends(get_email_sender)],
) -> MessageResponse:
    """Send a fresh verification link to the logged-in user's own address.

    Needs a login, so it can only ever mail the caller's own inbox and can say plainly
    whether the address is already verified without revealing anything about anyone else.
    """
    if user.email_verified:
        return MessageResponse(detail="Your email address is already verified.")
    blocked = ratelimit.limits.check_verify_resend(user.id)
    if blocked:
        raise too_many_attempts(request, blocked[0], ip, blocked[1])
    ratelimit.limits.record_verify_resend(user.id)
    raw = email_verification.issue_token(db, user)
    db.commit()
    background.add_task(email_verification.send_verification_email, sender, user.email, raw)
    return MessageResponse(detail="We've sent a new verification link to your email address.")
