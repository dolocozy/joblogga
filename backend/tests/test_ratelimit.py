import pytest

from app import ratelimit
from app.config import settings
from app.deps import client_ip
from app.main import app
from app.ratelimit import RateLimits, SlidingWindowLimiter, resolve_client_ip, wait_message

GOOD = {"email": "me@example.com", "password": "correct-horse-battery"}


class Clock:
    """A clock the test moves by hand, so windows can be crossed instantly."""

    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


# --- SlidingWindowLimiter ---------------------------------------------------


def test_blocks_once_the_limit_is_reached_and_not_before():
    limiter = SlidingWindowLimiter(limit=3, window=60, clock=Clock())
    for _ in range(2):
        limiter.record("k")
        assert limiter.retry_after("k") == 0
    limiter.record("k")
    assert limiter.retry_after("k") > 0


def test_retry_after_counts_down_to_when_the_oldest_event_expires():
    clock = Clock()
    limiter = SlidingWindowLimiter(limit=2, window=60, clock=clock)
    limiter.record("k")  # t=0
    clock.advance(10)
    limiter.record("k")  # t=10
    assert limiter.retry_after("k") == 50  # the t=0 event frees a slot at t=60
    clock.advance(20)
    assert limiter.retry_after("k") == 30


def test_window_slides_instead_of_resetting_all_at_once():
    clock = Clock()
    limiter = SlidingWindowLimiter(limit=3, window=60, clock=clock)
    limiter.record("k")  # t=0
    clock.advance(20)
    limiter.record("k")  # t=20
    clock.advance(20)
    limiter.record("k")  # t=40: now full
    clock.advance(19)  # t=59
    assert limiter.retry_after("k") == 1  # still full; the t=0 event ages out at t=60
    clock.advance(1)  # t=60
    assert limiter.retry_after("k") == 0  # one slot freed while the other two events still count


def test_keys_are_independent():
    limiter = SlidingWindowLimiter(limit=1, window=60, clock=Clock())
    limiter.record("a")
    assert limiter.retry_after("a") > 0
    assert limiter.retry_after("b") == 0


def test_checking_does_not_use_up_the_allowance():
    limiter = SlidingWindowLimiter(limit=2, window=60, clock=Clock())
    limiter.record("k")
    for _ in range(10):
        limiter.retry_after("k")
    assert limiter.retry_after("k") == 0  # ten looks, still one event on record


def test_reset_forgets_one_key_only():
    limiter = SlidingWindowLimiter(limit=1, window=60, clock=Clock())
    limiter.record("a")
    limiter.record("b")
    limiter.reset("a")
    assert limiter.retry_after("a") == 0
    assert limiter.retry_after("b") > 0


def test_memory_is_bounded_by_dropping_the_least_recently_active_key():
    limiter = SlidingWindowLimiter(limit=1, window=60, clock=Clock(), max_keys=3)
    for key in ("a", "b", "c"):
        limiter.record(key)
    limiter.record("a")  # "a" is active again, so "b" is now the stalest
    limiter.record("d")  # over the cap
    assert len(limiter._events) == 3
    assert "b" not in limiter._events
    assert "a" in limiter._events


def test_idle_keys_are_swept_away():
    clock = Clock()
    limiter = SlidingWindowLimiter(limit=5, window=10, clock=clock)
    for i in range(999):
        limiter.record(f"old-{i}")
    clock.advance(20)  # all of them expired
    limiter.record("fresh")  # the 1000th record triggers a sweep
    assert set(limiter._events) == {"fresh"}


# --- the combined login/signup policy ---------------------------------------


def test_five_failures_from_one_address_for_one_account_lock_that_pair():
    limits = RateLimits(Clock())
    for _ in range(4):
        limits.record_login_failure("1.1.1.1", "a@x.com")
    assert limits.check_login("1.1.1.1", "a@x.com") is None
    limits.record_login_failure("1.1.1.1", "a@x.com")
    scope, wait = limits.check_login("1.1.1.1", "a@x.com")
    assert scope == "login_ip_email" and wait > 0


