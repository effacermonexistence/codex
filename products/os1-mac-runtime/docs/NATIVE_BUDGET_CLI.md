# Ordinary-run native dispatch and worker caps

`os1 run --max-native-dispatches N --max-parallel M` carries existing Core budget
fields, not a new scheduler. N is a canonical integer 1..64; M is 1..8. Repeated,
missing, zero, negative, signed, padded, fractional and out-of-range values reject
before Core submission. Legacy child/fanout paths reject these flags before
preparation, rather than silently ignoring a requested limit.

Absent flags retain the old unlimited-native numeric field (`nil`, not a claim
of available subscription quota) and max_parallel=4. `--forbid-model-generation`
still overrides numeric allowances. Parent/child retries and fallback dispatches
consume the existing durable Core native counter; old/unknown attempts are not
refunded. The displayed task worker limit carries the same M. Limits are per
submission, not a machine-wide cap; they do not count hidden provider-internal
model rounds. Local generation is a separate resource, not covered by N.

This exposes an existing exact executor constraint for bounded actual evaluation.
It is not quality parity, subscription savings or a new model-selection rule.
