"""ratekit: small in-process rate limiting primitives.

* :class:`SlidingWindowLimiter` -- at most ``limit`` accepted hits per key in
  any sliding window of ``window_seconds``.
* :class:`TokenBucket` -- a bucket of ``capacity`` tokens refilled
  continuously at ``refill_per_second``.

Both take an injectable ``clock`` (a zero-argument callable returning seconds
as a float, :func:`time.monotonic` by default) so behaviour can be tested
without sleeping.
"""

from .sliding_window import SlidingWindowLimiter
from .token_bucket import TokenBucket

__all__ = ["SlidingWindowLimiter", "TokenBucket"]
__version__ = "0.4.2"
