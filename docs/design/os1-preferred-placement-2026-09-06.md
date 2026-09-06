# OS1 eligible preferred-device placement repair

## Objective and evidence

An explicitly preferred device must execute a new job when it is fresh, meets
the requested memory floor and supports the requested provider/profile. Only
when it fails those existing eligibility gates, or is absent from this owner's
fleet, may resource scoring select a fallback. This is not a new permission or
an assertion that macOS resources are pooled.

Incident `a6b90905-7af0-4018-ab4d-ca554b30bed4` submitted clean main
`e50ff335061e17a4ad64d5dbf0047ff9437a76ab` with Air preferred. Its persisted
submission and native result instead identify Pro. The result text succeeded,
but the placement objective failed. `fleet-model.ts` used only a -25 affinity
discount, which a CPU/memory/queue score difference can outweigh.

## Boundary and minimal architecture

Authenticated owner-scoped nodes -> existing freshness/memory/provider filter
-> eligible preferred node if present -> otherwise minimum resource score with
device-ID tie break -> existing transactional assignment/claim/result storage.

Change only the selection after filtering. Keep legacy score reporting, the
wire version `os1-fleet-objective-v1`, auth, receipt ownership, persistent replay,
and database schema unchanged. Native installed clients explicitly validate
that wire version; changing it would require a separate coordinated upgrade.
Worker version and source commit identify this behavior correction. Already
queued/claimed/completed assignments remain immutable, including replays after
resource conditions change.

Alternatives rejected: increasing the affinity discount remains a soft promise;
forcing a device before eligibility checks can select stale/incapable nodes;
changing/replaying old jobs risks duplicate execution.

## Five-view acceptance audit

| View | Required convergence | Divergence to reject |
| --- | --- | --- |
| Intent/completion | Eligible preferred Air selected for Codex and Claude | Correct text from Pro counted as Air success |
| Context/provenance | Same repo SHA, profile, signed request preference and job survive submission/replay | New job or different source on retry |
| Execution/capability | Freshness, memory and provider gates run before preference | Stale/undersized/unsupported preferred node selected |
| Verification/output | Receipt executor and result hash bind to selected device; exact output checked independently | Transport success alone called semantic success |
| Cost/latency | Pure deterministic selection, no extra model calls or network I/O | Model-based selection/repeated jobs to hit preferred node |
| Security/UX | Owner isolation and nonce stripping retained; backend stays background | Credential leakage, other fleet access, foreground activation |

Deterministic tests cover adversarial score gaps, all profiles, both input
orders, freshness and memory boundaries, absent preferred device, no eligible
fallback, stable ties, input immutability and secret-field projection. SQLite
integration covers preferred assignment, claim owner, replay stability and
cross-fleet isolation. Run all route-core checks plus dry-run before deploying
only route-core; do not modify the private core, devices, EXO, models or auth.

After merge, verify exact main GitHub/R2 manifest, bundle hash and bare restore.
Run at most one no-change exact-output Air-preferred job per Codex/Claude and
one small EXO-profile topology probe. Any Air-native blocker remains a failure,
not permission to relabel a Pro fallback. EXO output remains an unverified
candidate until separately checked; topology is not general resource pooling.

Rollback: redeploy the recorded pre-change route-core Worker version only.
No database migration, job reset, device installation or credential movement.

## References applied

- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/): keep selection local and deterministic, without new global state or I/O.
- [Durable Object state](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/): preserve durable assignment/replay ownership, not ephemeral reselection.
- [Wrangler deployment commands](https://developers.cloudflare.com/workers/wrangler/commands/#deploy): dry-run and record exact deployed version for rollback.

This is a scheduler contract repair, not a new LLM research algorithm or a
claim of globally optimal model/reasoning selection.
