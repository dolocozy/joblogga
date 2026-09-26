import re
import threading
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text

from app import mailer, password_reset, ratelimit
from app.config import settings
from app.db import get_db
from app.deps import get_email_sender
from app.main import app
from app.models import PasswordResetToken, User
from app.password_reset import hash_token, issue_token, new_token, redeem_token
from app.ratelimit import RateLimits
from tests.conftest import TEST_DATABASE_URL

CREDS = {"email": "me@example.com", "password": "correct-horse-battery"}
NEW_PASSWORD = "a-brand-new-password"
NOW = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
MINUTES = settings.password_reset_expire_minutes


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
    monkeypatch.setattr(ratelimit, "limits", RateLimits(lambda: fake.now.timestamp()))
    return fake


def signup(client, **over):
    """Sign up, then forget the verification email it sent: these tests are about reset emails."""
    res = client.post("/auth/signup", json={**CREDS, **over})
    fake = app.dependency_overrides.get(get_email_sender)
    if fake:
        fake().sent.clear()
    return res


def login(client, password=CREDS["password"], email=CREDS["email"]):
    return client.post("/auth/login", json={"email": email, "password": password})


def request_reset(client, email=CREDS["email"]):
    return client.post("/auth/password-reset/request", json={"email": email})


def confirm(client, token, password=NEW_PASSWORD):
    return client.post("/auth/password-reset/confirm", json={"token": token, "password": password})


def token_in(message) -> str:
    """The token inside the reset link of a sent email."""
    match = re.search(r"/reset-password#token=([A-Za-z0-9_-]+)", message.text)
    assert match, message.text
    return match.group(1)


def get_token_from_email(client, outbox, email=CREDS["email"]) -> str:
    signup_needed = client.post("/auth/login", json={"email": email, "password": "x" * 8}).status_code  # noqa: F841
    request_reset(client, email)
    return token_in(outbox.sent[-1])


@pytest.fixture
def user(client, db):
    signup(client)
    return db.scalar(select(User).where(User.email == CREDS["email"]))


# --- the token itself -------------------------------------------------------


def test_tokens_are_long_random_and_url_safe():
    tokens = {new_token() for _ in range(200)}
    assert len(tokens) == 200  # no repeats
    assert all(len(t) >= 43 for t in tokens)  # 32 random bytes = 256 bits
    assert all(re.fullmatch(r"[A-Za-z0-9_-]+", t) for t in tokens)  # safe inside a URL


def test_hash_is_stable_hex_and_not_the_token():
    token = new_token()
    assert hash_token(token) == hash_token(token)
    assert re.fullmatch(r"[0-9a-f]{64}", hash_token(token))
    assert hash_token(token) != token
    assert hash_token(token) != hash_token(new_token())


def test_only_the_hash_is_stored_never_the_token(db, user):
    raw = issue_token(db, user, NOW)
    db.commit()
    row = db.scalar(select(PasswordResetToken))
    assert row.token_hash == hash_token(raw)
    columns = " ".join(str(v) for v in (row.id, row.user_id, row.token_hash, row.created_at, row.expires_at, row.used_at))
    assert raw not in columns  # a copy of the table cannot be replayed as a reset link


def test_expiry_is_the_configured_number_of_minutes_from_issue(db, user):
    issue_token(db, user, NOW)
    db.commit()
    row = db.scalar(select(PasswordResetToken))
    assert row.expires_at - row.created_at == timedelta(minutes=MINUTES)
    assert row.created_at == NOW
    assert row.used_at is None


# --- redeeming: single use and expiry ---------------------------------------


def test_a_valid_token_redeems_to_its_user(db, user):
    raw = issue_token(db, user, NOW)
    db.commit()
    assert redeem_token(db, raw, NOW + timedelta(minutes=1)) == user.id


def test_a_token_can_be_used_once(db, user):
    raw = issue_token(db, user, NOW)
    db.commit()
    assert redeem_token(db, raw, NOW) == user.id
    db.commit()
    assert redeem_token(db, raw, NOW) is None
    assert redeem_token(db, raw, NOW + timedelta(seconds=1)) is None


def test_redeeming_marks_the_token_used(db, user):
    raw = issue_token(db, user, NOW)
    db.commit()
    redeem_token(db, raw, NOW + timedelta(minutes=5))
    db.commit()
    assert db.scalar(select(PasswordResetToken)).used_at == NOW + timedelta(minutes=5)


