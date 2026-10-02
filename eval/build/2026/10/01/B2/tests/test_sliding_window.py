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

    def test_remaining_at_window_boundary(self):
        for now, expected in ((9.75, 0), (10.0, 3), (10.25, 3)):
            with self.subTest(now=now):
                clock = FakeClock()
                limiter = SlidingWindowLimiter(limit=3, window_seconds=10, clock=clock)
                for _ in range(3):
                    self.assertTrue(limiter.allow("alice"))
                clock.now = now
                self.assertEqual(limiter.remaining("alice"), expected)

    def test_allow_at_window_boundary(self):
        for now, expected in ((9.75, False), (10.0, True), (10.25, True)):
            with self.subTest(now=now):
                clock = FakeClock()
                limiter = SlidingWindowLimiter(limit=1, window_seconds=10, clock=clock)
                self.assertTrue(limiter.allow("alice"))
                clock.now = now
                self.assertEqual(limiter.allow("alice"), expected)
                self.assertEqual(limiter.remaining("alice"), 0)

    def test_staggered_hits_expire_individually_at_their_boundaries(self):
        for now in (0.0, 2.0, 5.0):
            self.clock.now = now
            self.assertTrue(self.limiter.allow("alice"))
        self.clock.now = 9.75
        self.assertEqual(self.limiter.remaining("alice"), 0)
        self.assertFalse(self.limiter.allow("alice"))

        for now in (10.0, 12.0, 15.0):
            with self.subTest(now=now):
                self.clock.now = now
                self.assertEqual(self.limiter.remaining("alice"), 1)
                self.assertTrue(self.limiter.allow("alice"))
                self.assertEqual(self.limiter.remaining("alice"), 0)
                self.assertFalse(self.limiter.allow("alice"))

    def test_rejected_hits_do_not_extend_the_window(self):
        limiter = SlidingWindowLimiter(limit=1, window_seconds=10, clock=self.clock)
        self.assertTrue(limiter.allow("alice"))
        for now in (5.0, 9.0, 9.75):
            self.clock.now = now
            self.assertFalse(limiter.allow("alice"))
        self.clock.now = 10.25
        self.assertEqual(limiter.remaining("alice"), 1)
        self.assertTrue(limiter.allow("alice"))

    def test_remaining_queries_do_not_record_hits(self):
        for _ in range(3):
            self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertTrue(self.limiter.allow("alice"))
        for now in (1.0, 5.0, 9.0):
            self.clock.now = now
            self.assertEqual(self.limiter.remaining("alice"), 2)
        self.clock.now = 10.25
        self.assertEqual(self.limiter.remaining("alice"), 3)

    def test_keys_are_independent(self):
        for _ in range(3):
            self.limiter.allow("alice")
        self.assertFalse(self.limiter.allow("alice"))
        self.assertTrue(self.limiter.allow("bob"))
        self.assertEqual(self.limiter.remaining("bob"), 2)

    def test_reset_key_preserves_every_other_key(self):
        for key, hit_count in (("alice", 3), ("bob", 2), ("carol", 1)):
            for _ in range(hit_count):
                self.assertTrue(self.limiter.allow(key))
        self.limiter.reset("alice")
        self.assertEqual(self.limiter.remaining("alice"), 3)
        self.assertEqual(self.limiter.remaining("bob"), 1)
        self.assertEqual(self.limiter.remaining("carol"), 2)
        self.assertTrue(self.limiter.allow("bob"))
        self.assertFalse(self.limiter.allow("bob"))

    def test_reset_missing_key_is_a_no_op_for_existing_keys(self):
        for key, hit_count in (("alice", 3), ("bob", 2)):
            for _ in range(hit_count):
                self.assertTrue(self.limiter.allow(key))
        self.limiter.reset("missing")
        self.assertEqual(self.limiter.remaining("alice"), 0)
        self.assertEqual(self.limiter.remaining("bob"), 1)
        self.assertEqual(self.limiter.remaining("missing"), 3)
        self.assertFalse(self.limiter.allow("alice"))

    def test_reset_falsy_key_preserves_other_keys(self):
        for key in ("", 0, False):
            with self.subTest(key=key):
                limiter = SlidingWindowLimiter(limit=1, window_seconds=10, clock=self.clock)
                self.assertTrue(limiter.allow(key))
                self.assertTrue(limiter.allow("alice"))
                limiter.reset(key)
                self.assertEqual(limiter.remaining(key), 1)
                self.assertEqual(limiter.remaining("alice"), 0)
                self.assertFalse(limiter.allow("alice"))

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
