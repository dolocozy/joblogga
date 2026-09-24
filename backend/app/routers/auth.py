from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app import ratelimit
from app.config import settings
from app.deps import client_ip, get_current_user
from app.models import User
from app.schemas import LoginRequest, SignupRequest, TokenResponse, UserOut
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
    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserOut)
def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user