def test_a_token_works_up_to_its_expiry_and_not_at_or_after_it(db, user):
    raw = issue_token(db, user, NOW)
    db.commit()
    expiry = NOW + timedelta(minutes=MINUTES)
    assert redeem_token(db, raw, expiry - timedelta(seconds=1)) == user.id  # one second before: fine
    db.rollback()  # (undo the redemption so we can probe the boundary again)
    assert redeem_token(db, raw, expiry) is None  # at the instant: expired
    assert redeem_token(db, raw, expiry + timedelta(days=30)) is None


@pytest.mark.parametrize("bad", ["", "x", "not-a-token", "A" * 43, "%" * 50])
def test_unknown_tokens_redeem_to_nothing(db, user, bad):
    issue_token(db, user, NOW)
    db.commit()
    assert redeem_token(db, bad, NOW) is None


def test_a_token_only_ever_belongs_to_its_own_user(db, user):
    other = User(email="other@example.com", hashed_password="x")
    db.add(other)
    db.commit()
    mine = issue_token(db, user, NOW)
    theirs = issue_token(db, other, NOW)
    db.commit()
    assert redeem_token(db, mine, NOW) == user.id
    assert redeem_token(db, theirs, NOW) == other.id


def test_asking_again_retires_the_earlier_link(db, user):
    first = issue_token(db, user, NOW)
    db.commit()
    second = issue_token(db, user, NOW + timedelta(minutes=1))
    db.commit()
    assert redeem_token(db, first, NOW + timedelta(minutes=2)) is None  # only the newest link works
    assert redeem_token(db, second, NOW + timedelta(minutes=2)) == user.id


def test_asking_again_does_not_retire_other_peoples_links(db, user):
    other = User(email="other@example.com", hashed_password="x")
    db.add(other)
    db.commit()
    theirs = issue_token(db, other, NOW)
    db.commit()
    issue_token(db, user, NOW)
    db.commit()
    assert redeem_token(db, theirs, NOW) == other.id


def test_long_finished_tokens_are_tidied_away(db, user):
    issue_token(db, user, NOW)
    db.commit()
    redeem_token(db, db.scalar(select(PasswordResetToken.token_hash)) or "", NOW)  # (no-op: just exercising the path)
    issue_token(db, user, NOW + timedelta(days=2))  # more than a day after the first expired
    db.commit()
    assert len(db.scalars(select(PasswordResetToken)).all()) == 1


def test_deleting_a_user_deletes_their_tokens(db, user):
    issue_token(db, user, NOW)
    db.commit()
    db.delete(user)
    db.commit()
    assert db.scalars(select(PasswordResetToken)).all() == []


