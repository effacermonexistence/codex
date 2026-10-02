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

    def test_refills_fractional_tokens(self):
        bucket = self.bucket(capacity=2, rate=2.5)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(0.1)
        self.assertAlmostEqual(bucket.tokens(), 0.25)
        self.clock.advance(0.1)
        self.assertAlmostEqual(bucket.tokens(), 0.5)

    def test_frequent_reads_match_single_refill(self):
        for rate in (0.3, 1.0, 2.5):
            with self.subTest(rate=rate):
                clock = FakeClock()
                polled = TokenBucket(capacity=10, refill_per_second=rate, clock=clock)
                unpolled = TokenBucket(capacity=10, refill_per_second=rate, clock=clock)
                self.assertTrue(polled.consume(10))
                self.assertTrue(unpolled.consume(10))
                for step in range(1, 21):
                    clock.advance(0.1)
                    self.assertAlmostEqual(polled.tokens(), step * 0.1 * rate)
                self.assertAlmostEqual(polled.tokens(), unpolled.tokens())

    def test_frequent_failed_consumes_do_not_starve_refill(self):
        bucket = self.bucket(capacity=1, rate=1.0)
        self.assertTrue(bucket.consume())
        for cycle in range(3):
            with self.subTest(cycle=cycle):
                for _ in range(7):
                    self.clock.advance(0.125)
                    self.assertFalse(bucket.consume())
                self.clock.advance(0.125)
                self.assertTrue(bucket.consume())
                self.assertEqual(bucket.tokens(), 0)

    def test_failed_consume_preserves_fractional_refill(self):
        bucket = self.bucket(capacity=2, rate=1.0)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(0.25)
        self.assertFalse(bucket.consume())
        self.assertEqual(bucket.tokens(), 0.25)
        self.assertFalse(bucket.consume())
        self.assertEqual(bucket.tokens(), 0.25)
        self.assertTrue(bucket.consume(0.125))
        self.assertEqual(bucket.tokens(), 0.125)

    def test_fractional_capacity_and_consumption(self):
        bucket = self.bucket(capacity=1.5, rate=0.5)
        self.assertEqual(bucket.tokens(), 1.5)
        self.assertTrue(bucket.consume(1.5))
        self.clock.advance(0.5)
        self.assertTrue(bucket.consume(0.25))
        self.assertEqual(bucket.tokens(), 0)

    def test_time_spent_full_is_not_banked(self):
        bucket = self.bucket(capacity=3, rate=2.5)
        self.clock.advance(100)
        self.assertTrue(bucket.consume(3))
        self.assertEqual(bucket.tokens(), 0)
        self.assertFalse(bucket.consume())
        self.clock.advance(0.1)
        self.assertAlmostEqual(bucket.tokens(), 0.25)
        self.assertFalse(bucket.consume())

    def test_zero_refill_rate_stays_empty(self):
        bucket = self.bucket(capacity=2, rate=0)
        self.assertTrue(bucket.consume(2))
        for _ in range(10):
            self.clock.advance(0.125)
            self.assertEqual(bucket.tokens(), 0)
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

    def test_consume_rejects_non_positive(self):
        bucket = self.bucket()
        with self.assertRaises(ValueError):
            bucket.consume(0)
        with self.assertRaises(ValueError):
            bucket.consume(-1)


if __name__ == "__main__":
    unittest.main()
