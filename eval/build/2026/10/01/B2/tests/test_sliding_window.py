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

    def test_allow_at_window_boundary(self):
        for elapsed, expected in ((9.999999, False), (10.0, True), (10.000001, True)):
            with self.subTest(elapsed=elapsed):
                clock = FakeClock(start=100)
                limiter = SlidingWindowLimiter(limit=1, window_seconds=10, clock=clock)
                self.assertTrue(limiter.allow("alice"))
                clock.advance(elapsed)
                self.assertEqual(limiter.allow("alice"), expected)

    def test_remaining_at_window_boundary(self):
        for elapsed, expected in ((9.999999, 0), (10.0, 3), (10.000001, 3)):
            with self.subTest(elapsed=elapsed):
                clock = FakeClock(start=100)
                limiter = SlidingWindowLimiter(limit=3, window_seconds=10, clock=clock)
                for _ in range(3):
                    self.assertTrue(limiter.allow("alice"))
                clock.advance(elapsed)
                self.assertEqual(limiter.remaining("alice"), expected)

    def test_boundary_expires_only_old_hits(self):
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(2)
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(2)
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(6)
        self.assertEqual(self.limiter.remaining("alice"), 1)
        self.assertTrue(self.limiter.allow("alice"))
        self.assertFalse(self.limiter.allow("alice"))
        self.clock.advance(2)
        self.assertEqual(self.limiter.remaining("alice"), 1)

    def test_rejected_hits_do_not_extend_window(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(5)
        self.assertFalse(self.limiter.allow("alice"))
        self.clock.advance(5.5)
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertTrue(self.limiter.allow("alice"))

    def test_keys_are_independent(self):
        for _ in range(3):
            self.limiter.allow("alice")
        self.assertFalse(self.limiter.allow("alice"))
        self.assertTrue(self.limiter.allow("bob"))
        self.assertEqual(self.limiter.remaining("bob"), 2)

    def test_reset_key_preserves_other_keys_and_expiry(self):
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(5)
        for _ in range(3):
            self.assertTrue(self.limiter.allow("bob"))
        self.limiter.reset("alice")
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual(self.limiter.remaining("bob"), 0)
        self.assertFalse(self.limiter.allow("bob"))
        self.clock.advance(5)
        self.assertEqual(self.limiter.remaining("bob"), 0)
        self.clock.advance(5)
        self.assertEqual(self.limiter.remaining("bob"), 3)

    def test_reset_missing_key_leaves_existing_keys_unchanged(self):
        self.assertTrue(self.limiter.allow("alice"))
        self.assertTrue(self.limiter.allow("bob"))
        self.limiter.reset("missing")
        self.assertEqual(self.limiter.remaining("alice"), 2)
        self.assertEqual(self.limiter.remaining("bob"), 2)

    def test_reset_falsy_and_non_string_keys_only_clears_target(self):
        for key in (0, "", False, ("user", 1)):
            with self.subTest(key=key):
                limiter = SlidingWindowLimiter(limit=1, window_seconds=10, clock=self.clock)
                self.assertTrue(limiter.allow(key))
                self.assertTrue(limiter.allow("bob"))
                limiter.reset(key)
                self.assertTrue(limiter.allow(key))
                self.assertFalse(limiter.allow("bob"))

    def test_concurrent_calls_do_not_exceed_limit(self):
        with ThreadPoolExecutor(max_workers=8) as executor:
            accepted = list(executor.map(self.limiter.allow, ["alice"] * 64))
        self.assertEqual(sum(accepted), 3)
        self.assertEqual(self.limiter.remaining("alice"), 0)

    def test_reset_without_key_clears_everything(self):
        for key in ("alice", "bob"):
            for _ in range(3):
                self.limiter.allow(key)
        self.limiter.reset()
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual(self.limiter.remaining("bob"), 3)

    def test_rejects_invalid_configuration(self):
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=0, window_seconds=10)
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=1, window_seconds=0)


if __name__ == "__main__":
    unittest.main()