@pytest.mark.skipif(TEST_DATABASE_URL.startswith("sqlite"), reason="needs real concurrent connections (Postgres)")
def test_ten_simultaneous_attempts_to_use_one_token_produce_exactly_one_winner(client, db, user):
    from sqlalchemy.orm import sessionmaker

    raw = issue_token(db, user, NOW)
    db.commit()
    factory = sessionmaker(bind=db.get_bind(), expire_on_commit=False)
    results, barrier = [], threading.Barrier(10)

    def attempt():
        with factory() as session:
            barrier.wait()  # release all ten at the same moment
            got = redeem_token(session, raw, NOW)
            session.commit()
            results.append(got)

    threads = [threading.Thread(target=attempt) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    assert sorted(r for r in results if r is not None) == [user.id]
    assert results.count(None) == 9


# --- requesting a reset: who gets an email, and what the caller learns ------


def test_an_account_gets_an_email_with_a_working_link(client, outbox, db, user):
    res = request_reset(client)
    assert res.status_code == 202
    (message,) = outbox.sent
    assert message.to == CREDS["email"]
    assert message.subject == "Reset your Joblogga password"
    assert f"{settings.frontend_base}/reset-password#token=" in message.text
    assert f"{settings.frontend_base}/reset-password#token=" in message.html
    # The link's token is real and is what is stored (hashed).
    assert db.scalar(select(PasswordResetToken.token_hash)) == hash_token(token_in(message))


def test_the_link_puts_the_token_in_the_fragment_so_it_never_reaches_a_server_or_log(client, outbox, user):
    request_reset(client)
    link = re.search(r"https?://\S+", outbox.sent[0].text).group(0)
    assert "#token=" in link
    assert "?" not in link  # not a query string: those are sent to servers and logged


def test_an_address_with_no_account_gets_no_email_and_no_token(client, outbox, db):
    res = request_reset(client, "nobody@example.com")
    assert res.status_code == 202
    assert outbox.sent == []
    assert db.scalars(select(PasswordResetToken)).all() == []


def test_the_reply_is_identical_whether_or_not_the_account_exists(client, outbox, user):
    real = request_reset(client, CREDS["email"])
    ghost = request_reset(client, "nobody@example.com")
    assert real.status_code == ghost.status_code == 202
    assert real.json() == ghost.json()
    # Every header a caller could compare, apart from ones that legitimately differ per response.
    drop = {"date", "content-length"} if real.headers.get("content-length") != ghost.headers.get("content-length") else {"date"}
    assert {k: v for k, v in real.headers.items() if k not in drop} == {k: v for k, v in ghost.headers.items() if k not in drop}
    assert len(real.content) == len(ghost.content)  # not even the size of the reply differs


def test_the_reply_never_says_who_or_whether(client, outbox, user):
    text_reply = request_reset(client, CREDS["email"]).text.lower()
    assert CREDS["email"] not in text_reply
    assert "no account" not in text_reply and "not found" not in text_reply and "unknown" not in text_reply
    assert "if an account exists" in text_reply


def test_the_request_does_no_database_work_before_replying(client, outbox, user):
    """If the handler touched the database, an existing account and a missing one could
    take measurably different time. So it must not: prove it by making every database
    access in the request path blow up. The reply must still come back, the same."""

    def boom():
        raise AssertionError("the request path touched the database")
        yield  # pragma: no cover

    app.dependency_overrides[get_db] = boom
    assert request_reset(client, CREDS["email"]).status_code == 202
    assert request_reset(client, "nobody@example.com").status_code == 202


def test_the_lookup_happens_after_the_reply_in_a_background_task(client, outbox, user, monkeypatch):
    calls = []
    real = password_reset.send_reset_email_if_account_exists
    monkeypatch.setattr(password_reset, "send_reset_email_if_account_exists", lambda *a: (calls.append(a[2]), real(*a)))
    request_reset(client, "Me@Example.com")
    assert calls == ["me@example.com"]  # handed the normalised address, as a background task


def test_the_reply_is_sent_before_any_of_the_work_happens(client, outbox, user, monkeypatch):
    """TestClient waits for background work, so it cannot see WHEN it happens. Run the app
    at the raw ASGI level and record the order: the response must be fully sent before the
    account lookup / token / email work starts. If it ran first, an existing account would
    make the reply slower than a missing one and the difference could be timed."""
    import asyncio
    import json

    events: list[str] = []
    real = password_reset.send_reset_email_if_account_exists

    def recording(*args):
        events.append("work started")
        real(*args)

    monkeypatch.setattr(password_reset, "send_reset_email_if_account_exists", recording)

    async def call(email: str):
        body = json.dumps({"email": email}).encode()
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "scheme": "http",
            "path": "/auth/password-reset/request", "raw_path": b"/auth/password-reset/request", "root_path": "", "query_string": b"",
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"host", b"testserver")],
            "client": ("203.0.113.1", 1234), "server": ("testserver", 80),
        }

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(message):
            if message["type"] == "http.response.body" and not message.get("more_body"):
                events.append("reply sent")

        await app(scope, receive, send)

    for email in (CREDS["email"], "nobody@example.com"):
        events.clear()
        asyncio.run(call(email))
        assert events == ["reply sent", "work started"], f"for {email}: {events}"  # reply first, work after, for both


def test_addresses_are_matched_case_insensitively(client, outbox, user):
    request_reset(client, "ME@EXAMPLE.COM")
    assert len(outbox.sent) == 1
    assert outbox.sent[0].to == "me@example.com"


def test_a_malformed_address_is_a_validation_error(client):
    assert request_reset(client, "not-an-email").status_code == 422


def test_asking_twice_only_the_newest_link_works(client, outbox, user):
    request_reset(client)
    request_reset(client)
    first, second = (token_in(m) for m in outbox.sent)
    assert first != second
    assert confirm(client, first).status_code == 400
    assert confirm(client, second).status_code == 200


def test_a_failure_to_send_is_invisible_to_the_caller_and_leaks_nothing_in_the_log(client, outbox, user, caplog):
    outbox.fail_with = mailer.EmailSendError("Resend rejected the email: HTTP 403")
    with caplog.at_level("ERROR"):
        res = request_reset(client)
    assert res.status_code == 202  # same as a success: the caller can't tell
    logged = " ".join(r.getMessage() + (r.exc_text or "") for r in caplog.records)
    assert "Sending a password reset email failed" in logged
    assert CREDS["email"] not in logged  # no address in the log
    assert "#token=" not in logged  # and no link


