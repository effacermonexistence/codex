# Task-submit readiness witness

The same Core owner remains the only scheduler. This optional preparation
witness avoids one repeated health CLI bootstrap for a task submit; it is not
present connectivity, execution authority, source freshness or task success.
The existing authenticated submit/ACK, exact task/source/hash/revision,
unknown-effect reconciliation, cancellation and adoption paths are unchanged.

`enableTaskReadinessWitness = true` after independent frozen-source review and
zero-provider fake-transport regressions. Offline entry points retain explicit
default-OFF fixture parameters. Only `runBlocking` may opt into reuse.
Explicit warm/status/cancel retain fresh health; quiesce retains its existing
authenticated fresh quiescence RPC and cannot reuse a health witness.
The 60-second maximum age is a short advisory engineering bound, not a measured
continuity guarantee. Both monotonic uptime and wall time reject future/expiry.

Before reuse, retain current resource hashes, exact owner PID/OS start time /
executable, configuration identity, private full-config digest, owner custody
and installer-maintenance checks. The bounded strict positive witness binds
all Owner fields. It is private UID-owned0600, regular, nofollow, nlink1, and
read with descriptor/path stability checks. No task/proposal field supplies it.
This is the existing host-UID custody boundary, not cryptographic attestation
against a compromised same-UID writer. It never replaces submit authentication.

A file-only nonblocking witness lock prevents advisory state from stalling
readiness. Contention/missing/invalid/expired data falls back to existing full
readiness. Foreign/malformed/link artifacts are not overwritten or deleted.
Future/clock-invalid timestamps never permit reuse/refresh. A failed exact-owner
positive shape disables caching for that entire owner generation via an
exclusive nonblocking presence-only barrier, independent of the witness lock.
Any existing barrier (including unknown content/type) denies reuse. Neither fresh
health nor successful submit clears it; only actual owner retirement/replacement
allows a new directory's independent positive witness. Known positives may be
archived after failure/quiescence, but a held lock cannot prevent the barrier.
OFF/missing/unknown-witness paths create no witness artifacts on invalidation.
No credentials or task bodies enter the witness.

The existing fake Gateway fixture covers exact health callcounts, default OFF,
explicit observations, expiry/future/shape/Owner/custody faults, held-lock
fallback, combined future-clock/held-lock failure and sticky recovery, config tampering, lost/rejected ACK, quiescence and concurrency.
Fixtures inject opt-in only at temporary roots, with no actual model/provider.
Source activation is not an installation or latency-benefit receipt. Actual
latency reduction requires separate installed-path observation. Owner-policy Notes refresh is
unchanged; no TTL-only latest-RCC shortcut or new RPC transport is introduced.
