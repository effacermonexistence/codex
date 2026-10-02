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

    def test_consume_rejects_non_positive(self):
        bucket = self.bucket()
        with self.assertRaises(ValueError):
            bucket.consume(0)
        with self.assertRaises(ValueError):
            bucket.consume(-1)

    def test_tokens_reports_fractional_refill(self):
        bucket = self.bucket(capacity=2, rate=1.0)
        self.assertTrue(bucket.consume(2))

        self.clock.advance(0.25)

        self.assertEqual(bucket.tokens(), 0.25)
        self.assertTrue(bucket.consume(0.25))
        self.assertEqual(bucket.tokens(), 0)

    def test_frequent_tokens_calls_match_a_single_refill(self):
        frequent = self.bucket(capacity=3, rate=1.0)
        single = self.bucket(capacity=3, rate=1.0)
        self.assertTrue(frequent.consume(3))
        self.assertTrue(single.consume(3))

        for _ in range(10):
            self.clock.advance(0.1)
            frequent.tokens()

        self.assertAlmostEqual(frequent.tokens(), 1.0)
        self.assertAlmostEqual(frequent.tokens(), single.tokens())

    def test_frequent_failed_consumes_preserve_fractional_refill(self):
        bucket = self.bucket(capacity=3, rate=1.0)
        self.assertTrue(bucket.consume(3))

        for _ in range(10):
            self.clock.advance(0.1)
            self.assertFalse(bucket.consume(2))

        self.assertAlmostEqual(bucket.tokens(), 1.0)

    def test_frequent_consumes_eventually_have_a_whole_token(self):
        bucket = self.bucket(capacity=1, rate=1.0)
        self.assertTrue(bucket.consume())

        # Binary-exact increments isolate refill loss from float roundoff.
        for _ in range(7):
            self.clock.advance(0.125)
            self.assertFalse(bucket.consume())
        self.clock.advance(0.125)

        self.assertTrue(bucket.consume())
        self.assertEqual(bucket.tokens(), 0)

    def test_refill_rate_below_one_accumulates_across_calls(self):
        bucket = self.bucket(capacity=2, rate=0.5)
        self.assertTrue(bucket.consume(2))

        for _ in range(8):
            self.clock.advance(0.25)
            self.assertFalse(bucket.consume(2))

        self.assertEqual(bucket.tokens(), 1)
        self.assertTrue(bucket.consume())
        self.assertEqual(bucket.tokens(), 0)

    def test_failed_consume_does_not_spend_accrued_tokens(self):
        bucket = self.bucket(capacity=2, rate=1.0)
        self.assertTrue(bucket.consume(2))
        self.clock.advance(0.5)

        self.assertFalse(bucket.consume())
        self.assertEqual(bucket.tokens(), 0.5)
        self.assertTrue(bucket.consume(0.5))
        self.assertEqual(bucket.tokens(), 0)

    def test_fractional_capacity_starts_full_and_caps_refill(self):
        bucket = self.bucket(capacity=2.5, rate=0.5)
        self.assertEqual(bucket.tokens(), 2.5)
        self.assertTrue(bucket.consume(1.25))
        self.clock.advance(100)

        self.assertEqual(bucket.tokens(), 2.5)
        self.assertTrue(bucket.consume(2.5))
        self.clock.advance(0.25)
        self.assertEqual(bucket.tokens(), 0.125)

    def test_time_spent_full_is_not_banked(self):
        bucket = self.bucket(capacity=2, rate=1.0)
        self.clock.advance(100)
        self.assertTrue(bucket.consume(2))
        self.assertFalse(bucket.consume())

        self.clock.advance(0.25)

        self.assertEqual(bucket.tokens(), 0.25)

    def test_zero_refill_rate_never_replenishes(self):
        bucket = self.bucket(capacity=1.5, rate=0)
        self.assertTrue(bucket.consume(1.5))
        self.clock.advance(100)

        self.assertEqual(bucket.tokens(), 0)
        self.assertFalse(bucket.consume(0.5))

    def test_backward_clock_does_not_remove_tokens_or_double_refill(self):
        bucket = self.bucket(capacity=3, rate=1.0)
        self.assertTrue(bucket.consume(3))
        self.clock.advance(1)
        self.assertEqual(bucket.tokens(), 1)

        self.clock.advance(-0.5)
        self.assertEqual(bucket.tokens(), 1)
        self.assertTrue(bucket.consume())
        self.clock.advance(0.5)
        self.assertEqual(bucket.tokens(), 0)

        self.clock.advance(0.5)
        self.assertEqual(bucket.tokens(), 0.5)

    def test_repeated_calls_at_the_same_time_do_not_refill(self):
        bucket = self.bucket(capacity=1, rate=100)
        self.assertTrue(bucket.consume())

        for _ in range(10):
            self.assertEqual(bucket.tokens(), 0)
            self.assertFalse(bucket.consume())

    def test_constructor_rejects_invalid_capacity_and_rate(self):
        for capacity in (0, -1, -0.5):
            with self.subTest(capacity=capacity):
                with self.assertRaises(ValueError):
                    self.bucket(capacity=capacity)
        with self.assertRaises(ValueError):
            self.bucket(rate=-0.5)

    def test_consumption_larger_than_capacity_preserves_level(self):
        bucket = self.bucket(capacity=2.5, rate=0.5)

        self.assertFalse(bucket.consume(3))
        self.assertEqual(bucket.tokens(), 2.5)


if __name__ == "__main__":
    unittest.main()
