import re
import threading
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import email_verification, mailer, password_reset, ratelimit
from app.config import settings
from app.db import get_db
from app.email_verification import issue_token, redeem_token
from app.main import app
from app.models import EmailVerificationToken, User
from app.password_reset import hash_token
from app.ratelimit import RateLimits
from tests.conftest import TEST_DATABASE_URL

CREDS = {"email": "me@example.com", "password": "correct-horse-battery"}
NOW = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
HOURS = settings.email_verification_expire_hours


class Clock:
    def __init__(self):
        self.now = NOW

    def __call__(self):
        return self.now

    def advance(self, **kw):
        self.now += timedelta(**kw)


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr(password_reset, "utcnow", fake)
    monkeypatch.setattr(email_verification, "utcnow", fake)
    monkeypatch.setattr(ratelimit, "limits", RateLimits(lambda: fake.now.timestamp()))
    return fake


def signup(client, **over):
    return client.post("/auth/signup", json={**CREDS, **over})


def login_headers(client, email=CREDS["email"], password=CREDS["password"]):
    token = client.post("/auth/login", json={"email": email, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def confirm(client, token):
    return client.post("/auth/verify-email/confirm", json={"token": token})


def resend(client, headers):
    return client.post("/auth/verify-email/resend", headers=headers)


def token_in(message) -> str:
    match = re.search(r"/verify-email#token=([A-Za-z0-9_-]+)", message.text)
    assert match, message.text
    return match.group(1)


def me(client, headers):
    return client.get("/auth/me", headers=headers).json()


@pytest.fixture
def user(client, db, outbox):
    signup(client)
    return db.scalar(select(User).where(User.email == CREDS["email"]))


# --- signup sends the link ---------------------------------------------------


def test_signup_emails_a_verification_link_to_the_address(client, outbox):
    signup(client)
    (message,) = outbox.sent
    assert message.to == CREDS["email"]
    assert message.subject == "Verify your Joblogga email address"
    assert f"{settings.frontend_base}/verify-email#token=" in message.text  # in the fragment, never sent to a server
    assert f"{settings.frontend_base}/verify-email#token=" in message.html


def test_only_a_hash_of_the_token_is_stored(client, outbox, db):
    signup(client)
    raw = token_in(outbox.sent[0])
    (row,) = db.scalars(select(EmailVerificationToken)).all()
    assert row.token_hash == hash_token(raw)
    assert raw not in row.token_hash


def test_a_new_account_starts_unverified_and_the_api_says_so(client, outbox):
    signup(client)
    assert me(client, login_headers(client))["email_verified"] is False


def test_the_verification_email_reply_is_the_same_whether_or_not_mail_can_be_sent(client, outbox):
    outbox.fail_with = RuntimeError("Resend is down")
    res = signup(client)  # background failure is logged, not shown
    assert res.status_code == 202


# --- redeeming ---------------------------------------------------------------


def test_the_link_verifies_the_account(client, outbox, db):
    signup(client)
    headers = login_headers(client)
    assert confirm(client, token_in(outbox.sent[0])).status_code == 200
    assert me(client, headers)["email_verified"] is True  # the session that was already open sees it


def test_the_link_needs_no_login(client, outbox):
    """People open the email on their phone, not the browser they signed up in."""
    signup(client)
    assert confirm(client, token_in(outbox.sent[0])).status_code == 200


def test_the_link_works_once(client, outbox):
    signup(client)
    token = token_in(outbox.sent[0])
    assert confirm(client, token).status_code == 200
    again = confirm(client, token)
    assert again.status_code == 400


def test_redeeming_keeps_the_first_verification_time(client, outbox, db, clock):
    signup(client)
    token = token_in(outbox.sent[0])
    confirm(client, token)
    first = db.scalar(select(User.email_verified_at))
    db.expire_all()
    clock.advance(hours=1)
    resend_token = issue_token(db, db.scalar(select(User)), clock.now)
    db.commit()
    assert confirm(client, resend_token).status_code == 200
    db.expire_all()
    assert db.scalar(select(User.email_verified_at)) == first


def test_an_expired_link_is_refused_and_one_just_inside_the_window_is_not(client, outbox, clock):
    signup(client)  # issued at NOW (both clocks are the fake one)
    token = token_in(outbox.sent[0])
    clock.advance(hours=HOURS, seconds=-1)
    assert confirm(client, token).status_code == 200

    signup(client, email="two@example.com")
    late = token_in(outbox.sent[1])
    clock.advance(hours=HOURS, seconds=1)
    assert confirm(client, late).status_code == 400


def test_every_kind_of_bad_link_gets_the_same_answer(client, outbox, clock):
    signup(client)
    used = token_in(outbox.sent[0])
    confirm(client, used)
    signup(client, email="two@example.com")
    expired = token_in(outbox.sent[1])
    clock.advance(hours=HOURS + 1)
    answers = {(r.status_code, r.json()["detail"]) for r in (confirm(client, used), confirm(client, expired), confirm(client, "x" * 43))}
    assert len(answers) == 1


def test_a_malformed_token_is_a_validation_error_not_a_lookup(client):
    assert confirm(client, "short").status_code == 422


def test_two_requests_racing_for_one_token_cannot_both_win(client, outbox, db):
    signup(client)
    raw = token_in(outbox.sent[0])
    first = redeem_token(db, raw)
    db.commit()
    assert first is not None
    assert redeem_token(db, raw) is None


@pytest.mark.skipif(TEST_DATABASE_URL.startswith("sqlite"), reason="needs concurrent Postgres connections")
def test_simultaneous_redemptions_on_postgres_let_exactly_one_through(client, outbox):
    signup(client)
    raw = token_in(outbox.sent[0])
    results: list[int] = []
    barrier = threading.Barrier(4)

    def worker():
        barrier.wait()
        results.append(confirm(client, raw).status_code)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [200, 400, 400, 400]


def test_bad_links_are_limited_but_good_ones_are_not_counted(client, outbox, clock):
    for _ in range(20):
        assert confirm(client, "x" * 43).status_code == 400
    assert confirm(client, "x" * 43).status_code == 429
    clock.advance(minutes=16)
    signup(client)
    assert confirm(client, token_in(outbox.sent[0])).status_code == 200


# --- signup must not reveal who has an account -------------------------------


def snapshot(res):
    return (res.status_code, res.json(), sorted(k for k in res.headers if k not in {"date", "content-length"}))


def test_signup_answers_identically_for_new_unverified_and_verified_addresses(client, outbox):
    new = signup(client)  # a brand-new address
    unverified = signup(client)  # now an unverified account exists
    confirm(client, token_in(outbox.sent[0]))
    verified = signup(client)  # and now a verified one
    assert snapshot(new) == snapshot(unverified) == snapshot(verified)


def test_the_endpoint_itself_does_no_database_or_hashing_work(client, monkeypatch):
    """Timing can't leak what the request never looked up: it only queues the work."""
    calls = []
    monkeypatch.setattr(email_verification, "register_or_notify", lambda *a, **k: calls.append(a[2:3]))
    signup(client)
    assert calls == [("me@example.com",)]  # queued with the address; nothing decided yet


def test_a_verified_address_gets_a_you_already_have_an_account_email_instead(client, outbox):
    signup(client)
    confirm(client, token_in(outbox.sent[0]))
    outbox.sent.clear()
    signup(client)
    (message,) = outbox.sent
    assert message.subject == "You already have a Joblogga account"
    assert "/verify-email" not in message.text
    assert f"{settings.frontend_base}/login" in message.text
    assert f"{settings.frontend_base}/forgot-password" in message.text


def test_an_unverified_address_signing_up_again_gets_a_fresh_link_and_the_old_one_dies(client, outbox):
    signup(client)
    signup(client)
    old, new = (token_in(m) for m in outbox.sent)
    assert old != new
    assert confirm(client, old).status_code == 400
    assert confirm(client, new).status_code == 200


def test_signup_mail_to_one_address_is_capped_silently(client, outbox):
    """Three per hour per address, and the fourth is dropped without any change in the reply."""
    replies = [signup(client) for _ in range(5)]
    assert len(outbox.sent) == 3
    assert len({(r.status_code, r.json()["detail"]) for r in replies}) == 1


def test_a_failed_send_for_an_existing_address_is_swallowed(client, outbox, caplog):
    signup(client)
    outbox.fail_with = RuntimeError("boom")
    with caplog.at_level("ERROR"):
        assert signup(client).status_code == 202
    assert CREDS["email"] not in caplog.text.replace("Signup processing failed", "")


def test_a_racing_duplicate_signup_is_handled_by_the_unique_constraint(client, outbox, db, monkeypatch):
    """Two signups both find no account, then both insert: one loses to the constraint
    and quietly carries on as the address-already-exists case."""
    signup(client)
    lookups = {"n": 0}
    original = Session.scalar

    def blind_first_lookup(self, statement, *a, **k):
        lookups["n"] += 1
        if lookups["n"] == 1:
            return None  # "no such account" although there is one: the race
        return original(self, statement, *a, **k)

    monkeypatch.setattr(Session, "scalar", blind_first_lookup)
    assert signup(client, password="another-password-here").status_code == 202
    monkeypatch.undo()
    assert db.query(User).count() == 1
    assert login_headers(client)  # still the original password


# --- what an unverified user can and cannot do -------------------------------


def test_an_unverified_user_can_use_the_app_fully(client, outbox):
    signup(client)
    headers = login_headers(client)
    created = client.post("/applications", json={"company": "Acme", "role": "Engineer"}, headers=headers)
    assert created.status_code == 201
    assert client.get("/applications", headers=headers).json()["total"] == 1
    assert client.get("/applications/export.csv", headers=headers).status_code == 200
    assert client.get("/stats", headers=headers).status_code == 200


# --- resending ---------------------------------------------------------------


def test_resend_needs_a_login(client):
    assert client.post("/auth/verify-email/resend").status_code == 401


def test_resend_mails_the_logged_in_users_own_address_a_working_new_link(client, outbox):
    signup(client)
    headers = login_headers(client)
    outbox.sent.clear()
    res = resend(client, headers)
    assert res.status_code == 202
    (message,) = outbox.sent
    assert message.to == CREDS["email"]
    assert confirm(client, token_in(message)).status_code == 200


def test_resending_retires_the_earlier_link(client, outbox):
    signup(client)
    original = token_in(outbox.sent[0])
    resend(client, login_headers(client))
    assert confirm(client, original).status_code == 400
    assert confirm(client, token_in(outbox.sent[-1])).status_code == 200


def test_resend_for_a_verified_account_sends_nothing(client, outbox):
    signup(client)
    confirm(client, token_in(outbox.sent[0]))
    outbox.sent.clear()
    res = resend(client, login_headers(client))
    assert res.status_code == 202
    assert "already verified" in res.json()["detail"]
    assert outbox.sent == []


def test_resend_is_limited_to_three_an_hour_per_account_then_frees_up(client, outbox, clock):
    signup(client)
    headers = login_headers(client)
    outbox.sent.clear()
    for _ in range(3):
        assert resend(client, headers).status_code == 202
    blocked = resend(client, headers)
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers
    assert len(outbox.sent) == 3
    clock.advance(hours=1, seconds=1)
    assert resend(client, headers).status_code == 202


def test_one_accounts_resend_allowance_does_not_touch_another(client, outbox, clock):
    signup(client)
    signup(client, email="other@example.com")
    first = login_headers(client)
    other = login_headers(client, email="other@example.com")
    for _ in range(3):
        resend(client, first)
    assert resend(client, first).status_code == 429
    assert resend(client, other).status_code == 202


# --- a password reset proves the same thing ----------------------------------


def test_completing_a_password_reset_also_verifies_the_address(client, outbox):
    signup(client)
    client.post("/auth/password-reset/request", json={"email": CREDS["email"]})
    reset_token = re.search(r"/reset-password#token=([A-Za-z0-9_-]+)", outbox.sent[-1].text).group(1)
    res = client.post("/auth/password-reset/confirm", json={"token": reset_token, "password": "a-brand-new-password"})
    assert res.status_code == 200
    headers = login_headers(client, password="a-brand-new-password")
    assert me(client, headers)["email_verified"] is True


# --- housekeeping ------------------------------------------------------------


def test_old_finished_tokens_are_tidied_when_a_new_one_is_issued(client, outbox, db, clock):
    signup(client)
    user = db.scalar(select(User))
    clock.advance(days=3)
    issue_token(db, user, clock.now)
    db.commit()
    rows = db.scalars(select(EmailVerificationToken)).all()
    assert len(rows) == 1  # the expired earlier one is gone, only the fresh one remains


def test_tokens_die_with_their_user(client, outbox, db):
    signup(client)
    if TEST_DATABASE_URL.startswith("sqlite"):
        db.connection().exec_driver_sql("PRAGMA foreign_keys=ON")  # SQLite enforces cascades only when asked
    db.execute(User.__table__.delete())
    db.commit()
    assert db.scalars(select(EmailVerificationToken)).all() == []


def test_the_emails_are_plain_about_what_they_are(client, outbox):
    message = mailer.verification_message("a@b.co", "https://x.test/verify-email#token=abc", 24)
    assert "24 hours" in message.text and "24 hours" in message.html
    assert "https://x.test/verify-email#token=abc" in message.html