def test_an_attacker_locking_themselves_out_does_not_lock_the_real_owner_out():
    limits = RateLimits(Clock())
    for _ in range(5):
        limits.record_login_failure("6.6.6.6", "victim@x.com")  # the attacker's address
    assert limits.check_login("6.6.6.6", "victim@x.com") is not None
    assert limits.check_login("2.2.2.2", "victim@x.com") is None  # the owner, elsewhere


def test_guessing_spread_over_many_addresses_hits_the_per_account_limit():
    limits = RateLimits(Clock())
    for i in range(20):
        limits.record_login_failure(f"10.0.0.{i}", "victim@x.com")  # 20 different addresses
    scope, _ = limits.check_login("10.0.1.1", "victim@x.com")  # a brand-new address
    assert scope == "login_email"


def test_one_address_trying_many_accounts_hits_the_per_address_limit():
    limits = RateLimits(Clock())
    for i in range(50):
        limits.record_login_failure("9.9.9.9", f"user{i}@x.com")
    scope, _ = limits.check_login("9.9.9.9", "someone-new@x.com")
    assert scope == "login_ip"


def test_a_successful_login_clears_only_that_pair():
    limits = RateLimits(Clock())
    for _ in range(4):
        limits.record_login_failure("1.1.1.1", "a@x.com")
    limits.record_login_success("1.1.1.1", "a@x.com")
    for _ in range(4):
        limits.record_login_failure("1.1.1.1", "a@x.com")
    assert limits.check_login("1.1.1.1", "a@x.com") is None  # 4 since the reset, not 8
    # ...but the address-wide and account-wide tallies were not wiped by it.
    assert limits.login_ip._events["1.1.1.1"] and len(limits.login_ip._events["1.1.1.1"]) == 8


def test_reports_the_longest_wait_when_several_limits_apply():
    clock = Clock()
    limits = RateLimits(clock)
    for _ in range(20):
        limits.record_login_failure("1.1.1.1", "a@x.com")  # trips all of: pair (15 min), account (60 min)
    scope, wait = limits.check_login("1.1.1.1", "a@x.com")
    assert scope == "login_email"
    assert wait > 15 * 60


def test_signup_allows_ten_per_hour_per_address():
    clock = Clock()
    limits = RateLimits(clock)
    for _ in range(10):
        assert limits.check_signup("1.1.1.1") is None
        limits.record_signup("1.1.1.1")
    assert limits.check_signup("1.1.1.1") is not None
    assert limits.check_signup("2.2.2.2") is None
    clock.advance(3601)
    assert limits.check_signup("1.1.1.1") is None


@pytest.mark.parametrize(
    ("seconds", "text"),
    [(1, "Try again in 1 minute."), (60, "Try again in 1 minute."), (61, "Try again in 2 minutes."), (900, "Try again in 15 minutes.")],
)
def test_wait_message_rounds_up_to_whole_minutes(seconds, text):
    assert wait_message(seconds).endswith(text)


# --- the address behind proxies ---------------------------------------------

# Header values captured from the live Render service (client address replaced by a
# documentation address). Render's chain is: client -> Cloudflare -> Render's load
# balancer -> app, so X-Forwarded-For ends with [client, cloudflare edge, render internal].
REAL = "203.0.113.7"
RENDER_XFF = f"{REAL}, 172.70.80.71, 10.29.95.36"
# A client that sends its own X-Forwarded-For gets it PREPENDED, ahead of the real chain.
RENDER_XFF_FORGED = f"6.6.6.6,{REAL}, 172.71.150.25, 10.24.47.3"


