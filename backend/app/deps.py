from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
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
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise unauthorized
    user = db.get(User, user_id)
    # A valid token for a since-deleted user must not work.
    if user is None:
        raise unauthorized
    return user
