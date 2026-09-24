import logging
import math
import time
from collections import OrderedDict, deque
from collections.abc import Callable

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

    def reset_all(self) -> None:
        for limiter in (self.login_ip_email, self.login_email, self.login_ip, self.signup_ip):
            limiter.clear()


# Routers read this as `ratelimit.limits` at call time, so tests can swap in one with a fake clock.
limits = RateLimits()


def wait_message(seconds: int) -> str:
    minutes = max(1, math.ceil(seconds / 60))
    return f"Too many attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}."


def resolve_client_ip(peer: str | None, forwarded_for: str | None, trusted_hops: int) -> str:
    """The address the request really came from.

    With no proxy in front (trusted_hops = 0) that is the direct connection. Behind
    N trusted proxies, each one appends the address it received the request from to
    X-Forwarded-For, so the client's address is the Nth entry *from the right*.
    Entries further left were written by the client itself and are ignored: taking
    the leftmost one (a common shortcut) lets anyone pick their own "address" and
    dodge every per-address limit.
    """
    if trusted_hops > 0 and forwarded_for:
        entries = [e.strip() for e in forwarded_for.split(",") if e.strip()]
        if len(entries) >= trusted_hops:
            return entries[-trusted_hops]
    return peer or "unknown"


def log_refusal(scope: str, ip: str, forwarded_for: str | None, trusted_hops: int) -> None:
    # No email or password in the log line. The raw header and hop count are kept so
    # the proxy setup can be checked against what the host actually sends.
    logger.warning("rate limited scope=%s ip=%s x_forwarded_for=%r trusted_hops=%d", scope, ip, forwarded_for, trusted_hops)
