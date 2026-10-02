"""Sliding-window rate limiting keyed by an arbitrary hashable key."""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Callable, Deque, Dict, Hashable, Optional

Clock = Callable[[], float]


class SlidingWindowLimiter:
    """Allow at most ``limit`` hits per key within a sliding time window.

    Every key (a user id, an API token, an IP address, ...) has its own
    independent history of accepted hits.

    Window semantics: the window is half-open. At time ``now`` a hit recorded
    at time ``t`` counts against its key if and only if
    ``now - window_seconds < t <= now``. A hit that is exactly
    ``window_seconds`` old has therefore expired and no longer counts, while a
    hit that is even slightly younger still counts.

    Only accepted hits are recorded: a call to :meth:`allow` that returns
    ``False`` leaves the key's history unchanged.

    ``clock`` is a zero-argument callable returning the current time in seconds
    as a float. It defaults to :func:`time.monotonic`; tests inject a fake
    clock. Instances are safe to share between threads.
    """

    def __init__(self, limit: int, window_seconds: float, clock: Clock = time.monotonic) -> None:
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise ValueError("limit must be a positive integer")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self.limit = limit
        self.window_seconds = float(window_seconds)
        self._clock = clock
        self._hits: Dict[Hashable, Deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: Hashable) -> bool:
        """Record a hit for ``key`` and return ``True`` if it fits within the limit.

        Returns ``False`` and records nothing when ``key`` already has ``limit``
        hits inside the current window.
        """
        with self._lock:
            now = self._clock()
            hits = self._live_hits(key, now)
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

    def remaining(self, key: Hashable) -> int:
        """Return how many more hits ``key`` may make right now (never negative)."""
        with self._lock:
            now = self._clock()
            return max(0, self.limit - len(self._live_hits(key, now)))

    def reset(self, key: Optional[Hashable] = None) -> None:
        """Forget recorded hits.

        ``reset(key)`` forgets only the hits of ``key``; every other key keeps
        its history. ``reset()`` with no argument forgets the hits of every key.
        """
        with self._lock:
            targets = list(self._hits) if key is None else [key]
            for target in targets:
                self._hits.pop(target, None)

    def _live_hits(self, key: Hashable, now: float) -> Deque[float]:
        """Return the hit history of ``key`` after dropping expired hits."""
        hits = self._hits.setdefault(key, deque())
        cutoff = now - self.window_seconds
        while hits and hits[0] <= cutoff:
            hits.popleft()
        return hits
