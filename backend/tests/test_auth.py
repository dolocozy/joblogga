from datetime import UTC, datetime, timedelta

import jwt

from app.config import settings
from app.db import get_db
from app.main import app
from app.models import User
from app.security import create_access_token, verify_password

CREDS = {"email": "me@example.com", "password": "correct-horse-battery"}


def signup(client, **overrides):
    return client.post("/auth/signup", json={**CREDS, **overrides})


def login(client, **overrides):
    return client.post("/auth/login", json={**CREDS, **overrides})


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


# --- signup -----------------------------------------------------------------


def test_signup_creates_user_without_leaking_password(client):
    res = signup(client)
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == CREDS["email"]
    assert "id" in body and "created_at" in body
    assert "password" not in body and "hashed_password" not in body


def test_signup_stores_bcrypt_hash_not_plaintext(client):
    signup(client)
    db = next(app.dependency_overrides[get_db]())
    user = db.query(User).one()
    assert user.hashed_password != CREDS["password"]
    assert user.hashed_password.startswith("$2")  # bcrypt marker
    assert verify_password(CREDS["password"], user.hashed_password)


def test_signup_duplicate_email_conflicts(client):
    signup(client)
    assert signup(client).status_code == 409


def test_signup_email_is_case_insensitive(client):
    signup(client, email="Me@Example.com")
    assert signup(client, email="me@example.COM").status_code == 409


def test_signup_rejects_short_password(client):
    assert signup(client, password="short").status_code == 422


def test_signup_rejects_overlong_password(client):
    assert signup(client, password="x" * 73).status_code == 422


def test_signup_rejects_invalid_email(client):
    assert signup(client, email="not-an-email").status_code == 422


# --- login ------------------------------------------------------------------


def test_login_returns_working_token(client):
    signup(client)
    res = login(client)
    assert res.status_code == 200
    body = res.json()
    assert body["token_type"] == "bearer"
    me = client.get("/auth/me", headers=auth_header(body["access_token"]))
    assert me.status_code == 200
    assert me.json()["email"] == CREDS["email"]


def test_login_email_is_case_insensitive(client):
    signup(client)
    assert login(client, email="ME@example.com").status_code == 200


def test_login_wrong_password_and_unknown_email_look_identical(client):
    signup(client)
    wrong_pw = login(client, password="wrong-password-123")
    unknown = login(client, email="nobody@example.com")
    assert wrong_pw.status_code == unknown.status_code == 401
    assert wrong_pw.json() == unknown.json()


# --- protected routes / token validation ------------------------------------


def test_me_requires_token(client):
    res = client.get("/auth/me")
    assert res.status_code == 401
    assert res.headers["www-authenticate"] == "Bearer"


def test_me_rejects_garbage_token(client):
    assert client.get("/auth/me", headers=auth_header("not.a.jwt")).status_code == 401


def test_me_rejects_expired_token(client):
    signup(client)
    expired = jwt.encode(
        {"sub": "1", "exp": datetime.now(UTC) - timedelta(minutes=1)},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )
    assert client.get("/auth/me", headers=auth_header(expired)).status_code == 401


def test_me_rejects_token_signed_with_wrong_key(client):
    signup(client)
    forged = jwt.encode(
        {"sub": "1", "exp": datetime.now(UTC) + timedelta(hours=1)},
        "some-other-key-that-is-long-enough-for-hs256!!",
        algorithm="HS256",
    )
    assert client.get("/auth/me", headers=auth_header(forged)).status_code == 401


def test_me_rejects_unsigned_alg_none_token(client):
    signup(client)
    unsigned = jwt.encode({"sub": "1", "exp": datetime.now(UTC) + timedelta(hours=1)}, None, algorithm="none")
    assert client.get("/auth/me", headers=auth_header(unsigned)).status_code == 401


def test_valid_token_for_deleted_user_is_rejected(client):
    signup(client)
    token = login(client).json()["access_token"]
    db = next(app.dependency_overrides[get_db]())
    db.delete(db.query(User).one())
    db.commit()
    assert client.get("/auth/me", headers=auth_header(token)).status_code == 401


def test_users_only_see_themselves(client):
    signup(client)
    signup(client, email="other@example.com")
    token = login(client, email="other@example.com").json()["access_token"]
    assert client.get("/auth/me", headers=auth_header(token)).json()["email"] == "other@example.com"


def test_token_for_nonexistent_user_id_is_rejected(client):
    assert client.get("/auth/me", headers=auth_header(create_access_token(9999))).status_code == 401
