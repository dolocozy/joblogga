import threading
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app import mailer, ratelimit, reminders
from app.config import settings
from app.deps import get_session_factory
from app.main import app
from app.mailer import DigestItem, follow_up_digest_message
from app.models import Application, User
from app.reminders import run_follow_up_digests, unsubscribe_token, user_id_from_unsubscribe_token
from app.ratelimit import RateLimits
from tests.conftest import make_user

TODAY = date(2026, 6, 10)
SECRET = "s" * 40
BASE = {"company": "Acme Corp", "role": "Backend Engineer"}


@pytest.fixture(autouse=True)
def _no_pause(monkeypatch):
    monkeypatch.setattr(reminders, "SEND_PAUSE_SECONDS", 0)


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(settings, "reminder_secret", SECRET)
    return SECRET


def person(client, db, outbox, email="me@example.com", verified=True, opted_in=True):
    """A user with the reminder settings given. Returns (auth headers, user id)."""
    headers = make_user(client, email=email)
    user = db.scalar(select(User).where(User.email == email))
    if verified:
        user.email_verified_at = reminders.datetime.now(reminders.UTC)
    user.reminder_emails = opted_in
    db.commit()
    outbox.sent.clear()  # the signup's own verification mail is not what these tests are about
    return headers, user.id


def follow_up(client, headers, days_from_today, company="Acme Corp", role="Backend Engineer", **fields):
    when = (TODAY + timedelta(days=days_from_today)).isoformat()
    res = client.post("/applications", json={"company": company, "role": role, "follow_up_date": when, **fields}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def run(db, outbox, on=TODAY, **kw):
    return run_follow_up_digests(db, outbox, on, **kw)


# --- off until switched on ---------------------------------------------------------


def test_reminders_are_off_for_a_new_account(client, db, outbox):
    headers = make_user(client)
    assert client.get("/auth/me", headers=headers).json()["reminder_emails"] is False
    assert db.scalar(select(User.reminder_emails)) is False


def test_an_account_that_never_opted_in_is_never_emailed_however_much_is_due(client, db, outbox):
    headers, _ = person(client, db, outbox, opted_in=False)
    follow_up(client, headers, -5)
    follow_up(client, headers, 0, company="Globex")
    result = run(db, outbox)
    assert (result.sent, result.skipped_unverified, outbox.sent) == (0, 0, [])


# --- exactly the right applications -------------------------------------------------


def test_due_today_and_overdue_are_included_future_and_undated_are_not(client, db, outbox):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 0, company="Today Co")
    follow_up(client, headers, -1, company="Yesterday Co")
    follow_up(client, headers, -30, company="Long Overdue Co")
    follow_up(client, headers, 1, company="Tomorrow Co")
    follow_up(client, headers, 30, company="Next Month Co")
    client.post("/applications", json={"company": "No Date Co", "role": "x"}, headers=headers)

    assert run(db, outbox).sent == 1
    (message,) = outbox.sent
    for listed in ("Today Co", "Yesterday Co", "Long Overdue Co"):
        assert listed in message.text, listed
    for left_out in ("Tomorrow Co", "Next Month Co", "No Date Co"):
        assert left_out not in message.text, left_out


@pytest.mark.parametrize("closed", ["rejected", "withdrawn", "offer_accepted", "offer_declined"])
def test_closed_applications_are_never_included(client, db, outbox, closed):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, -3, company="Closed Co", status=closed)
    assert run(db, outbox).sent == 0
    assert outbox.sent == []


@pytest.mark.parametrize("open_status", ["saved", "applied", "screening", "interview", "offer"])
def test_open_applications_are_included_including_a_saved_jobs_apply_by_date(client, db, outbox, open_status):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 0, company="Open Co", status=open_status)
    assert run(db, outbox).sent == 1
    assert "Open Co" in outbox.sent[0].text


def test_archived_applications_are_not_included(client, db, outbox):
    headers, _ = person(client, db, outbox)
    gone = follow_up(client, headers, -2, company="Archived Co")
    follow_up(client, headers, -2, company="Visible Co")
    client.patch(f"/applications/{gone['id']}", json={"archived": True}, headers=headers)
    run(db, outbox)
    assert "Visible Co" in outbox.sent[0].text and "Archived Co" not in outbox.sent[0].text