@pytest.mark.parametrize(
    ("peer", "headers", "hops", "header", "expected"),
    [
        # Nothing in front of the app: the connection itself, and headers are not trusted at all.
        ("10.0.0.5", {}, 0, None, "10.0.0.5"),
        ("10.0.0.5", {"x-forwarded-for": "8.8.8.8"}, 0, None, "10.0.0.5"),
        (None, {}, 0, None, "unknown"),
        # Counting from the right: the entry the trusted proxies wrote.
        ("10.0.0.5", {"x-forwarded-for": "203.0.113.7"}, 1, None, "203.0.113.7"),
        ("10.0.0.5", {"x-forwarded-for": "6.6.6.6, 203.0.113.7"}, 1, None, "203.0.113.7"),  # client-written left side ignored
        ("10.0.0.5", {"x-forwarded-for": "a, b, 203.0.113.7, 172.16.0.9"}, 2, None, "203.0.113.7"),
        # Render's real chain (three hops from the right is the client).
        ("6.6.6.6", {"x-forwarded-for": RENDER_XFF}, 3, None, REAL),
        ("6.6.6.6", {"x-forwarded-for": RENDER_XFF_FORGED}, 3, None, REAL),  # forged prefix does not matter
        ("6.6.6.6", {"x-forwarded-for": RENDER_XFF_FORGED}, 1, None, "10.24.47.3"),  # the misconfiguration I first shipped: an internal address
        # A trusted header wins when present and valid, whatever X-Forwarded-For says.
        ("6.6.6.6", {"cf-connecting-ip": REAL, "x-forwarded-for": RENDER_XFF_FORGED}, 3, "cf-connecting-ip", REAL),
        ("6.6.6.6", {"cf-connecting-ip": "2001:0db8:0000:0000:0000:0000:0000:0001"}, 0, "cf-connecting-ip", "2001:db8::1"),  # normalised
        ("6.6.6.6", {"cf-connecting-ip": f"  {REAL}  "}, 0, "cf-connecting-ip", REAL),
        # ...and it falls back to counting hops if the header is missing or is not an address.
        ("6.6.6.6", {"x-forwarded-for": RENDER_XFF}, 3, "cf-connecting-ip", REAL),
        ("6.6.6.6", {"cf-connecting-ip": "not-an-ip", "x-forwarded-for": RENDER_XFF}, 3, "cf-connecting-ip", REAL),
        # Configured for a proxy but nothing usable arrived: one shared bucket. NEVER the
        # connection address (forgeable on Render) and never a value a client could choose.
        ("6.6.6.6", {}, 3, "cf-connecting-ip", "unknown"),
        ("6.6.6.6", {"x-forwarded-for": REAL}, 3, None, "unknown"),  # fewer entries than proxies
        ("6.6.6.6", {"cf-connecting-ip": "junk"}, 0, "cf-connecting-ip", "unknown"),
        ("6.6.6.6", {"x-forwarded-for": "6.6.6.6, junk, also-junk, more-junk"}, 3, None, "unknown"),  # position 3 from the right is not an address
    ],
)
def test_resolve_client_ip(peer, headers, hops, header, expected):
    assert resolve_client_ip(peer, headers, hops, header) == expected


def test_a_forger_can_never_choose_the_resolved_address():
    """Whatever a client puts in the parts of the request it controls, the result is the same."""
    real_chain = "172.70.80.71, 10.29.95.36"  # what the trusted infrastructure appends
    seen = {
        resolve_client_ip("6.6.6.6", {"x-forwarded-for": f"{forged}{REAL}, {real_chain}"}, 3, None)
        for forged in ("", "1.1.1.1,", "8.8.8.8, 9.9.9.9,", "junk,", "::1,")
    }
    assert seen == {REAL}


# --- the endpoints ----------------------------------------------------------


@pytest.fixture
def ip(client):
    """Lets a test choose which address its requests appear to come from."""
    state = {"value": "203.0.113.1"}
    app.dependency_overrides[client_ip] = lambda: state["value"]
    return state


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr(ratelimit, "limits", RateLimits(fake))
    return fake


def attempt(client, password="wrong-password-123", email=GOOD["email"]):
    return client.post("/auth/login", json={"email": email, "password": password})


