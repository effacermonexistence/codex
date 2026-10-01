import math
import unittest
from concurrent.futures import ThreadPoolExecutor

from ratekit import SlidingWindowLimiter

from .fake_clock import FakeClock


class SlidingWindowLimiterTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        self.limiter = SlidingWindowLimiter(limit=3, window_seconds=10, clock=self.clock)

    def test_allows_up_to_limit_then_rejects(self):
        self.assertEqual([self.limiter.allow("alice") for _ in range(4)], [True, True, True, False])

    def test_remaining_counts_down(self):
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.limiter.allow("alice")
        self.limiter.allow("alice")
        self.assertEqual(self.limiter.remaining("alice"), 1)

    def test_window_slides_after_hits_expire(self):
        for _ in range(3):
            self.limiter.allow("alice")
        self.clock.advance(5)
        self.assertFalse(self.limiter.allow("alice"))
        self.clock.advance(6.5)
        self.assertTrue(self.limiter.allow("alice"))
        self.assertEqual(self.limiter.remaining("alice"), 2)

    def test_allow_obeys_half_open_window(self):
        for now, allowed in (
            (math.nextafter(10.0, 0.0), False),
            (10.0, True),
            (math.nextafter(10.0, math.inf), True),
        ):
            with self.subTest(now=now):
                clock = FakeClock()
                limiter = SlidingWindowLimiter(limit=1, window_seconds=10, clock=clock)
                self.assertTrue(limiter.allow("alice"))
                clock.now = now
                self.assertEqual(limiter.allow("alice"), allowed)
                self.assertEqual(limiter.remaining("alice"), 0)

    def test_remaining_obeys_half_open_window(self):
        for now, remaining in (
            (math.nextafter(10.0, 0.0), 0),
            (10.0, 3),
            (math.nextafter(10.0, math.inf), 3),
        ):
            with self.subTest(now=now):
                clock = FakeClock()
                limiter = SlidingWindowLimiter(limit=3, window_seconds=10, clock=clock)
                for _ in range(3):
                    self.assertTrue(limiter.allow("alice"))
                clock.now = now
                self.assertEqual(limiter.remaining("alice"), remaining)
                self.assertEqual(limiter.remaining("alice"), remaining)

    def test_expiration_removes_only_old_prefix(self):
        self.assertTrue(self.limiter.allow("alice"))
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(1)
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(9)
        self.assertEqual(self.limiter.remaining("alice"), 2)
        self.assertTrue(self.limiter.allow("alice"))
        self.assertTrue(self.limiter.allow("alice"))
        self.assertFalse(self.limiter.allow("alice"))
        self.clock.advance(1)
        self.assertEqual(self.limiter.remaining("alice"), 1)

    def test_rejected_hits_do_not_extend_window(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(9)
        self.assertFalse(self.limiter.allow("alice"))
        self.assertFalse(self.limiter.allow("alice"))
        self.clock.advance(1)
        self.assertEqual([self.limiter.allow("alice") for _ in range(4)], [True, True, True, False])

    def test_keys_are_independent(self):
        for _ in range(3):
            self.limiter.allow("alice")
        self.assertFalse(self.limiter.allow("alice"))
        self.assertTrue(self.limiter.allow("bob"))
        self.assertEqual(self.limiter.remaining("bob"), 2)

    def test_reset_without_key_clears_everything(self):
        for key in ("alice", "bob"):
            for _ in range(3):
                self.limiter.allow(key)
        self.limiter.reset()
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual(self.limiter.remaining("bob"), 3)

    def test_reset_key_preserves_other_histories(self):
        for key in ("alice", "", 0, ("user", 1)):
            with self.subTest(key=key):
                limiter = SlidingWindowLimiter(limit=3, window_seconds=10, clock=self.clock)
                for _ in range(3):
                    self.assertTrue(limiter.allow(key))
                    self.assertTrue(limiter.allow("bob"))
                self.assertTrue(limiter.allow("carol"))
                limiter.reset(key)
                self.assertEqual(limiter.remaining(key), 3)
                self.assertEqual(limiter.remaining("bob"), 0)
                self.assertEqual(limiter.remaining("carol"), 2)
                self.assertFalse(limiter.allow("bob"))
                self.assertTrue(limiter.allow(key))
                limiter.reset(key)
                self.assertEqual(limiter.remaining(key), 3)
                self.assertEqual(limiter.remaining("bob"), 0)

    def test_reset_missing_key_preserves_all_histories(self):
        self.assertTrue(self.limiter.allow("alice"))
        self.assertTrue(self.limiter.allow("bob"))
        self.assertTrue(self.limiter.allow("bob"))
        self.limiter.reset("missing")
        self.assertEqual(self.limiter.remaining("alice"), 2)
        self.assertEqual(self.limiter.remaining("bob"), 1)
        self.assertEqual(self.limiter.remaining("missing"), 3)

    def test_concurrent_calls_respect_per_key_limit(self):
        keys = ["alice", "bob"] * 32
        with ThreadPoolExecutor(max_workers=8) as executor:
            allowed = list(executor.map(self.limiter.allow, keys))
        for key in ("alice", "bob"):
            accepted = sum(result for attempted, result in zip(keys, allowed) if attempted == key)
            self.assertEqual(accepted, 3)
            self.assertEqual(self.limiter.remaining(key), 0)

    def test_rejects_invalid_configuration(self):
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=0, window_seconds=10)
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=1, window_seconds=0)


if __name__ == "__main__":
    unittest.main()