def test_an_application_that_is_closed_after_the_fact_drops_out(client, db, outbox):
    headers, _ = person(client, db, outbox)
    app_ = follow_up(client, headers, -2, status="interview")
    client.patch(f"/applications/{app_['id']}", json={"status": "rejected"}, headers=headers)
    assert run(db, outbox).sent == 0


def test_overdue_ones_keep_appearing_each_day_with_a_growing_count(client, db, outbox):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 0, company="Slipping Co")
    run(db, outbox, on=TODAY)
    run(db, outbox, on=TODAY + timedelta(days=3))
    assert "due today" in outbox.sent[0].text
    assert "3 days overdue" in outbox.sent[1].text


# --- one digest per person ----------------------------------------------------------


def test_someone_with_several_due_gets_one_email_listing_them_all(client, db, outbox):
    headers, _ = person(client, db, outbox)
    for i in range(5):
        follow_up(client, headers, -i, company=f"Co {i}", role=f"Role {i}")
    assert run(db, outbox).sent == 1
    (message,) = outbox.sent
    assert message.to == "me@example.com"
    assert message.subject == "Joblogga: 5 follow-ups due"
    assert all(f"Co {i}, Role {i}" in message.text for i in range(5))


def test_each_person_gets_their_own_digest_with_only_their_own_applications(client, db, outbox):
    a, _ = person(client, db, outbox, email="a@example.com")
    b, _ = person(client, db, outbox, email="b@example.com")
    follow_up(client, a, 0, company="Alpha Co")
    follow_up(client, b, 0, company="Beta Co")
    follow_up(client, b, -1, company="Beta Two")
    assert run(db, outbox).sent == 2
    by_recipient = {m.to: m for m in outbox.sent}
    assert "Alpha Co" in by_recipient["a@example.com"].text and "Beta" not in by_recipient["a@example.com"].text
    assert "Beta Co" in by_recipient["b@example.com"].text and "Beta Two" in by_recipient["b@example.com"].text
    assert "Alpha" not in by_recipient["b@example.com"].text


def test_a_person_with_nothing_due_gets_nothing(client, db, outbox):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 5)
    assert run(db, outbox).sent == 0


# --- verified addresses only ---------------------------------------------------------


def test_an_unverified_address_is_never_emailed_and_is_counted(client, db, outbox):
    headers, _ = person(client, db, outbox, verified=False)
    follow_up(client, headers, 0)
    result = run(db, outbox)
    assert (result.sent, result.skipped_unverified, outbox.sent) == (0, 1, [])


def test_verifying_later_makes_the_next_run_include_them(client, db, outbox):
    headers, user_id = person(client, db, outbox, verified=False)
    follow_up(client, headers, 0)
    run(db, outbox)
    user = db.get(User, user_id)
    user.email_verified_at = reminders.datetime.now(reminders.UTC)
    db.commit()
    assert run(db, outbox).sent == 1


def test_an_unverified_user_does_not_hold_up_a_verified_one(client, db, outbox):
    a, _ = person(client, db, outbox, email="a@example.com", verified=False)
    b, _ = person(client, db, outbox, email="b@example.com")
    follow_up(client, a, 0)
    follow_up(client, b, 0)
    result = run(db, outbox)
    assert (result.sent, result.skipped_unverified) == (1, 1)
    assert [m.to for m in outbox.sent] == ["b@example.com"]


# --- never twice in one day ----------------------------------------------------------


def test_running_again_the_same_day_sends_nothing_more(client, db, outbox):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 0)
    assert run(db, outbox).sent == 1
    assert run(db, outbox).sent == 0
    assert run(db, outbox).sent == 0
    assert len(outbox.sent) == 1


def test_the_next_day_sends_again(client, db, outbox):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, -2)
    run(db, outbox, on=TODAY)
    assert run(db, outbox, on=TODAY + timedelta(days=1)).sent == 1
    assert len(outbox.sent) == 2


