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

    def test_tokens_reports_fractional_refill(self):
        bucket = self.bucket(capacity=2, rate=2.5)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(0.1)
        self.assertAlmostEqual(bucket.tokens(), 0.25)
        self.assertAlmostEqual(bucket.tokens(), 0.25)

    def test_frequent_reads_refill_as_fast_as_one_read(self):
        for rate in (0.5, 2.5, 12.5):
            with self.subTest(rate=rate):
                clock = FakeClock()
                frequent = TokenBucket(capacity=100, refill_per_second=rate, clock=clock)
                once = TokenBucket(capacity=100, refill_per_second=rate, clock=clock)
                self.assertTrue(frequent.consume(100))
                self.assertTrue(once.consume(100))
                for _ in range(10):
                    clock.advance(0.1)
                    self.assertAlmostEqual(frequent.tokens(), clock() * rate)
                self.assertAlmostEqual(frequent.tokens(), once.tokens())

    def test_frequent_failed_consumption_accumulates_refill(self):
        bucket = self.bucket(capacity=1, rate=1)
        self.assertTrue(bucket.consume())
        for _ in range(7):
            self.clock.advance(0.125)
            self.assertFalse(bucket.consume())
        self.clock.advance(0.125)
        self.assertTrue(bucket.consume())
        self.assertEqual(bucket.tokens(), 0)

    def test_fractional_tokens_can_be_consumed(self):
        bucket = self.bucket(capacity=2.5, rate=1.5)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(0.25)
        self.assertTrue(bucket.consume(0.75))
        self.assertAlmostEqual(bucket.tokens(), 0.125)

    def test_never_exceeds_capacity(self):
        bucket = self.bucket(capacity=3, rate=10.0)
        self.clock.advance(100)
        self.assertEqual(bucket.tokens(), 3)

    def test_time_spent_full_is_not_banked(self):
        for initially_empty in (False, True):
            with self.subTest(initially_empty=initially_empty):
                clock = FakeClock()
                bucket = TokenBucket(capacity=2, refill_per_second=2, clock=clock)
                if initially_empty:
                    self.assertTrue(bucket.consume(2))
                clock.advance(100)
                self.assertEqual(bucket.tokens(), 2)
                self.assertTrue(bucket.consume(2))
                self.assertFalse(bucket.consume())
                clock.advance(0.25)
                self.assertAlmostEqual(bucket.tokens(), 0.5)

    def test_zero_refill_rate_keeps_level_unchanged(self):
        bucket = self.bucket(capacity=2.5, rate=0)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(100)
        self.assertFalse(bucket.consume())
        self.assertEqual(bucket.tokens(), 0.5)

    def test_failed_consume_keeps_tokens(self):
        bucket = self.bucket(capacity=5)
        self.assertTrue(bucket.consume(4))
        self.assertFalse(bucket.consume(2))
        self.assertEqual(bucket.tokens(), 1)

    def test_failed_consume_keeps_fractional_refill(self):
        bucket = self.bucket(capacity=2, rate=0.5)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(1)
        self.assertFalse(bucket.consume())
        self.assertAlmostEqual(bucket.tokens(), 0.5)
        self.clock.advance(1)
        self.assertTrue(bucket.consume())
        self.assertEqual(bucket.tokens(), 0)

    def test_concurrent_consumption_does_not_exceed_capacity(self):
        bucket = self.bucket(capacity=3)
        with ThreadPoolExecutor(max_workers=8) as executor:
            accepted = list(executor.map(lambda _: bucket.consume(), range(64)))
        self.assertEqual(sum(accepted), 3)
        self.assertEqual(bucket.tokens(), 0)

    def test_consume_rejects_non_positive(self):
        bucket = self.bucket()
        with self.assertRaises(ValueError):
            bucket.consume(0)
        with self.assertRaises(ValueError):
            bucket.consume(-1)


if __name__ == "__main__":
    unittest.main()
