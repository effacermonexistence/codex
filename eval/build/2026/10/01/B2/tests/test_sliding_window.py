import unittest

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
        for elapsed, expected in ((9.999, False), (10.0, True), (10.001, True)):
            with self.subTest(elapsed=elapsed):
                clock = FakeClock()
                limiter = SlidingWindowLimiter(limit=1, window_seconds=10, clock=clock)
                self.assertTrue(limiter.allow("alice"))
                clock.advance(elapsed)
                self.assertEqual(limiter.allow("alice"), expected)

    def test_remaining_at_window_boundary(self):
        for elapsed, expected in ((9.999, 0), (10.0, 3), (10.001, 3)):
            with self.subTest(elapsed=elapsed):
                clock = FakeClock()
                limiter = SlidingWindowLimiter(limit=3, window_seconds=10, clock=clock)
                for _ in range(3):
                    self.assertTrue(limiter.allow("alice"))
                clock.advance(elapsed)
                self.assertEqual(limiter.remaining("alice"), expected)

    def test_boundary_expires_only_old_hits(self):
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(2)
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(8)
        self.assertEqual(self.limiter.remaining("alice"), 2)
        self.assertTrue(self.limiter.allow("alice"))
        self.assertEqual(self.limiter.remaining("alice"), 1)

    def test_rejected_hits_do_not_extend_window(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(9)
        self.assertFalse(self.limiter.allow("alice"))
        self.clock.advance(1)
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.assertFalse(self.limiter.allow("alice"))

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

    def test_reset_only_requested_key_preserves_other_history_and_expiry(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(4)
        for _ in range(2):
            self.assertTrue(self.limiter.allow("bob"))
        self.limiter.reset("alice")
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual(self.limiter.remaining("bob"), 1)
        self.clock.advance(6)
        self.assertEqual(self.limiter.remaining("bob"), 1)
        self.clock.advance(4)
        self.assertEqual(self.limiter.remaining("bob"), 3)

    def test_reset_unknown_key_preserves_every_history(self):
        self.assertTrue(self.limiter.allow("alice"))
        for _ in range(3):
            self.assertTrue(self.limiter.allow("bob"))
        self.limiter.reset("missing")
        self.assertEqual(self.limiter.remaining("alice"), 2)
        self.assertEqual(self.limiter.remaining("bob"), 0)
        self.assertFalse(self.limiter.allow("bob"))

    def test_reset_falsy_and_non_string_keys_is_scoped(self):
        for key in (0, False, "", (), ("user", 1)):
            with self.subTest(key=key):
                limiter = SlidingWindowLimiter(limit=1, window_seconds=10, clock=self.clock)
                self.assertTrue(limiter.allow(key))
                self.assertTrue(limiter.allow("other"))
                limiter.reset(key)
                self.assertEqual(limiter.remaining(key), 1)
                self.assertEqual(limiter.remaining("other"), 0)
                self.assertFalse(limiter.allow("other"))

    def test_rejects_invalid_configuration(self):
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=0, window_seconds=10)
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=1, window_seconds=0)


if __name__ == "__main__":
    unittest.main()