def test_the_day_is_recorded_for_the_user(client, db, outbox):
    headers, user_id = person(client, db, outbox)
    follow_up(client, headers, 0)
    run(db, outbox)
    db.expire_all()
    assert db.get(User, user_id).reminder_last_sent_on == TODAY


def test_a_failed_send_is_not_counted_as_sent_and_the_next_run_tries_again(client, db, outbox):
    headers, user_id = person(client, db, outbox)
    follow_up(client, headers, 0)
    outbox.fail_with = RuntimeError("Resend is down")
    first = run(db, outbox)
    assert (first.sent, first.failed) == (0, 1)
    db.expire_all()
    assert db.get(User, user_id).reminder_last_sent_on is None  # given back: today's digest is still owed
    outbox.fail_with = None
    assert run(db, outbox).sent == 1


def test_a_failed_send_gives_back_the_previous_day_not_a_blank(client, db, outbox):
    headers, user_id = person(client, db, outbox)
    follow_up(client, headers, -3)
    run(db, outbox, on=TODAY)
    outbox.fail_with = RuntimeError("down")
    run(db, outbox, on=TODAY + timedelta(days=1))
    db.expire_all()
    assert db.get(User, user_id).reminder_last_sent_on == TODAY


def test_one_failure_does_not_stop_the_others(client, db, outbox):
    a, _ = person(client, db, outbox, email="a@example.com")
    b, _ = person(client, db, outbox, email="b@example.com")
    follow_up(client, a, 0)
    follow_up(client, b, 0)
    original = outbox.send

    def flaky(message):
        if message.to == "a@example.com":
            raise RuntimeError("bounced")
        original(message)

    outbox.send = flaky
    result = run(db, outbox)
    assert (result.sent, result.failed) == (1, 1)
    assert [m.to for m in outbox.sent] == ["b@example.com"]


def test_failures_are_logged_without_the_address_or_the_contents(client, db, outbox, caplog):
    headers, _ = person(client, db, outbox, email="private@example.com")
    follow_up(client, headers, 0, company="Secret Company Name")
    outbox.fail_with = RuntimeError("boom")
    with caplog.at_level("ERROR"):
        run(db, outbox)
    assert "Sending a follow-up digest failed" in caplog.text
    assert "private@example.com" not in caplog.text.replace("RuntimeError: boom", "")
    assert "Secret Company Name" not in caplog.text


def test_someone_who_switches_it_off_mid_run_is_not_emailed(client, db, outbox):
    a, a_id = person(client, db, outbox, email="a@example.com")
    b, b_id = person(client, db, outbox, email="b@example.com")
    follow_up(client, a, 0)
    follow_up(client, b, 0)
    original = outbox.send

    def switch_b_off_after_a(message):
        original(message)
        victim = db.get(User, b_id)
        victim.reminder_emails = False
        db.commit()

    outbox.send = switch_b_off_after_a
    result = run(db, outbox)
    assert [m.to for m in outbox.sent] == ["a@example.com"]  # the claim for b found them opted out
    assert result.sent == 1


def _change_b_after_a_is_sent(client, db, outbox, change):
    """Two opted-in, verified users with something due. After the first is emailed, `change(user_b)` is applied
    before the second is processed: what a parallel run, or the person themselves, can do in between."""
    a, _ = person(client, db, outbox, email="a@example.com")
    b, b_id = person(client, db, outbox, email="b@example.com")
    follow_up(client, a, 0)
    follow_up(client, b, 0)
    original = outbox.send

    def send(message):
        original(message)
        change(db.get(User, b_id))
        db.commit()

    outbox.send = send
    run(db, outbox)
    return [m.to for m in outbox.sent]


def test_a_digest_another_run_just_sent_is_not_sent_again(client, db, outbox):
    """The claim itself, not the earlier lookup, is what stops a parallel run from sending the same day twice."""
    sent = _change_b_after_a_is_sent(client, db, outbox, lambda u: setattr(u, "reminder_last_sent_on", TODAY))
    assert sent == ["a@example.com"]


def test_someone_whose_address_stops_being_verified_mid_run_is_not_emailed(client, db, outbox):
    sent = _change_b_after_a_is_sent(client, db, outbox, lambda u: setattr(u, "email_verified_at", None))
    assert sent == ["a@example.com"]


