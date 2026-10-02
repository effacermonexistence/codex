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

    def test_allow_expires_hits_at_exact_window_boundary(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(9.5)
        self.assertFalse(self.limiter.allow("alice"))
        self.clock.advance(0.5)
        self.assertTrue(self.limiter.allow("alice"))
        self.assertEqual(self.limiter.remaining("alice"), 2)

    def test_remaining_expires_hits_at_exact_window_boundary(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(9.5)
        self.assertEqual(self.limiter.remaining("alice"), 0)
        self.clock.advance(0.5)
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual(self.limiter.remaining("alice"), 3)

    def test_hits_one_float_step_younger_than_window_still_count(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(math.nextafter(10.0, 0.0))
        self.assertEqual(self.limiter.remaining("alice"), 0)
        self.assertFalse(self.limiter.allow("alice"))

    def test_expiration_preserves_younger_hits(self):
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
        self.assertTrue(self.limiter.allow("alice"))
        self.assertEqual(self.limiter.remaining("alice"), 0)

    def test_rejected_hits_do_not_extend_window(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        for _ in range(5):
            self.clock.advance(1.5)
            self.assertFalse(self.limiter.allow("alice"))
        self.clock.advance(3.5)
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual([self.limiter.allow("alice") for _ in range(4)], [True, True, True, False])

    def test_remaining_does_not_record_hits(self):
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.clock.advance(5)
        self.assertEqual(self.limiter.remaining("alice"), 3)
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

    def test_reset_key_preserves_other_keys_history(self):
        for _ in range(3):
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.advance(4)
        for _ in range(3):
            self.assertTrue(self.limiter.allow("bob"))

        self.limiter.reset("alice")
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual(self.limiter.remaining("bob"), 0)
        self.assertTrue(self.limiter.allow("alice"))
        self.assertFalse(self.limiter.allow("bob"))
        self.clock.advance(7)
        self.assertEqual(self.limiter.remaining("bob"), 0)
        self.clock.advance(4)
        self.assertEqual(self.limiter.remaining("bob"), 3)

    def test_reset_missing_key_leaves_existing_histories_unchanged(self):
        for key in ("alice", "bob"):
            self.assertTrue(self.limiter.allow(key))
            self.assertTrue(self.limiter.allow(key))
        self.limiter.reset("missing")
        self.assertEqual(self.limiter.remaining("alice"), 1)
        self.assertEqual(self.limiter.remaining("bob"), 1)

    def test_reset_falsy_key_only_clears_that_key(self):
        for key in (0, False, "", (), frozenset()):
            with self.subTest(key=key):
                limiter = SlidingWindowLimiter(limit=3, window_seconds=10, clock=self.clock)
                for _ in range(3):
                    self.assertTrue(limiter.allow(key))
                    self.assertTrue(limiter.allow("other"))
                limiter.reset(key)
                self.assertEqual(limiter.remaining(key), 3)
                self.assertEqual(limiter.remaining("other"), 0)

    def test_reset_all_clears_arbitrary_hashable_keys(self):
        keys = ("alice", 0, (), frozenset({"bob"}), None)
        for key in keys:
            for _ in range(3):
                self.assertTrue(self.limiter.allow(key))
        self.limiter.reset()
        for key in keys:
            with self.subTest(key=key):
                self.assertEqual(self.limiter.remaining(key), 3)
                self.assertTrue(self.limiter.allow(key))

    def test_rejects_invalid_configuration(self):
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=0, window_seconds=10)
        with self.assertRaises(ValueError):
            SlidingWindowLimiter(limit=1, window_seconds=0)


if __name__ == "__main__":
    unittest.main()