def test_the_same_reply_even_when_sending_fails_for_a_real_account(client, outbox, user):
    ok = request_reset(client, CREDS["email"])
    outbox.fail_with = RuntimeError("boom")
    failed = request_reset(client, "nobody@example.com")  # different address: separate rate-limit key
    assert ok.json() == failed.json()


# --- rate limiting the request endpoint -------------------------------------


def test_only_three_requests_per_address_per_hour_and_it_is_counted_whether_or_not_the_account_exists(client, outbox, clock, user):
    real = [request_reset(client, CREDS["email"]).status_code for _ in range(4)]
    ghost = [request_reset(client, "nobody@example.com").status_code for _ in range(4)]
    # Identical pattern: the limit is not a way to find out which addresses have accounts.
    assert real == ghost == [202, 202, 202, 429]
    assert len(outbox.sent) == 3  # and the fourth real one really was refused


def test_the_refusal_has_a_message_and_retry_after(client, outbox, clock, user):
    for _ in range(3):
        request_reset(client)
    res = request_reset(client)
    assert res.status_code == 429
    assert res.json() == {"detail": "Too many attempts. Try again in 60 minutes."}
    assert res.headers["retry-after"] == "3600"


def test_the_limit_lifts_after_an_hour(client, outbox, clock, user):
    for _ in range(3):
        request_reset(client)
    assert request_reset(client).status_code == 429
    clock.advance(minutes=61)
    assert request_reset(client).status_code == 202


def test_one_address_cannot_flood_many_inboxes(client, outbox, clock):
    statuses = [request_reset(client, f"user{i}@example.com").status_code for i in range(12)]
    assert statuses == [202] * 10 + [429, 429]  # ten per address per hour


def test_other_addresses_are_unaffected_by_one_being_limited(client, outbox, clock, user):
    for _ in range(4):
        request_reset(client)
    assert request_reset(client, "someone-else@example.com").status_code == 202


# --- confirming: choosing the new password ----------------------------------


def test_the_full_flow_request_email_reset_login(client, outbox, user):
    request_reset(client)
    token = token_in(outbox.sent[0])

    res = confirm(client, token)

    assert res.status_code == 200
    assert res.json() == {"detail": "Your password has been updated. You can log in with it now."}
    assert login(client, NEW_PASSWORD).status_code == 200  # the new password works
    assert login(client, CREDS["password"]).status_code == 401  # the old one no longer does


def test_the_link_works_once(client, outbox, user):
    request_reset(client)
    token = token_in(outbox.sent[0])
    assert confirm(client, token).status_code == 200
    again = confirm(client, token, "yet-another-password")
    assert again.status_code == 400
    assert login(client, NEW_PASSWORD).status_code == 200  # the second attempt changed nothing
    assert login(client, "yet-another-password").status_code == 401


def test_an_expired_link_is_refused_and_a_link_just_inside_the_window_is_not(client, outbox, clock, user):
    request_reset(client)
    token = token_in(outbox.sent[0])
    clock.advance(minutes=MINUTES, seconds=1)
    assert confirm(client, token).status_code == 400

    clock.advance(hours=1)
    request_reset(client)  # a fresh link
    fresh = token_in(outbox.sent[1])
    clock.advance(minutes=MINUTES - 1)
    assert confirm(client, fresh).status_code == 200


def test_every_kind_of_bad_link_gets_the_same_answer(client, outbox, clock, user):
    request_reset(client)
    used = token_in(outbox.sent[0])
    confirm(client, used)
    request_reset(client)
    expired = token_in(outbox.sent[1])
    clock.advance(minutes=MINUTES + 1)

    answers = [confirm(client, t) for t in (used, expired, new_token())]  # spent, expired, never existed

    assert {a.status_code for a in answers} == {400}
    assert len({a.text for a in answers}) == 1  # the caller cannot tell which was which
    assert answers[0].json()["detail"] == "This reset link is invalid or has expired. Please request a new one."


def test_a_weak_password_is_refused_and_does_not_use_up_the_link(client, outbox, user):
    request_reset(client)
    token = token_in(outbox.sent[0])

    for bad in ("short", "x" * 73, ""):
        assert confirm(client, token, bad).status_code == 422

    assert confirm(client, token).status_code == 200  # still usable: they can try again