@pytest.mark.skipif(not __import__("tests.conftest", fromlist=["x"]).TEST_DATABASE_URL.startswith("postgres"), reason="needs concurrent Postgres connections")
def test_two_runs_at_the_same_moment_send_each_digest_once(client, db, outbox):
    users = []
    for i in range(6):
        headers, _ = person(client, db, outbox, email=f"u{i}@example.com")
        follow_up(client, headers, 0, company=f"Co {i}")
        users.append(headers)
    factory = app.dependency_overrides[get_session_factory]()
    barrier = threading.Barrier(2)

    def worker():
        with factory() as session:
            barrier.wait()
            run_follow_up_digests(session, outbox, TODAY)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(m.to for m in outbox.sent) == sorted(f"u{i}@example.com" for i in range(6))  # six, not twelve


# --- batches ---------------------------------------------------------------------------


def test_the_limit_stops_a_run_and_says_how_many_are_left(client, db, outbox):
    for i in range(3):
        headers, _ = person(client, db, outbox, email=f"u{i}@example.com")
        follow_up(client, headers, 0)
    first = run(db, outbox, limit=2)
    assert (first.sent, first.remaining) == (2, 1)
    second = run(db, outbox, limit=2)
    assert (second.sent, second.remaining) == (1, 0)
    assert len({m.to for m in outbox.sent}) == 3


# --- the email itself ------------------------------------------------------------------


def make(items, total=None, **kw):
    return follow_up_digest_message("me@example.com", items, total if total is not None else len(items), "https://x.test/applications", "https://x.test/account", "https://x.test/unsubscribe#token=T", **kw)


def test_the_subject_counts_and_never_contains_what_the_user_typed():
    one = make([DigestItem("<b>Evil</b> Co\nBcc: x@y.z", "Role", "Applied", 0)])
    assert one.subject == "Joblogga: 1 follow-up due"
    assert "Evil" not in one.subject and "\n" not in one.subject
    assert make([DigestItem("A", "B", "Applied", 0)] * 3).subject == "Joblogga: 3 follow-ups due"


def test_user_typed_text_is_escaped_in_the_html():
    message = make([DigestItem('<script>alert("x")</script> & Co', "<img src=x onerror=1>", "Applied", 1)])
    assert "<script>" not in message.html and "<img" not in message.html
    assert "&lt;script&gt;" in message.html and "&amp; Co" in message.html


@pytest.mark.parametrize("days,phrase", [(0, "due today"), (1, "1 day overdue"), (2, "2 days overdue"), (40, "40 days overdue")])
def test_how_late_each_one_is(days, phrase):
    message = make([DigestItem("Acme", "Eng", "Applied", days)])
    assert phrase in message.text and phrase in message.html


def test_a_long_list_is_cut_and_says_how_many_more():
    message = make([DigestItem(f"Co {i}", "Eng", "Applied", 0) for i in range(5)], total=27)
    assert "Joblogga: 27 follow-ups due" == message.subject
    assert "...and 22 more" in message.text and "and 22 more" in message.html


def test_the_run_lists_at_most_twenty_but_counts_them_all(client, db, outbox):
    headers, _ = person(client, db, outbox)
    for i in range(25):
        follow_up(client, headers, 0, company=f"Co {i:02d}", role=f"Role {i:02d}")
    run(db, outbox)
    (message,) = outbox.sent
    assert message.subject == "Joblogga: 25 follow-ups due"
    assert message.text.count("\n- ") == 20 and "...and 5 more" in message.text


def test_every_email_can_be_switched_off_in_two_ways_and_by_the_mail_client(client, db, outbox):
    headers, user_id = person(client, db, outbox)
    follow_up(client, headers, 0)
    run(db, outbox)
    (message,) = outbox.sent
    link = f"{settings.frontend_base}/unsubscribe#token={unsubscribe_token(user_id)}"
    assert link in message.text and link in message.html
    assert f"{settings.frontend_base}/account" in message.text
    assert message.headers == {"List-Unsubscribe": f"<{link}>"}


