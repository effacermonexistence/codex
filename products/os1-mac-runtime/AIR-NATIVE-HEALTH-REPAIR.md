# Air native-execution health repair

Local repair identity: `0.9.22/73.2-air-native-health-repair-20260907`.

Build 73.2 also synchronizes the heartbeat self-test instead of requiring a
detached task to start within a fixed 200 ms CI scheduling window. Production
heartbeat timing is unchanged. The original native-health and rejected-result
custody fixes remain in force; readiness is not permission to adopt a result.
The capability preflight also recognizes bounded lists of prohibited actions
(such as "Do not change files, run write commands, or alter settings") as
prohibitions. Mixed/conditional clauses and subsequent positive shell requests
remain constrained, and native read-only permissions are not widened.
This is an Air-specific continuation of build 73, not the newer Pro release.

## Boundary

The provider readiness cache describes whether a real native provider turn
completed and persisted. It is not a task acceptance receipt. Previously a
presentation/capability rejection occurred before native evidence construction,
then a synthetic unavailable artifact overwrote the original failure category.
The scheduler consequently marked an executable provider unavailable.

Each signed attempt now retains its own native execution evidence before task
validation. Successful process exit, nonempty output, native session identity,
verified persisted record, executable hash, runtime epoch, private file custody,
and current official local login status remain required. Authentication, quota,
permission, timeout, and genuinely unverified execution remain fail-closed.

Task validators and source/capability/quality checks remain authoritative for
adoption. A rejected paid candidate is retained in the delivery outbox with a
durable local-rejection veto; result recovery cannot promote it. Dispatched
write attempts cannot be automatically replayed on quota or verifier failure.
Past failed jobs are not replayed or relabeled by this repair.

## Scope and recovery

Use the existing `build-release.sh` and hash-verified `install-os1.sh` per-user
beta repair path. Preserve the installed app/CLI and exact Fleet LaunchAgent in
the install helper's timestamped rollback directory. This repair does not copy
authentication caches, replace provider credentials, or change EXO/ZeroTier,
models, Pro configuration, existing hook command strings or trust approvals.

Only new read-only validation jobs may establish fresh readiness for this build
epoch. A source test or historical successful run is not current live proof.
Universal package checks, installed self-tests, native provider probes,
automatic hook receipts, and a fresh two-node stability window must be recorded
separately before claiming completion.
