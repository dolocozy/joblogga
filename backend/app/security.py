from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.config import settings


def hash_password(password: str) -> str:
    # bcrypt generates a random salt and embeds it in the hash, so identical
    # passwords produce different hashes and no separate salt column is needed.
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


# A real bcrypt hash of a throwaway value. When a login names an email that
# doesn't exist we still run a verify against this, so "unknown email" and
# "wrong password" take about the same time. Otherwise response time would let
# an attacker discover which emails are registered.
DUMMY_HASH = hash_password("not-a-real-password")


@dataclass(frozen=True)
class TokenClaims:
    user_id: int
    session_version: int


def create_access_token(user_id: int, session_version: int = 0) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),  # "subject": whose token this is (JWT spec wants a string)
        # Must still equal the user's current session_version to be accepted, so a
        # password reset (which bumps it) ends every session issued before it.
        "sv": session_version,
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> TokenClaims | None:
    """Return the token's claims if it is validly signed and unexpired, else None."""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            # Pin the allowed algorithm: never trust the token's own header to pick it.
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub"]},
        )
        # Tokens issued before session versions existed have no claim: they count as version 0,
        # so deploying this did not log anyone out.
        return TokenClaims(user_id=int(payload["sub"]), session_version=int(payload.get("sv", 0)))
    except (jwt.PyJWTError, ValueError):
        return None
