from collections.abc import Callable
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app import password_reset, ratelimit
from app.config import settings
from app.deps import client_ip, get_current_user, get_email_sender, get_session_factory
from app.mailer import EmailSender
from app.models import PasswordResetToken, User
from app.schemas import LoginRequest, MessageResponse, PasswordResetConfirm, PasswordResetRequest, SignupRequest, TokenResponse, UserOut
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


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def signup(body: SignupRequest, db: DbSession, request: Request, ip: ClientIp) -> User:
    blocked = ratelimit.limits.check_signup(ip)
    if blocked:
        raise too_many_attempts(request, blocked[0], ip, blocked[1])
    ratelimit.limits.record_signup(ip)  # every attempt counts, including duplicates
    user = User(email=body.email, hashed_password=hash_password(body.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # The unique constraint fired. Relying on it (instead of "SELECT then
        # INSERT") stays correct even if two signups race.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already registered")
    return user


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
    # Ends every login session issued before now: someone holding a stolen token
    # is signed out the moment the owner changes the password.
    user.session_version += 1
    # Any other unused links for this account (there should be none) die with this one.
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None)))
    db.commit()  # the token is spent and the password changed together, or neither
    return MessageResponse(detail="Your password has been updated. You can log in with it now.")
