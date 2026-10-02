import math
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

    def test_exact_boundary_hits_expire_for_allow(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(10)
        self.assertTrue(self.limiter.allow("alice"))
        self.assertEqual(self.limiter.remaining("alice"), 2)

    def test_exact_boundary_hits_expire_for_remaining(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(10)
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertTrue(self.limiter.allow("alice"))
        self.assertEqual(self.limiter.remaining("alice"), 2)

    def test_hits_immediately_around_window_boundary(self):
        for now, expected_remaining, expected_allowed in (
            (math.nextafter(10.0, -math.inf), 0, False),
            (math.nextafter(10.0, math.inf), 3, True),
        ):
            with self.subTest(now=now):
                clock = FakeClock()
                limiter = SlidingWindowLimiter(limit=3, window_seconds=10, clock=clock)
                for _ in range(3):
                    self.assertTrue(limiter.allow("alice"))
                clock.advance(now)
                self.assertEqual(limiter.remaining("alice"), expected_remaining)
                self.assertEqual(limiter.allow("alice"), expected_allowed)

    def test_staggered_hits_expire_individually(self):
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(1)
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(1)
        self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(8)
        for _ in range(3):
            self.assertEqual(self.limiter.remaining("alice"), 1)
            self.assertTrue(self.limiter.allow("alice"))
            self.assertEqual(self.limiter.remaining("alice"), 0)
            self.clock.advance(1)

    def test_rejected_hits_do_not_extend_window(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        for _ in range(9):
            self.clock.advance(1)
            self.assertFalse(self.limiter.allow("alice"))
        self.clock.advance(1)
        self.assertEqual(self.limiter.remaining("alice"), 3)
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

    def test_reset_only_clears_selected_key(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        for _ in range(2):
            self.assertTrue(self.limiter.allow("bob"))
        self.limiter.reset("alice")
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual(self.limiter.remaining("bob"), 1)
        self.assertTrue(self.limiter.allow("bob"))
        self.assertFalse(self.limiter.allow("bob"))

    def test_reset_unknown_key_preserves_existing_histories(self):
        self.assertTrue(self.limiter.allow("alice"))
        self.assertTrue(self.limiter.allow("bob"))
        self.limiter.reset("unknown")
        self.assertEqual(self.limiter.remaining("alice"), 2)
        self.assertEqual(self.limiter.remaining("bob"), 2)

    def test_reset_falsy_key_preserves_other_histories(self):
        for key in (0, "", (), False):
            with self.subTest(key=key):
                limiter = SlidingWindowLimiter(limit=1, window_seconds=10, clock=self.clock)
                self.assertTrue(limiter.allow(key))
                self.assertTrue(limiter.allow("bob"))
                limiter.reset(key)
                self.assertTrue(limiter.allow(key))
                self.assertEqual(limiter.remaining("bob"), 0)
                self.assertFalse(limiter.allow("bob"))

    def test_rejects_invalid_configuration(self):
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=0, window_seconds=10)
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=1, window_seconds=0)


if __name__ == "__main__":
    unittest.main()
