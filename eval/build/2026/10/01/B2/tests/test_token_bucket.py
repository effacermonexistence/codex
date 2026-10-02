import unittest

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

    def test_never_exceeds_capacity(self):
        bucket = self.bucket(capacity=3, rate=10.0)
        self.clock.advance(100)
        self.assertEqual(bucket.tokens(), 3)

    def test_failed_consume_keeps_tokens(self):
        bucket = self.bucket(capacity=5)
        self.assertTrue(bucket.consume(4))
        self.assertFalse(bucket.consume(2))
        self.assertEqual(bucket.tokens(), 1)

    def test_fractional_capacity_rate_and_consumption(self):
        bucket = self.bucket(capacity=1.5, rate=0.5)
        self.assertTrue(bucket.consume(1.25))
        self.assertEqual(bucket.tokens(), 0.25)
        self.clock.advance(0.5)
        self.assertEqual(bucket.tokens(), 0.5)
        self.assertTrue(bucket.consume(0.5))
        self.assertEqual(bucket.tokens(), 0)

    def test_fractional_refill_is_visible_after_each_short_interval(self):
        bucket = self.bucket(capacity=2)
        self.assertTrue(bucket.consume(2))
        for step in range(1, 11):
            self.clock.advance(0.1)
            self.assertAlmostEqual(bucket.tokens(), step * 0.1)

    def test_frequent_token_reads_refill_as_fast_as_one_long_wait(self):
        sampled = self.bucket(capacity=2)
        unsampled = self.bucket(capacity=2)
        self.assertTrue(sampled.consume(2))
        self.assertTrue(unsampled.consume(2))
        for _ in range(8):
            self.clock.advance(0.125)
            sampled.tokens()
        self.assertEqual(unsampled.tokens(), 1)
        self.assertEqual(sampled.tokens(), unsampled.tokens())

    def test_short_failed_consumes_do_not_prevent_refill(self):
        bucket = self.bucket(capacity=2)
        self.assertTrue(bucket.consume(2))
        for _ in range(7):
            self.clock.advance(0.125)
            self.assertFalse(bucket.consume())
        self.clock.advance(0.125)
        self.assertTrue(bucket.consume())
        self.assertEqual(bucket.tokens(), 0)

    def test_failed_consume_preserves_fractional_refill(self):
        bucket = self.bucket(capacity=2)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(0.25)
        self.assertFalse(bucket.consume(0.5))
        self.assertEqual(bucket.tokens(), 0.25)
        self.assertTrue(bucket.consume(0.25))
        self.assertEqual(bucket.tokens(), 0)

    def test_refill_caps_at_fractional_capacity(self):
        bucket = self.bucket(capacity=1.5, rate=0.5)
        self.assertTrue(bucket.consume(1.5))
        self.clock.advance(10)
        self.assertEqual(bucket.tokens(), 1.5)

    def test_time_spent_full_is_not_banked(self):
        bucket = self.bucket(capacity=2)
        self.clock.advance(100)
        self.assertTrue(bucket.consume(2))
        self.assertEqual(bucket.tokens(), 0)
        self.clock.advance(1)
        self.assertTrue(bucket.consume())
        self.assertFalse(bucket.consume())

    def test_excess_refill_at_capacity_is_not_banked(self):
        bucket = self.bucket(capacity=2)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(100)
        self.assertEqual(bucket.tokens(), 2)
        self.assertTrue(bucket.consume(2))
        self.assertEqual(bucket.tokens(), 0)
        self.clock.advance(1)
        self.assertTrue(bucket.consume())
        self.assertFalse(bucket.consume())

    def test_zero_rate_does_not_refill(self):
        bucket = self.bucket(capacity=1.5, rate=0)
        self.assertTrue(bucket.consume(1))
        self.clock.advance(100)
        self.assertEqual(bucket.tokens(), 0.5)
        self.assertFalse(bucket.consume())
        self.assertTrue(bucket.consume(0.5))
        self.assertEqual(bucket.tokens(), 0)

    def test_zero_elapsed_time_does_not_refill(self):
        bucket = self.bucket(capacity=2, rate=100)
        self.assertTrue(bucket.consume(2))
        for _ in range(10):
            self.assertEqual(bucket.tokens(), 0)
            self.assertFalse(bucket.consume())

    def test_consume_rejects_non_positive(self):
        bucket = self.bucket()
        with self.assertRaises(ValueError):
            bucket.consume(0)
        with self.assertRaises(ValueError):
            bucket.consume(-1)


if __name__ == "__main__":
    unittest.main()
