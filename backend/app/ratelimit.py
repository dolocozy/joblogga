import ipaddress
import logging
import math
import time
from collections import OrderedDict, deque
from collections.abc import Callable, Mapping

logger = logging.getLogger("joblogga.ratelimit")


class SlidingWindowLimiter:
    """Allows `limit` events per `window` seconds for each key.

    A sliding window (not fixed buckets): an event counts until `window` seconds
    after it happened, so there is no moment at a bucket boundary where a burst
    of double the limit gets through. State lives in this process's memory, which
    is right for a single server; it resets on restart, and would move to Redis or
    the database if the API ever ran on several instances.
    """

    def __init__(self, limit: int, window: float, clock: Callable[[], float] = time.monotonic, max_keys: int = 50_000):
        self.limit = limit
        self.window = window
        self._clock = clock
        self._max_keys = max_keys
        # Least recently active key first, so eviction drops the stalest one.
        self._events: OrderedDict[str, deque[float]] = OrderedDict()
        self._records_since_sweep = 0

    def _drop_expired(self, events: deque[float], now: float) -> None:
        while events and events[0] <= now - self.window:
            events.popleft()

    def retry_after(self, key: str) -> int:
        """Seconds until `key` may act again: 0 if it is under the limit right now."""
        events = self._events.get(key)
        if not events:
            return 0
        now = self._clock()
        self._drop_expired(events, now)
        if len(events) < self.limit:
            return 0
        return max(1, math.ceil(events[0] + self.window - now))

    def record(self, key: str) -> None:
        now = self._clock()
        events = self._events.get(key)
        if events is None:
            events = self._events[key] = deque()
            if len(self._events) > self._max_keys:
                self._events.popitem(last=False)  # bound memory even under a flood of unique keys
        else:
            self._events.move_to_end(key)
        self._drop_expired(events, now)
        events.append(now)
        self._records_since_sweep += 1
        if self._records_since_sweep >= 1000:
            self._sweep(now)

    def _sweep(self, now: float) -> None:
        """Forget keys whose events have all expired, so idle keys don't pile up."""
        self._records_since_sweep = 0
        for key in [k for k, ev in self._events.items() if not ev or ev[-1] <= now - self.window]:
            del self._events[key]

    def reset(self, key: str) -> None:
        self._events.pop(key, None)

    def clear(self) -> None:
        self._events.clear()
        self._records_since_sweep = 0


class RateLimits:
    """The app's limits. Failed logins are counted three ways, each closing a gap the others leave:

    - per (address, email): stops guessing at one account. Keyed on the pair so an
      attacker failing from their own address cannot lock the real owner out.
    - per email, across all addresses: stops guessing spread over many addresses.
    - per address, across all emails: stops one address trying many accounts.

    Only failures count, and only a failure counts against the address: a normal
    login never uses up anyone's allowance.
    """

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self.login_ip_email = SlidingWindowLimiter(5, 15 * 60, clock)
        self.login_email = SlidingWindowLimiter(20, 60 * 60, clock)
        self.login_ip = SlidingWindowLimiter(50, 15 * 60, clock)
        self.signup_ip = SlidingWindowLimiter(10, 60 * 60, clock)
        # Reset emails cost money and land in someone's inbox. Per address, so one person
        # can't flood a victim's inbox; per account, so many addresses can't either.
        # Counted whether or not the account exists, so the limit reveals nothing about it.
        self.reset_ip = SlidingWindowLimiter(10, 60 * 60, clock)
        self.reset_email = SlidingWindowLimiter(3, 60 * 60, clock)
        # Only bad tokens count. Guessing one is hopeless (256 bits), but there is no reason to allow it.
        self.reset_confirm_ip = SlidingWindowLimiter(20, 15 * 60, clock)
        # Signup mail lands in the inbox of whoever's address was typed, so it is limited per
        # address. Unlike the limits above this one never produces an error: the reply must
        # be identical for every address, so past the limit the mail is silently not sent.
        self.signup_email = SlidingWindowLimiter(3, 60 * 60, clock)
        # "Resend verification" is for a logged-in user, so it is limited per account.
        self.verify_resend_user = SlidingWindowLimiter(3, 60 * 60, clock)
        # Only bad verification tokens count, as with reset tokens.
        self.verify_confirm_ip = SlidingWindowLimiter(20, 15 * 60, clock)

    def check_login(self, ip: str, email: str) -> tuple[str, int] | None:
        """(which limit, seconds to wait) if this attempt must be refused, else None."""
        waits = [
            ("login_ip_email", self.login_ip_email.retry_after(f"{ip}|{email}")),
            ("login_email", self.login_email.retry_after(email)),
            ("login_ip", self.login_ip.retry_after(ip)),
        ]
        blocked = [w for w in waits if w[1] > 0]
        # Report the longest wait, so the message is true for every limit that applies.
        return max(blocked, key=lambda w: w[1]) if blocked else None

    def record_login_failure(self, ip: str, email: str) -> None:
        self.login_ip_email.record(f"{ip}|{email}")
        self.login_email.record(email)
        self.login_ip.record(ip)

    def record_login_success(self, ip: str, email: str) -> None:
        # The genuine owner getting in wipes their own slate. The per-address and
        # per-email counters are left alone, so an attacker cannot reset them by
        # logging in to an account of their own between guesses.
        self.login_ip_email.reset(f"{ip}|{email}")

    def check_signup(self, ip: str) -> tuple[str, int] | None:
        wait = self.signup_ip.retry_after(ip)
        return ("signup_ip", wait) if wait > 0 else None

    def record_signup(self, ip: str) -> None:
        self.signup_ip.record(ip)

    def check_reset(self, ip: str, email: str) -> tuple[str, int] | None:
        waits = [("reset_ip", self.reset_ip.retry_after(ip)), ("reset_email", self.reset_email.retry_after(email))]
        blocked = [w for w in waits if w[1] > 0]
        return max(blocked, key=lambda w: w[1]) if blocked else None

    def record_reset(self, ip: str, email: str) -> None:
        self.reset_ip.record(ip)
        self.reset_email.record(email)

    def check_reset_confirm(self, ip: str) -> tuple[str, int] | None:
        wait = self.reset_confirm_ip.retry_after(ip)
        return ("reset_confirm_ip", wait) if wait > 0 else None

    def record_reset_confirm_failure(self, ip: str) -> None:
        self.reset_confirm_ip.record(ip)

    def signup_mail_allowed(self, email: str) -> bool:
        """Records the signup and says whether a mail may go to `email` (see signup_email)."""
        allowed = self.signup_email.retry_after(email) == 0
        self.signup_email.record(email)
        return allowed

    def check_verify_resend(self, user_id: int) -> tuple[str, int] | None:
        wait = self.verify_resend_user.retry_after(str(user_id))
        return ("verify_resend_user", wait) if wait > 0 else None

    def record_verify_resend(self, user_id: int) -> None:
        self.verify_resend_user.record(str(user_id))

    def check_verify_confirm(self, ip: str) -> tuple[str, int] | None:
        wait = self.verify_confirm_ip.retry_after(ip)
        return ("verify_confirm_ip", wait) if wait > 0 else None

    def record_verify_confirm_failure(self, ip: str) -> None:
        self.verify_confirm_ip.record(ip)

    def reset_all(self) -> None:
        for limiter in (
            self.login_ip_email,
            self.login_email,
            self.login_ip,
            self.signup_ip,
            self.reset_ip,
            self.reset_email,
            self.reset_confirm_ip,
            self.signup_email,
            self.verify_resend_user,
            self.verify_confirm_ip,
        ):
            limiter.clear()