def test_the_status_is_shown_in_words(client, db, outbox):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 0, status="offer")
    run(db, outbox)
    assert "(Offer)" in outbox.sent[0].text


def test_the_mail_headers_reach_the_email_service_when_there_are_any(monkeypatch):
    import httpx

    sent = []

    class Client:
        def post(self, url, json, headers):
            sent.append(json)
            return httpx.Response(200, request=httpx.Request("POST", url))

    sender = mailer.ResendSender("key", "from@x.test", client=Client())  # type: ignore[arg-type]
    sender.send(mailer.EmailMessage("a@b.co", "s", "t", "<p>h</p>", {"List-Unsubscribe": "<https://x.test>"}))
    sender.send(mailer.EmailMessage("a@b.co", "s", "t", "<p>h</p>"))
    assert sent[0]["headers"] == {"List-Unsubscribe": "<https://x.test>"}
    assert "headers" not in sent[1]  # nothing added for the emails that do not need it


# --- the endpoint -----------------------------------------------------------------------


def call(client, secret_value=SECRET, **params):
    headers = {} if secret_value is None else {"X-Reminder-Secret": secret_value}  # str or raw bytes
    return client.post("/internal/send-follow-up-reminders", params=params, headers=headers)


@pytest.fixture
def today_is(monkeypatch):
    monkeypatch.setattr(reminders, "today", lambda: TODAY)


def test_it_cannot_be_called_without_the_secret(client, secret, outbox, db, today_is):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 0)
    res = call(client, None)
    assert res.status_code == 401
    assert outbox.sent == []


@pytest.mark.parametrize("wrong", ["", "wrong", SECRET[:-1], SECRET + "x", SECRET.upper(), " " + SECRET, ("é" * 20).encode()])  # the last as raw bytes: what a hostile client can send
def test_a_wrong_secret_is_refused_and_sends_nothing(client, secret, outbox, db, today_is, wrong):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 0)
    assert call(client, wrong).status_code == 401
    assert outbox.sent == []


def test_a_login_token_is_not_the_secret(client, secret, outbox, db, today_is):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 0)
    res = client.post("/internal/send-follow-up-reminders", headers=headers)  # an ordinary user's Authorization header
    assert res.status_code == 401 and outbox.sent == []


def test_with_no_secret_configured_it_is_switched_off_for_everyone(client, outbox, monkeypatch):
    monkeypatch.setattr(settings, "reminder_secret", None)
    assert call(client, "").status_code == 503
    assert call(client, "anything").status_code == 503
    assert call(client, None).status_code == 503


def test_the_right_secret_runs_it_and_reports_what_happened(client, secret, outbox, db, today_is):
    a, _ = person(client, db, outbox, email="a@example.com")
    person(client, db, outbox, email="u@example.com", verified=False)
    b, _ = person(client, db, outbox, email="b@example.com")
    u = db.scalar(select(User).where(User.email == "u@example.com"))
    follow_up(client, a, 0)
    follow_up(client, b, -1)
    ua = make_user(client, email="u@example.com", password="correct-horse-battery")
    follow_up(client, ua, 0)
    del u
    res = call(client)
    assert res.status_code == 200
    assert res.json() == {"date": TODAY.isoformat(), "sent": 2, "failed": 0, "skipped_unverified": 1, "remaining": 0}


def test_calling_it_twice_sends_nothing_the_second_time(client, secret, outbox, db, today_is):
    headers, _ = person(client, db, outbox)
    follow_up(client, headers, 0)
    assert call(client).json()["sent"] == 1
    assert call(client).json()["sent"] == 0
    assert len(outbox.sent) == 1


def test_the_limit_parameter_is_passed_on_and_checked(client, secret, outbox, db, today_is):
    for i in range(3):
        headers, _ = person(client, db, outbox, email=f"u{i}@example.com")
        follow_up(client, headers, 0)
    assert call(client, limit=2).json() | {"date": None} == {"date": None, "sent": 2, "failed": 0, "skipped_unverified": 0, "remaining": 1}
    assert call(client, limit=0).status_code == 422
    assert call(client, limit=501).status_code == 422


