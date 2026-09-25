from typing import Annotated

from collections.abc import Callable

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal, get_db
from app.mailer import EmailSender, get_email_sender as _get_email_sender
from app.models import User
from app.ratelimit import resolve_client_ip
from app.security import decode_access_token

# Reads the "Authorization: Bearer <token>" header. It also makes Swagger UI
# (/docs) show an "Authorize" button. auto_error=False so we return our own 401.
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    """Dependency for protected routes: resolves the token to a User or raises 401.

    Every future route that returns user data should depend on this and filter
    by `user.id`. That is how per-user data isolation is enforced.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    claims = decode_access_token(credentials.credentials)
    if claims is None:
        raise unauthorized
    user = db.get(User, claims.user_id)
    # A valid token for a since-deleted user must not work, nor one issued before the
    # user's last password reset (their session_version has moved on).
    if user is None or user.session_version != claims.session_version:
        raise unauthorized
    return user


def client_ip(request: Request) -> str:
    """The caller's address, for rate limiting (see resolve_client_ip)."""
    peer = request.client.host if request.client else None
    return resolve_client_ip(
        peer,
        request.headers,
        settings.trusted_proxy_hops,
        (settings.trusted_client_ip_header or "").lower() or None,
    )


def get_email_sender() -> EmailSender:
    """The email sender for this request (a dependency, so tests can swap in a fake)."""
    return _get_email_sender()


def get_session_factory() -> Callable[[], Session]:
    """How background work opens its own database session (it outlives the request's).

    A dependency so tests can point it at the test database."""
    return SessionLocal