def test_sixth_wrong_password_is_refused_with_429_and_retry_after(client, ip, clock):
    client.post("/auth/signup", json=GOOD)
    for _ in range(5):
        assert attempt(client).status_code == 401
    res = attempt(client)
    assert res.status_code == 429
    assert res.json() == {"detail": "Too many attempts. Try again in 15 minutes."}
    assert res.headers["retry-after"] == "900"


def test_the_right_password_is_refused_too_while_locked(client, ip, clock):
    client.post("/auth/signup", json=GOOD)
    for _ in range(5):
        attempt(client)
    assert attempt(client, password=GOOD["password"]).status_code == 429  # no free guess


def test_the_lock_lifts_after_the_window(client, ip, clock):
    client.post("/auth/signup", json=GOOD)
    for _ in range(5):
        attempt(client)
    assert attempt(client).status_code == 429
    clock.advance(15 * 60 + 1)
    assert attempt(client, password=GOOD["password"]).status_code == 200


def test_a_successful_login_resets_the_count(client, ip, clock):
    client.post("/auth/signup", json=GOOD)
    for _ in range(4):
        attempt(client)
    assert attempt(client, password=GOOD["password"]).status_code == 200
    for _ in range(4):
        assert attempt(client).status_code == 401  # still allowed: the slate was wiped


def test_unknown_emails_are_limited_exactly_like_real_ones(client, ip, clock):
    for _ in range(5):
        assert attempt(client, email="ghost@example.com").status_code == 401
    ghost = attempt(client, email="ghost@example.com")
    client.post("/auth/signup", json=GOOD)
    for _ in range(5):
        attempt(client)
    real = attempt(client)
    # Same status, same message: the limit does not reveal which emails exist.
    assert (ghost.status_code, ghost.json()) == (real.status_code, real.json()) == (429, ghost.json())


def test_other_accounts_and_other_addresses_are_unaffected(client, ip, clock):
    client.post("/auth/signup", json=GOOD)
    client.post("/auth/signup", json={"email": "other@example.com", "password": "correct-horse-battery"})
    for _ in range(5):
        attempt(client)
    assert attempt(client).status_code == 429
    assert attempt(client, email="other@example.com", password="correct-horse-battery").status_code == 200  # other account
    ip["value"] = "198.51.100.9"
    assert attempt(client, password=GOOD["password"]).status_code == 200  # the owner, from elsewhere


def test_signup_is_limited_per_address(client, ip, clock):
    for i in range(10):
        assert client.post("/auth/signup", json={"email": f"user{i}@example.com", "password": "correct-horse-battery"}).status_code == 201
    res = client.post("/auth/signup", json={"email": "user10@example.com", "password": "correct-horse-battery"})
    assert res.status_code == 429
    assert res.headers["retry-after"] == "3600"
    ip["value"] = "198.51.100.9"
    assert client.post("/auth/signup", json={"email": "user10@example.com", "password": "correct-horse-battery"}).status_code == 201


def test_invalid_signups_that_fail_validation_do_not_use_up_the_allowance(client, ip, clock):
    for _ in range(20):
        assert client.post("/auth/signup", json={"email": "nope", "password": "x"}).status_code == 422
    assert client.post("/auth/signup", json=GOOD).status_code == 201


def test_normal_use_is_never_slowed(client, ip, clock):
    client.post("/auth/signup", json=GOOD)
    for _ in range(30):  # far more logins than failures would ever allow
        assert attempt(client, password=GOOD["password"]).status_code == 200


def test_refusals_are_logged_without_secrets(client, ip, clock, caplog):
    client.post("/auth/signup", json=GOOD)
    for _ in range(5):
        attempt(client)
    with caplog.at_level("WARNING", logger="joblogga.ratelimit"):
        attempt(client)
    (record,) = [r for r in caplog.records if r.name == "joblogga.ratelimit"]
    assert "scope=login_ip_email" in record.getMessage()
    assert "x_forwarded_for=" in record.getMessage() and "trusted_hops=" in record.getMessage()
    assert "203.0.113.1" in record.getMessage()
    assert GOOD["email"] not in record.getMessage()
    assert "wrong-password" not in record.getMessage()


