# Fleet heartbeat isolation

## Incident and invariant

Installed build87 passed real native Codex/Claude automatic execution, but the
Pro heartbeat reached 33,917 ms old during job completion. The placement service
correctly excludes nodes after 30,000 ms. Do not relax that safety threshold.

The main loop sends a heartbeat, performs up to four sequential result-status
reads, claims/delivers work, then sleeps 20 seconds. The work-only heartbeat loop
also performs result mirroring. Completion cancels that loop before delivery and
the main sleep. Thus result latency and phase transitions can starve liveness.

## Small change

After registration, start one lifetime-owned maintenance task with two independent
children: heartbeat (10 seconds after each attempt) and result mirror (5 seconds
after each batch). Neither performs provider execution. Keep claim/execution and
delivery serialized under the existing exclusive process lease. Preserve the
one-shot command's direct heartbeat/mirror semantics. Cancellation ends both
children; errors retry only their own read/heartbeat operation.

Keep auth local, unchanged signing and server policy, 30-second freshness gate,
nonce/idempotency, partial-work custody, dirty/source gates and existing hook
trust. Do not reinstall a stale app over the concurrent build88 work. Coordinate
the narrow Fleet patch before installing any shared runtime.

## Tests and completion

- A deliberately slow result mirror cannot delay heartbeats.
- Mirror and heartbeat failures are isolated; no provider/job replay is invoked.
- Cancelled maintenance stops both children; no overlapping mirror batches.
- Run existing HookSupport/runtime/Fleet checks and compile arm64.
- Install only after exact active work and binary checks; verify the installed
  source/hash and fresh heartbeat/topology samples for at least 90 seconds.
- Preserve the failed first trace. A later pass does not erase the incident or
  prove universal native routing. Follow-ups, non-Git and dirty workspaces remain
  explicit unmet classes for the user's broader objective.

Rollback: prior signed runtime and exact LaunchAgent, without restoring sessions,
credentials, models or user files. No server migration is required.
