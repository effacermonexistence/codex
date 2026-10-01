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

    def test_rejects_invalid_configuration(self):
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=0, window_seconds=10)
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=1, window_seconds=0)


if __name__ == "__main__":
    unittest.main()