# --- spoofing through the real address parsing ------------------------------


def render_headers(client, forged_prefix=""):
    """What Render delivers for a request from `client` (optionally with a forged X-Forwarded-For prefix)."""
    return {"X-Forwarded-For": f"{forged_prefix}{client}, 172.70.80.71, 10.29.95.36", "CF-Connecting-IP": client}


@pytest.fixture
def on_render(monkeypatch):
    """The production configuration: trust Cloudflare's header, count 3 hops as the fallback."""
    monkeypatch.setattr(settings, "trusted_client_ip_header", "cf-connecting-ip")
    monkeypatch.setattr(settings, "trusted_proxy_hops", 3)


def bad_login(client, headers):
    return client.post("/auth/login", json={"email": GOOD["email"], "password": "nope-nope-nope"}, headers=headers).status_code


def test_forging_x_forwarded_for_does_not_dodge_the_limit(client, clock, on_render):
    client.post("/auth/signup", json=GOOD, headers=render_headers("203.0.113.50"))
    # The attacker invents a different "client" every time, in front of the real chain.
    statuses = [bad_login(client, render_headers("203.0.113.99", forged_prefix=f"{i}.{i}.{i}.{i},")) for i in range(6)]
    assert statuses == [401, 401, 401, 401, 401, 429]


def test_it_also_holds_when_only_the_x_forwarded_for_fallback_is_available(client, clock, monkeypatch):
    monkeypatch.setattr(settings, "trusted_client_ip_header", None)
    monkeypatch.setattr(settings, "trusted_proxy_hops", 3)
    client.post("/auth/signup", json=GOOD, headers=render_headers("203.0.113.50"))
    headers = lambda i: {"X-Forwarded-For": f"{i}.{i}.{i}.{i},203.0.113.99, 172.70.80.71, 10.29.95.36"}  # noqa: E731
    assert [bad_login(client, headers(i)) for i in range(6)] == [401, 401, 401, 401, 401, 429]


def test_a_rotating_infrastructure_address_does_not_split_one_client_into_many(client, clock, on_render):
    """The bug in my first version: the rightmost entry is Render's internal load balancer,
    which changes between requests, so one attacker looked like several."""
    client.post("/auth/signup", json=GOOD, headers=render_headers("203.0.113.50"))
    statuses = []
    for internal in ("10.24.36.13", "10.24.47.3", "10.29.95.36", "10.24.36.13", "10.24.47.3", "10.29.95.36"):
        headers = {"X-Forwarded-For": f"203.0.113.99, 172.70.80.71, {internal}", "CF-Connecting-IP": "203.0.113.99"}
        statuses.append(bad_login(client, headers))
    assert statuses == [401, 401, 401, 401, 401, 429]


def test_different_real_addresses_get_separate_allowances(client, clock, on_render):
    client.post("/auth/signup", json=GOOD, headers=render_headers("203.0.113.50"))
    for _ in range(5):
        bad_login(client, render_headers("203.0.113.99"))
    blocked = client.post("/auth/login", json=GOOD, headers=render_headers("203.0.113.99"))
    other = client.post("/auth/login", json=GOOD, headers=render_headers("203.0.113.77"))
    assert (blocked.status_code, other.status_code) == (429, 200)


def test_requests_that_arrive_without_the_expected_headers_share_one_stricter_bucket(client, clock, on_render):
    client.post("/auth/signup", json=GOOD, headers=render_headers("203.0.113.50"))
    assert [bad_login(client, {}) for _ in range(6)] == [401, 401, 401, 401, 401, 429]  # counted together, not free


def test_when_no_proxy_is_configured_headers_are_ignored_entirely(client, clock):
    client.post("/auth/signup", json=GOOD)
    forged = lambda i: {"X-Forwarded-For": f"{i}.{i}.{i}.{i}", "CF-Connecting-IP": f"9.9.9.{i}"}  # noqa: E731
    assert [bad_login(client, forged(i)) for i in range(6)] == [401, 401, 401, 401, 401, 429]
