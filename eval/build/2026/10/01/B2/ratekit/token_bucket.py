"""Token-bucket rate limiting with continuous refill."""

from __future__ import annotations

import threading
import time
from typing import Callable

Clock = Callable[[], float]


class TokenBucket:
    """A bucket holding up to ``capacity`` tokens, refilled continuously.

    The bucket starts full. Tokens accrue continuously at ``refill_per_second``
    tokens per second of elapsed clock time, including fractional tokens: many
    calls 0.1 s apart refill the bucket exactly as fast as a single call made
    after the same total time. The level is capped at ``capacity``; time spent
    full is not banked for later.

    :meth:`consume` removes tokens only when enough are available, and
    :meth:`tokens` reports the current, possibly fractional, level.

    ``clock`` is a zero-argument callable returning the current time in seconds
    as a float. It defaults to :func:`time.monotonic`; tests inject a fake
    clock. Instances are safe to share between threads.
    """

    def __init__(self, capacity: float, refill_per_second: float, clock: Clock = time.monotonic) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if refill_per_second < 0:
            raise ValueError("refill_per_second must not be negative")
        self.capacity = capacity
        self.refill_per_second = refill_per_second
        self._clock = clock
        self._tokens = float(capacity)
        self._updated = clock()
        self._lock = threading.Lock()

    def consume(self, n: float = 1) -> bool:
        """Take ``n`` tokens if they are available.

        Returns ``True`` and removes ``n`` tokens when at least ``n`` are
        available; otherwise returns ``False`` and leaves the level unchanged.
        Raises :class:`ValueError` if ``n`` is not positive.
        """
        if n <= 0:
            raise ValueError("n must be positive")
        with self._lock:
            self._refill()
            if self._tokens < n:
                return False
            self._tokens -= n
            return True

    def tokens(self) -> float:
        """Return the current number of tokens (may be fractional)."""
        with self._lock:
            self._refill()
            return self._tokens

    def _refill(self) -> None:
        """Add the tokens earned since the last update, capped at capacity."""
        now = self._clock()
        elapsed = now - self._updated
        if elapsed <= 0:
            return
        earned = int(elapsed * self.refill_per_second)
        self._tokens = min(float(self.capacity), self._tokens + earned)
        self._updated = now