def test_it_refuses_to_run_without_an_email_key_instead_of_using_up_the_day(client, secret, db, today_is):
    # No outbox fixture: the real dependency, which with no RESEND_API_KEY is the do-nothing sender.
    app.dependency_overrides.pop(mailer_dependency(), None)
    headers = make_user(client)
    user = db.scalar(select(User))
    user.email_verified_at = reminders.datetime.now(reminders.UTC)
    user.reminder_emails = True
    db.commit()
    follow_up(client, headers, 0)
    res = call(client)
    assert res.status_code == 503 and "Email is not configured" in res.json()["detail"]
    db.expire_all()
    assert db.scalar(select(User.reminder_last_sent_on)) is None  # today's digest is still owed


def mailer_dependency():
    from app.deps import get_email_sender

    return get_email_sender


def test_guessing_the_secret_is_rate_limited_even_for_the_right_one_afterwards(client, secret, outbox, monkeypatch):
    now = [0.0]
    monkeypatch.setattr(ratelimit, "limits", RateLimits(lambda: now[0]))
    for _ in range(10):
        assert call(client, "guess").status_code == 401
    blocked = call(client, SECRET)
    assert blocked.status_code == 429 and "Retry-After" in blocked.headers
    now[0] += 15 * 60 + 1
    assert call(client, SECRET).status_code == 200


def test_correct_calls_do_not_count_against_the_guess_limit(client, secret, outbox, today_is, monkeypatch):
    monkeypatch.setattr(ratelimit, "limits", RateLimits())
    for _ in range(30):
        assert call(client).status_code == 200


def test_it_is_a_post_and_is_not_advertised_in_the_api_docs(client, secret):
    assert client.get("/internal/send-follow-up-reminders", headers={"X-Reminder-Secret": SECRET}).status_code == 405
    assert not [p for p in client.get("/openapi.json").json()["paths"] if p.startswith("/internal")]


# --- opting in and out -------------------------------------------------------------------


def test_switching_reminders_on_and_off_from_the_account(client, db, outbox):
    headers = make_user(client)
    on = client.patch("/auth/me", json={"reminder_emails": True}, headers=headers)
    assert on.status_code == 200 and on.json()["reminder_emails"] is True
    assert client.get("/auth/me", headers=headers).json()["reminder_emails"] is True
    off = client.patch("/auth/me", json={"reminder_emails": False}, headers=headers)
    assert off.json()["reminder_emails"] is False


def test_the_settings_endpoint_needs_a_login(client):
    assert client.patch("/auth/me", json={"reminder_emails": True}).status_code == 401


@pytest.mark.parametrize("bad", ["yes", "true", 1, 0, None, "on"])
def test_only_a_real_boolean_switches_emails_on(client, bad):
    headers = make_user(client)
    assert client.patch("/auth/me", json={"reminder_emails": bad}, headers=headers).status_code == 422
    assert client.get("/auth/me", headers=headers).json()["reminder_emails"] is False


def test_the_body_must_say_something(client):
    headers = make_user(client)
    assert client.patch("/auth/me", json={}, headers=headers).status_code == 422


def test_one_user_cannot_change_another_users_setting(client, db, outbox):
    a = make_user(client, email="a@example.com")
    b = make_user(client, email="b@example.com")
    client.patch("/auth/me", json={"reminder_emails": True}, headers=a)
    assert client.get("/auth/me", headers=b).json()["reminder_emails"] is False


def test_an_opt_in_made_through_the_api_takes_effect_on_the_next_run(client, db, outbox):
    headers = make_user(client)
    user = db.scalar(select(User))
    user.email_verified_at = reminders.datetime.now(reminders.UTC)
    db.commit()
    follow_up(client, headers, 0)
    assert run(db, outbox).sent == 0
    client.patch("/auth/me", json={"reminder_emails": True}, headers=headers)
    db.expire_all()
    assert run(db, outbox).sent == 1


# --- unsubscribing from the email ---------------------------------------------------------


def unsubscribe(client, token):
    return client.post("/auth/unsubscribe-reminders", json={"token": token})


