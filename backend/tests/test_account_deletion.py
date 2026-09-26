import pytest
from sqlalchemy import func, select

from app import ratelimit
from app.models import Application, EmailVerificationToken, PasswordResetToken, StatusChange, User
from app.ratelimit import RateLimits
from tests.conftest import make_user

PASSWORD = "correct-horse-battery"


def delete_account(client, headers, password=PASSWORD):
    return client.post("/auth/delete-account", json={"password": password}, headers=headers)


def add_application(client, headers, company="Acme"):
    res = client.post("/applications", json={"company": company, "role": "Engineer"}, headers=headers)
    assert res.status_code == 201
    # A status change gives the application a second history row.
    client.patch(f"/applications/{res.json()['id']}", json={"status": "interview"}, headers=headers)
    return res.json()["id"]


def count(db, model) -> int:
    return db.scalar(select(func.count()).select_from(model))


# --- what deletion removes ----------------------------------------------------


def test_deleting_removes_the_user_their_applications_and_all_history(client, db):
    headers = make_user(client)
    add_application(client, headers, "Acme")
    add_application(client, headers, "Globex")
    assert count(db, Application) == 2 and count(db, StatusChange) == 4

    assert delete_account(client, headers).status_code == 204

    assert count(db, User) == 0
    assert count(db, Application) == 0
    assert count(db, StatusChange) == 0  # no orphans left behind


def test_pending_reset_and_verification_tokens_go_too(client, db, outbox):
    headers = make_user(client)  # signup left an unused verification token
    client.post("/auth/password-reset/request", json={"email": "me@example.com"})  # and a reset token
    assert count(db, EmailVerificationToken) == 1 and count(db, PasswordResetToken) == 1

    assert delete_account(client, headers).status_code == 204

    assert count(db, EmailVerificationToken) == 0
    assert count(db, PasswordResetToken) == 0


def test_deleting_one_account_leaves_everyone_elses_data_alone(client, db):
    mine = make_user(client)
    theirs = make_user(client, email="other@example.com")
    add_application(client, mine)
    their_id = add_application(client, theirs, "Theirs")

    assert delete_account(client, mine).status_code == 204

    assert [u.email for u in db.scalars(select(User))] == ["other@example.com"]
    assert count(db, Application) == 1
    assert count(db, StatusChange) == 2
    assert client.get(f"/applications/{their_id}", headers=theirs).status_code == 200


# --- the session ends with the account ---------------------------------------


def test_the_old_token_stops_working_immediately(client):
    headers = make_user(client)
    assert client.get("/auth/me", headers=headers).status_code == 200
    delete_account(client, headers)

    assert client.get("/auth/me", headers=headers).status_code == 401
    assert client.get("/applications", headers=headers).status_code == 401
    assert client.post("/auth/verify-email/resend", headers=headers).status_code == 401


def test_the_old_token_does_not_open_a_new_account_that_reuses_the_id(client):
    """SQLite hands a deleted user's id to the next signup. The token carries the account's
    random session version, so it still cannot open the newcomer's account."""
    old = make_user(client)
    delete_account(client, old)
    new = make_user(client, email="newcomer@example.com")

    assert client.get("/auth/me", headers=new).json()["email"] == "newcomer@example.com"
    assert client.get("/auth/me", headers=old).status_code == 401


def test_new_accounts_do_not_all_start_at_the_same_session_version(client, db):
    for i in range(5):
        make_user(client, email=f"u{i}@example.com")
    assert len({u.session_version for u in db.scalars(select(User))}) > 1


def test_the_email_can_sign_up_again_afterwards_with_a_clean_slate(client, db):
    headers = make_user(client)
    add_application(client, headers)
    delete_account(client, headers)

    fresh = make_user(client)  # same address, same password
    assert client.get("/applications", headers=fresh).json() == {"items": [], "total": 0}


def test_logging_in_no_longer_works(client):
    headers = make_user(client)
    delete_account(client, headers)
    res = client.post("/auth/login", json={"email": "me@example.com", "password": PASSWORD})
    assert res.status_code == 401


# --- guarding the irreversible step ------------------------------------------


def test_it_needs_a_login(client):
    assert client.post("/auth/delete-account", json={"password": PASSWORD}).status_code == 401


def test_a_wrong_password_deletes_nothing(client, db):
    headers = make_user(client)
    add_application(client, headers)

    res = delete_account(client, headers, password="not-the-password")

    assert res.status_code == 403
    assert res.json()["detail"] == "Incorrect password"
    assert count(db, User) == 1 and count(db, Application) == 1
    assert client.get("/auth/me", headers=headers).status_code == 200  # and they are still logged in


def test_the_password_is_required(client):
    headers = make_user(client)
    assert client.post("/auth/delete-account", json={}, headers=headers).status_code == 422
    assert client.post("/auth/delete-account", headers=headers).status_code == 422


def test_a_stolen_session_cannot_be_used_to_guess_the_password(client, db, monkeypatch):
    fake_now = [0.0]
    monkeypatch.setattr(ratelimit, "limits", RateLimits(lambda: fake_now[0]))
    headers = make_user(client)
    for _ in range(5):
        assert delete_account(client, headers, password="wrong-guess").status_code == 403
    blocked = delete_account(client, headers, password=PASSWORD)  # even the right one now
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers
    assert count(db, User) == 1

    fake_now[0] += 15 * 60 + 1
    assert delete_account(client, headers).status_code == 204


def test_wrong_guesses_on_one_account_do_not_block_another(client, monkeypatch):
    a = make_user(client)
    b = make_user(client, email="other@example.com")
    for _ in range(5):
        delete_account(client, a, password="wrong-guess")
    assert delete_account(client, a).status_code == 429
    assert delete_account(client, b).status_code == 204


def test_deleting_twice_is_not_possible(client):
    headers = make_user(client)
    assert delete_account(client, headers).status_code == 204
    assert delete_account(client, headers).status_code == 401


@pytest.mark.parametrize("path", ["/auth/delete-account"])
def test_it_is_a_post_so_a_link_or_prefetch_cannot_trigger_it(client, path):
    headers = make_user(client)
    assert client.get(path, headers=headers).status_code == 405
