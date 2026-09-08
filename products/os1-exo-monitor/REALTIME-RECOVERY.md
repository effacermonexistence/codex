# Live Activity Monitor recovery (2026-09-08)

Objective: retain EXO's shared Activity page and display independent, continuously refreshed measured telemetry for each Mac, with explicit stale/unavailable states. Do not claim macOS transparent resource pooling or fabricate unavailable sensor values.

Observed boundary: Pro port 52415 belongs to the original `com.os1.exo-pro` packaged binary and returns 404 at `/activity/local`. The verified monitor `com.os1.exo-pro-stable` is also loaded but repeatedly exits. Both LaunchAgents contend for the same API/P2P ports after login. Air's activity endpoint responds with live measurements.

Existing frontend starts `/state` before telemetry and waits for every node's seven-second timeout before painting any fresh result. A slow/disconnected peer can freeze local updates. It also labels a poll as refreshed even when every telemetry fetch failed, substitutes missing values with zero, and may poll the same local node via localhost and ZeroTier, producing near-zero measurement intervals.

Minimal repair:

1. Back up both exact service definitions and launchd override evidence. Verify no EXO instances/runners/tasks. Disable and unload only duplicate original Pro service, start the existing monitor service, verify API/identity/topology. Rollback restores original service if monitor cannot start; no model/event-log/credential edits.
2. Decouple topology discovery and per-origin telemetry polling. Paint each node as soon as its request completes; one in-flight request per origin, bounded timeout, deduplicate node/sample IDs, explicit endpoint failure and real sample age. Local updates continue without cluster or Air availability.
3. Sample local resource counters at a bounded interval, independent of browser count. Do not turn missing/stale sensors into current zeroes. Show live/pause/refresh frequency and rolling charts; use honest unknowns in totals/balance.
4. Test failed `/state`, slow/offline peer, duplicate local origins, stale timestamps, tab cleanup, repeated readers, and real changing samples. Install a staged dashboard/runtime without touching signed EXO.app or active user inference. Verify both node samples over time and the actual rendered page.

Five views: intent is live monitoring; continuity preserves existing Air sensor corrections and stable Pro runtime; execution checks the real listening process; output freshness uses actual measurements rather than request success; performance isolates Fleet refresh and avoids per-view samplers. Security: no SSIDs, arguments, prompts, credentials, or unbounded process dumps; existing model/event logs preserved.

Rollback: retain the prior exact LaunchAgents, managed executable/dashboard, and source changes separately. Never restore or delete user conversations, models, logs, or authentication caches.

## Execution evidence

- Duplicate original Pro agent disabled, not deleted. Only the managed EXO service is active; signed EXO.app untouched.
- Startup validation reproduced an additional roaming-guard failure: its retained failure timer killed a progressing 31,000-event replay. Installations now pause the exact guard and restore it on rollback; replay progress defers recovery without resetting the hourly attempt budget.
- Existing macmon binary produced nonzero GPU, temperature and watts. Pro observes that same EXO-owned stream; missing readings are explicitly unavailable. Air's maintained sensor patch was incorporated additively, retaining roaming support.
- Deterministic frontend tests: 13 passed (independent slow-peer requests, topology failure, timeout recovery, pause/abort/dispose, private-address validation, invalid/stale/zero sensor distinctions, aggregates and chart gaps).
- Packaged API source: 7 dependency-light tests passed; pinned Ruff 0.14.11 passes. Packaged --help and real local sensor API verified.
- Product Python/installer policy: 46 tests and 11 subtests pass, including rollback, busy-work deferral, guard suspension and progressing replay.
- Built-browser fixtures pass: measured zero versus unavailable; GET-only requests; actual pause/resume; local samples continue while topology and peer fail; stale peer becomes unavailable and recovers; refresh frequency changes.
- Installed Pro + Air API capture: 91 samples each over 90.268 seconds, fixed Pro PID/runs, exact same two node IDs and fresh lastSeen on both APIs, changing CPU/GPU and finite memory/power/I/O values. No EXO inference or model download was started by verification.
- Global EXO `svelte-check` still reports 15 errors/6 warnings in untouched upstream files (no Activity file errors). Full Python project checks cannot start in this checkout because its development executables are absent; Nix is not installed. These are not reported as passing. Product TypeScript and R2 package validation checks pass. The EXO fork is not committed under a false full-suite claim; its exact additive patch is carried in this product.

This verifies the monitoring change, not transparent macOS resource pooling, arbitrary process migration, or uninterrupted inference through a physical Wi-Fi switch.