def test_the_unsubscribe_token_names_its_user_and_nobody_else():
    assert user_id_from_unsubscribe_token(unsubscribe_token(7)) == 7
    assert unsubscribe_token(7) != unsubscribe_token(8)


@pytest.mark.parametrize("bad", ["", "7", "7.", "7.abc", ".abc", "x.y", "7.AAAA", "-7.abc", "7.7.7", "9" * 30 + ".abc", "٣.abc"])
def test_anything_that_is_not_a_valid_token_names_no_one(bad):
    assert user_id_from_unsubscribe_token(bad) is None


def test_a_token_cannot_be_moved_to_another_account():
    sig = unsubscribe_token(7).split(".", 1)[1]
    assert user_id_from_unsubscribe_token(f"8.{sig}") is None


def test_a_token_signed_with_another_key_is_refused(monkeypatch):
    token = unsubscribe_token(7)
    monkeypatch.setattr(settings, "secret_key", "a-completely-different-secret-key-0123456789")
    assert user_id_from_unsubscribe_token(token) is None


def test_the_link_switches_reminders_off_without_a_login(client, db, outbox):
    headers, user_id = person(client, db, outbox)
    res = unsubscribe(client, unsubscribe_token(user_id))
    assert res.status_code == 200 and "will not get follow-up reminder emails" in res.json()["detail"]
    db.expire_all()
    assert db.get(User, user_id).reminder_emails is False
    assert client.get("/auth/me", headers=headers).json()["reminder_emails"] is False


def test_unsubscribing_stops_the_digests_for_real(client, db, outbox):
    headers, user_id = person(client, db, outbox)
    follow_up(client, headers, 0)
    unsubscribe(client, unsubscribe_token(user_id))
    db.expire_all()
    assert run(db, outbox).sent == 0


def test_unsubscribing_twice_is_fine_and_leaves_other_accounts_alone(client, db, outbox):
    _, a_id = person(client, db, outbox, email="a@example.com")
    _, b_id = person(client, db, outbox, email="b@example.com")
    assert unsubscribe(client, unsubscribe_token(a_id)).status_code == 200
    assert unsubscribe(client, unsubscribe_token(a_id)).status_code == 200
    db.expire_all()
    assert db.get(User, a_id).reminder_emails is False and db.get(User, b_id).reminder_emails is True


def test_a_forged_token_is_refused_and_changes_nothing(client, db, outbox):
    _, user_id = person(client, db, outbox)
    for forged in (f"{user_id}.forged", f"{user_id}", "garbage"):
        assert unsubscribe(client, forged).status_code in (400, 422)
    db.expire_all()
    assert db.get(User, user_id).reminder_emails is True


def test_a_deleted_accounts_link_gets_the_same_refusal_as_a_forged_one(client, db, outbox):
    headers, user_id = person(client, db, outbox)
    token = unsubscribe_token(user_id)
    client.post("/auth/delete-account", json={"password": "correct-horse-battery"}, headers=headers)
    gone, forged = unsubscribe(client, token), unsubscribe(client, f"{user_id}.forged-signature-here")
    assert (gone.status_code, gone.json()) == (forged.status_code, forged.json())


def test_bad_tokens_are_rate_limited_but_good_ones_are_not_counted(client, db, outbox, monkeypatch):
    now = [0.0]
    monkeypatch.setattr(ratelimit, "limits", RateLimits(lambda: now[0]))
    _, user_id = person(client, db, outbox)
    for _ in range(5):
        assert unsubscribe(client, unsubscribe_token(user_id)).status_code == 200  # not counted
    for _ in range(20):
        assert unsubscribe(client, f"{user_id}.forged-signature-here").status_code == 400
    assert unsubscribe(client, f"{user_id}.forged-signature-here").status_code == 429
    now[0] += 15 * 60 + 1
    assert unsubscribe(client, unsubscribe_token(user_id)).status_code == 200


# --- the migration ---------------------------------------------------------------------------


def test_the_flag_defaults_to_off_in_the_model_and_the_database(client, db):
    make_user(client)
    user = db.scalar(select(User))
    assert user.reminder_emails is False and user.reminder_last_sent_on is None
    assert db.scalar(select(Application.id)) is None
