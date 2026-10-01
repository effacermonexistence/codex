import unittest
from concurrent.futures import ThreadPoolExecutor

from ratekit import TokenBucket

from .fake_clock import FakeClock


class TokenBucketTest(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()

    def bucket(self, capacity=3, rate=1.0):
        return TokenBucket(capacity=capacity, refill_per_second=rate, clock=self.clock)

    def test_starts_full(self):
        self.assertEqual(self.bucket(capacity=5).tokens(), 5)

    def test_consume_until_empty(self):
        bucket = self.bucket(capacity=3)
        self.assertEqual([bucket.consume() for _ in range(4)], [True, True, True, False])

    def test_refills_over_time(self):
        bucket = self.bucket(capacity=2, rate=1.0)
        self.assertTrue(bucket.consume(2))
        self.assertFalse(bucket.consume())
        self.clock.advance(1.0)
        self.assertTrue(bucket.consume())
        self.assertFalse(bucket.consume())

    def test_reports_fractional_refill_without_double_counting(self):
        bucket = self.bucket(capacity=3, rate=2.5)
        self.assertTrue(bucket.consume(3))
        self.clock.advance(0.1)
        self.assertAlmostEqual(bucket.tokens(), 0.25)
        self.assertAlmostEqual(bucket.tokens(), 0.25)
        self.clock.advance(0.1)
        self.assertAlmostEqual(bucket.tokens(), 0.5)

    def test_frequent_polling_matches_single_refill(self):
        single_clock = FakeClock()
        single = TokenBucket(capacity=3, refill_per_second=2.5, clock=single_clock)
        polled = self.bucket(capacity=3, rate=2.5)
        self.assertTrue(single.consume(3))
        self.assertTrue(polled.consume(3))
        for _ in range(10):
            self.clock.advance(0.1)
            polled.tokens()
        single_clock.advance(self.clock.now)
        self.assertAlmostEqual(single.tokens(), 2.5)
        self.assertAlmostEqual(polled.tokens(), single.tokens())

    def test_frequent_failed_consumes_do_not_prevent_refill(self):
        bucket = self.bucket(capacity=1, rate=1.0)
        self.assertTrue(bucket.consume())
        # Binary-exact steps keep the success threshold deterministic.
        for _ in range(7):
            self.clock.advance(0.125)
            self.assertFalse(bucket.consume())
        self.clock.advance(0.125)
        self.assertTrue(bucket.consume())
        self.assertFalse(bucket.consume())
        self.assertEqual(bucket.tokens(), 0)

    def test_failed_consume_preserves_fractional_refill(self):
        bucket = self.bucket(capacity=2, rate=1.5)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(0.25)
        self.assertFalse(bucket.consume())
        self.assertEqual(bucket.tokens(), 0.375)
        self.assertTrue(bucket.consume(0.25))
        self.assertEqual(bucket.tokens(), 0.125)

    def test_never_exceeds_capacity(self):
        bucket = self.bucket(capacity=3, rate=10.0)
        self.clock.advance(100)
        self.assertEqual(bucket.tokens(), 3)

    def test_time_spent_full_is_not_banked(self):
        bucket = self.bucket(capacity=3, rate=2.0)
        self.clock.advance(100)
        self.assertTrue(bucket.consume(3))
        self.assertEqual(bucket.tokens(), 0)
        self.assertFalse(bucket.consume())
        self.clock.advance(0.125)
        self.assertEqual(bucket.tokens(), 0.25)
        self.assertTrue(bucket.consume(0.25))
        self.assertEqual(bucket.tokens(), 0)

    def test_zero_refill_rate_keeps_remaining_fraction(self):
        bucket = self.bucket(capacity=1.5, rate=0)
        self.assertTrue(bucket.consume(1.25))
        self.clock.advance(100)
        self.assertEqual(bucket.tokens(), 0.25)
        self.assertFalse(bucket.consume(0.5))
        self.assertTrue(bucket.consume(0.25))
        self.clock.advance(100)
        self.assertEqual(bucket.tokens(), 0)

    def test_concurrent_consumes_do_not_overspend_refilled_tokens(self):
        bucket = self.bucket(capacity=3, rate=2.5)
        self.assertTrue(bucket.consume(3))
        self.clock.advance(0.5)
        with ThreadPoolExecutor(max_workers=8) as executor:
            consumed = list(executor.map(bucket.consume, [0.25] * 32))
        self.assertEqual(sum(consumed), 5)
        self.assertEqual(bucket.tokens(), 0)

    def test_failed_consume_keeps_tokens(self):
        bucket = self.bucket(capacity=5)
        self.assertTrue(bucket.consume(4))
        self.assertFalse(bucket.consume(2))
        self.assertEqual(bucket.tokens(), 1)

    def test_consume_rejects_non_positive(self):
        bucket = self.bucket()
        with self.assertRaises(ValueError):
            bucket.consume(0)
        with self.assertRaises(ValueError):
            bucket.consume(-1)


if __name__ == "__main__":
    unittest.main()