@pytest.mark.parametrize("token", ["", "short", "x" * 500])
def test_a_malformed_token_is_a_validation_error(client, token):
    assert confirm(client, token).status_code == 422


def test_resetting_signs_out_every_earlier_session(client, outbox, user):
    old_session = login(client).json()["access_token"]
    headers = {"Authorization": f"Bearer {old_session}"}
    assert client.get("/auth/me", headers=headers).status_code == 200

    request_reset(client)
    confirm(client, token_in(outbox.sent[0]))

    assert client.get("/auth/me", headers=headers).status_code == 401  # a stolen token dies with the old password
    new_session = login(client, NEW_PASSWORD).json()["access_token"]
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {new_session}"}).status_code == 200


def test_each_reset_moves_the_session_version_on(client, outbox, db, user):
    assert user.session_version == 0
    request_reset(client)
    confirm(client, token_in(outbox.sent[0]))
    db.refresh(user)
    assert user.session_version == 1


def test_sessions_that_predate_session_versions_stay_valid_until_a_reset(client, user):
    """Tokens issued before this feature carry no version claim; deploying it must not log anyone out."""
    import jwt

    legacy = jwt.encode(
        {"sub": str(user.id), "exp": datetime.now(UTC) + timedelta(hours=1)}, settings.secret_key, algorithm=settings.jwt_algorithm
    )
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {legacy}"}).status_code == 200


def test_other_accounts_sessions_are_untouched(client, outbox, user):
    signup(client, email="other@example.com")
    other = login(client, email="other@example.com").json()["access_token"]
    request_reset(client)
    confirm(client, token_in(outbox.sent[0]))
    assert client.get("/auth/me", headers={"Authorization": f"Bearer {other}"}).status_code == 200


def test_any_other_unused_link_dies_when_one_is_used(client, outbox, db, user):
    request_reset(client)
    token = token_in(outbox.sent[0])
    extra = issue_token(db, user)  # a second live link, made behind the API's back
    db.commit()
    # (issuing retired the first; make it live again to simulate two outstanding links)
    db.execute(text("UPDATE password_reset_tokens SET used_at = NULL"))
    db.commit()
    assert confirm(client, extra).status_code == 200
    assert confirm(client, token).status_code == 400


def test_the_password_change_and_the_spending_of_the_link_happen_together(client, outbox, user, monkeypatch):
    request_reset(client)
    token = token_in(outbox.sent[0])
    import app.routers.auth as auth_router

    def failing_hash(_):
        raise RuntimeError("hashing failed part-way")

    monkeypatch.setattr(auth_router, "hash_password", failing_hash)
    with pytest.raises(RuntimeError):
        confirm(client, token)
    monkeypatch.undo()  # the server recovers...

    assert confirm(client, token).status_code == 200  # ...and the link was NOT burned by the failure
    assert login(client, NEW_PASSWORD).status_code == 200


def test_bad_links_are_limited_but_good_ones_are_not_counted(client, outbox, clock, user):
    statuses = [confirm(client, new_token()).status_code for _ in range(21)]
    assert statuses == [400] * 20 + [429]
    assert confirm(client, new_token()).headers["retry-after"] == "900"
    clock.advance(minutes=16)
    request_reset(client)
    assert confirm(client, token_in(outbox.sent[0])).status_code == 200


def test_a_good_link_does_not_use_up_the_bad_link_allowance(client, outbox, clock, user):
    for _ in range(15):
        confirm(client, new_token())
    request_reset(client)
    assert confirm(client, token_in(outbox.sent[0])).status_code == 200
    assert [confirm(client, new_token()).status_code for _ in range(5)] == [400] * 5  # 15 + 5 = 20, still allowed


# --- the email and the Resend connection ------------------------------------


def test_the_email_says_what_it_is_and_carries_no_account_details():
    message = mailer.password_reset_message("me@example.com", "https://app.example/reset-password#token=abc", 30)
    for body in (message.text, message.html):
        assert "https://app.example/reset-password#token=abc" in body
        assert "30 minutes" in body
        assert "ignore this email" in body
    assert message.to == "me@example.com"
    assert "me@example.com" not in message.text  # the body does not repeat the address


def test_the_link_is_escaped_in_the_html_version():
    message = mailer.password_reset_message("me@example.com", 'https://x.example/?a="b"&c=<d>', 30)
    assert '"b"' not in message.html
    assert "<d>" not in message.html
    assert "&quot;b&quot;" in message.html and "&lt;d&gt;" in message.html


