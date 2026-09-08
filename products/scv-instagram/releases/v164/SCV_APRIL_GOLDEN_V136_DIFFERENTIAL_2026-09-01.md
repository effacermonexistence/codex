# SCV April golden versus v136 differential

Date: 2026-09-01 (America/Los_Angeles)

## Evidence boundary

- April source: `scv-instagram-20260420T152810-local-origin`.
- v136 source: `scv-instagram-20260902T002911Z-v136-post-omar-reset-current`.
- Both were restored into separate read-only staging directories by the same timestamp restore tool. Both receipts report `ok: true`, `staged_only: true`, and `production_mutated: false`.
- April contains 37 restored files: code, prompt, runner, launch agents, environment material, and health/status metadata. Its own README says live inbox, outbox, thread-history, and thread-state packets are not included.
- v136 contains 245 runtime files and 1,255 production-state files.
- Because the April archive is not a full conversation corpus, this report treats it as a code/prompt/operational baseline, not proof of every historical response.

## Twelve-dimension comparison

| Dimension | April golden | v136 current | v137 decision |
| --- | --- | --- | --- |
| 1. Source completeness | Small origin snapshot; no live message/state packets | Full sealed runtime plus timestamped production state | Keep both snapshots separate; never overwrite the April reference |
| 2. Delivery availability | Health metadata shows inbound and both outbound services active | Production configuration permits a non-test global hold to pass single-release safety/readiness | Pin production `SCV_PAUSE_NON_TEST=0`; reject the hold in contract, startup safety, and readiness |
| 3. Runtime topology | Local launch-agent topology | Railway single-release supervisor with ten expected processes | Preserve the single-release topology and exact-worker verification |
| 4. Prompt and identity | One master prompt with Lua identity and conversational rules | April text is retained and extended by compact Responses authority, convergence, relationship, and word-choice locks | Preserve v136 prompt authority; do not wholesale roll back |
| 5. Tone and surface | Short, human, relationship-first language; information asks get a useful answer | Explicit April soul overlay, human-surface lock, April tone floor, and held-output regressions | Keep existing tone locks and their tests |
| 6. Conversation continuity | General naturalism, ambiguous-referent clarification, and question progression | Adds discourse authority, noisy-typo repair, atomic turns, fixed-script avoidance, and reply liveness | Preserve later continuity and liveness defenses |
| 7. Booking transitions | Form, date/time, four-field double check, then deposit | Adds date-floor authority, date-change divergence, form claim order, identity-ledger matching, and double-check confirmation gates | Preserve v136 booking fixes and regression coverage |
| 8. Media/reference handling | Prompt recognizes image/video/reference turns, but archive has no live media corpus | Adds attachment coalescing, media container, URL policy, vision authority, media-only inbound, and continuity tests | Preserve v136 media pipeline; April prompt remains a tone/intent guide only |
| 9. State and recovery | Restore procedure quarantines volatile state and recreates clean live dirs | Durable namespaces, control ledger, outbox adoption/idempotency, quarantine, deterministic recovery, and exact-target purge | Preserve v136 recovery architecture; create distinct timestamped pre/post points |
| 10. Security and authority | Basic inbound/outbound authority gates | Authenticated ingress/admin, loopback internals, sealed env/model contract, capability boundaries, immutable release inventory | Preserve all v136 security gates |
| 11. Observability and fail-close | Point-in-time health/status files | Supervisor, drift monitor, capability canary, readiness, fail-close latch, and evidence receipts | Change readiness so a silent business lane can never be green |
| 12. Rollback and custody | One local-origin timestamp | Sealed release, R2 catalog/restore tooling, production-state snapshot, GitHub custody, and sentinel | Seal v137, staged restore-drill it, archive it alongside—not over—the April and v136 points |

## Root cause and corrective scope

The material regression is not absence of the April conversation rules. Those rules are already present and strengthened in v136. The direct operational divergence is that the single-release production behavior contract, cloud safety gate, and `/readyz` all allowed `SCV_PAUSE_NON_TEST=1`. That value holds every non-allowlisted customer inbound while Omar.system continues to flow, so debug testing can appear healthy while the real-customer lane is silent.

v137 closes that escape at three independent layers:

1. the sealed production behavior contract pins `SCV_PAUSE_NON_TEST=0`;
2. cloud startup safety rejects any production value other than `0`;
3. production readiness reports `non_test_accounts_paused` whenever the business lane is closed.

Staging remains isolated with `SCV_PAUSE_NON_TEST=1`. The stale-backlog guard remains pinned to `SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE=1` and `SCV_HOLD_STALE_BACKLOG_MS=900000`, so reopening production does not flush old held work as new customer replies.

## Explicit non-changes

- No customer state or unrelated quarantine is modified by this differential analysis.
- No historical response claim is inferred from missing April live transcripts.
- No v136 date, double-check, information-request, media, delivery, security, or recovery fix is removed.
- The April golden and v136 timestamped snapshot remain independently restorable.