# Routers read this as `ratelimit.limits` at call time, so tests can swap in one with a fake clock.
limits = RateLimits()


def wait_message(seconds: int) -> str:
    minutes = max(1, math.ceil(seconds / 60))
    return f"Too many attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}."


def _valid_ip(value: str | None) -> str | None:
    """The address in normal form, or None if `value` isn't an IP address at all."""
    if not value:
        return None
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def resolve_client_ip(
    peer: str | None,
    headers: Mapping[str, str],
    trusted_hops: int = 0,
    trusted_header: str | None = None,
) -> str:
    """The address the request really came from, decided only by things a client cannot forge.

    Rate limits are per client address, and clients control some of what arrives:

    - The connection address is the caller's only when nothing sits in front of the
      app. Behind a proxy that address is the proxy's, or, on hosts that tell the
      server to trust forwarding headers, whatever the client wrote at the start of
      X-Forwarded-For (measured on Render: a forged "6.6.6.6" became the connection
      address). So once a proxy is configured, it is never used.
    - X-Forwarded-For grows as it passes each proxy, each appending the address it
      received the request from. Entries on the LEFT may be the client's own
      inventions; taking the leftmost (a common shortcut) lets anyone choose their
      "address". Counting `trusted_hops` from the RIGHT reaches the entry written by
      the proxies we control.
    - A header the edge sets itself (Cloudflare's CF-Connecting-IP, which it
      overwrites or rejects if a client supplies one) is the most direct answer, so
      it is preferred when configured.

    If a proxy is configured but none of this yields an address, everything shares
    one "unknown" address. That can only make limits stricter, never let a forged
    address slip past them.
    """
    if trusted_hops <= 0 and not trusted_header:
        return peer or "unknown"  # nothing in front of us: the connection is the caller
    if trusted_header:
        found = _valid_ip(headers.get(trusted_header))
        if found:
            return found
    if trusted_hops > 0:
        entries = [e.strip() for e in (headers.get("x-forwarded-for") or "").split(",") if e.strip()]
        if len(entries) >= trusted_hops:
            found = _valid_ip(entries[-trusted_hops])
            if found:
                return found
    return "unknown"


def log_refusal(scope: str, ip: str, headers: Mapping[str, str], trusted_hops: int, trusted_header: str | None) -> None:
    # No email or password in the log line. The raw forwarding values and the
    # configuration are kept so the proxy setup can be checked against what the
    # host actually sends.
    logger.warning(
        "rate limited scope=%s ip=%s x_forwarded_for=%r %s=%r trusted_hops=%d",
        scope,
        ip,
        headers.get("x-forwarded-for"),
        trusted_header or "trusted_header",
        headers.get(trusted_header) if trusted_header else None,
        trusted_hops,
    )
