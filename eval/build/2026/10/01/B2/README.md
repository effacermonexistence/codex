# ratekit

Small, dependency-free, in-process rate limiting primitives (Python 3.9+).

```python
from ratekit import SlidingWindowLimiter, TokenBucket

per_user = SlidingWindowLimiter(limit=100, window_seconds=60)
if not per_user.allow(user_id):
    raise TooManyRequests()
per_user.remaining(user_id)   # hits left in the current window
per_user.reset(user_id)       # forget one key; reset() forgets every key

burst = TokenBucket(capacity=10, refill_per_second=2.5)
if burst.consume():           # consume(n=1) -> bool
    ...
burst.tokens()                # current, possibly fractional, level
```

Both classes accept `clock=` (a zero-argument callable returning seconds,
`time.monotonic` by default) so tests can use a fake clock. The exact
semantics are documented in the class and method docstrings.

## Tests

```sh
python3 -m unittest -v
```