class FakeResponse:
    def __init__(self, status):
        self.status_code = status
        self.is_success = 200 <= status < 300


class FakeHttp:
    """Stands in for httpx.Client, recording calls and replaying scripted outcomes."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def post(self, url, json, headers):
        self.calls.append({"url": url, "json": json, "headers": headers})
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return FakeResponse(outcome)


def sender_with(*outcomes):
    http = FakeHttp(*outcomes)
    return mailer.ResendSender("re_secret_key", "Joblogga <noreply@dolocozy.com>", client=http, retry_delay=0), http


MSG = mailer.EmailMessage(to="me@example.com", subject="Hi", text="plain", html="<p>html</p>")


def test_it_sends_the_request_resend_documents():
    sender, http = sender_with(200)
    sender.send(MSG)
    (call,) = http.calls
    assert call["url"] == "https://api.resend.com/emails"
    assert call["headers"]["Authorization"] == "Bearer re_secret_key"
    assert call["json"] == {"from": "Joblogga <noreply@dolocozy.com>", "to": ["me@example.com"], "subject": "Hi", "html": "<p>html</p>", "text": "plain"}
    assert re.fullmatch(r"[0-9a-f]{32}", call["headers"]["Idempotency-Key"])


@pytest.mark.parametrize("status", [401, 403, 422])
def test_a_rejected_request_is_not_retried(status):
    sender, http = sender_with(status)
    with pytest.raises(mailer.EmailSendError, match=str(status)):
        sender.send(MSG)
    assert len(http.calls) == 1  # our request is wrong; sending it again cannot help


@pytest.mark.parametrize("first", [429, 500, 503])
def test_a_busy_service_is_retried_once_with_the_same_idempotency_key(first):
    sender, http = sender_with(first, 200)
    sender.send(MSG)  # succeeds on the second try
    assert len(http.calls) == 2
    assert http.calls[0]["headers"]["Idempotency-Key"] == http.calls[1]["headers"]["Idempotency-Key"]


def test_a_network_error_is_retried_once():
    import httpx

    sender, http = sender_with(httpx.ConnectTimeout("slow"), 200)
    sender.send(MSG)
    assert len(http.calls) == 2


def test_it_gives_up_after_one_retry():
    sender, http = sender_with(500, 500, 200)
    with pytest.raises(mailer.EmailSendError, match="after a retry"):
        sender.send(MSG)
    assert len(http.calls) == 2  # not three


def test_an_error_never_contains_the_api_key_or_the_recipient():
    import httpx

    leaky = httpx.ConnectError("could not reach https://api.resend.com with Bearer re_secret_key for me@example.com")
    sender, _ = sender_with(leaky, leaky)  # both attempts fail at the network, so the final error is built from it
    with pytest.raises(mailer.EmailSendError) as info:
        sender.send(MSG)
    assert "re_secret_key" not in str(info.value)
    assert "me@example.com" not in str(info.value)


def test_a_real_sender_is_used_only_when_a_key_is_configured(monkeypatch):
    monkeypatch.setattr(settings, "resend_api_key", None)
    assert isinstance(mailer.get_email_sender(), mailer.UnconfiguredSender)
    monkeypatch.setattr(settings, "resend_api_key", "re_abc")
    assert isinstance(mailer.get_email_sender(), mailer.ResendSender)


def test_without_a_key_nothing_is_sent_and_the_link_is_not_written_to_the_log(caplog, monkeypatch):
    monkeypatch.setattr(settings, "log_reset_links", False)
    with caplog.at_level("WARNING", logger="joblogga.mailer"):
        mailer.UnconfiguredSender().send(mailer.password_reset_message("me@example.com", "https://x.example/reset-password#token=SECRET", 30))
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "RESEND_API_KEY is not set" in logged
    assert "SECRET" not in logged  # by default a missing key must not leak working reset links into logs


def test_the_development_flag_prints_the_link_so_the_flow_can_be_tried(caplog, monkeypatch):
    monkeypatch.setattr(settings, "log_reset_links", True)
    with caplog.at_level("WARNING", logger="joblogga.mailer"):
        mailer.UnconfiguredSender().send(mailer.password_reset_message("me@example.com", "https://x.example/reset-password#token=SECRET", 30))
    assert "SECRET" in " ".join(r.getMessage() for r in caplog.records)
    assert settings.log_reset_links is True
