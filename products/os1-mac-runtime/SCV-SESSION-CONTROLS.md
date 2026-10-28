# Integrated SCV controls candidate — build 443 (0.9.377)

Integrated on `a29ce1343daff805f480db38f05f250086f22397`, not on the old
installed classic source. Preserves the current voxel game, telemetry, result
inspection/review and deploy behavior. Integration branch:
`os1/scv-controls-integrate-20261028` at
`/Users/LUA/Developer/OS1-scv-controls-integrate-20261028`.

Local release verification and live installation have their own receipts. This
source document does not by itself certify an installation or provider run.

Installer now accepts an optional hash-only private expected-predecessor receipt.
It verifies the exact installed app/CLI/config identity after acquiring the
existing maintenance lease and immediately before replacing binaries. A changed
predecessor rejects the update; none of the existing preservation or signing
checks are bypassed. `scripts/test-local-installer-predecessor.mjs` covers it.

The original isolated-candidate design/history is preserved below. Its old
branch/build names are historical, not the current integration target.

---

# SCV → existing OS1 session controls

Isolated candidate: `os1/scv-session-control-20261025`, based on
`79aad1206f30b8a09c14af7601988129c2764c61` (the installed classic simulation).
This is not a routing-engine change. The running app, Claude worktrees, CLI,
account settings, live sessions and queued requests are not replaced by this work.
Integration into the live app remains a separate owner approval/serialization gate.

## Actual path

SCV UUID → trusted bundled main frame → typed command ID/payload ledger →
`SessionStore.performGardenAction` → existing `send`, `cancelRun`, `pauseQueue`,
`resumeQueue` / safe `advanceQueued` → the same original session owner.

- Stop pauses **only that session's queue first**, preserves its requests, and
  writes cancellation for its exact original submission. It never selects a
  different session to decide what to cancel.
- The immediate receipt confirms host acceptance, not native termination.
  `stopping` remains distinct from completed/paused; unresolved effects are not
  turned into proof that the native worker ended.
- Queued Stop preserves the queue and starts no backend. Resume reuses the
  existing admission/recovery gates. It does not retry the cancelled request.
- New prompts keep the same native session and existing source/permission rules.
  Existing composer text, attachments and pending voice input are protected.
  Input guards run before selection/creation can cancel dictation.
- UUID comparison is case-insensitive. Only a matching command/action/session
  receipt acknowledges a prompt; an animation phase is never an acknowledgement.
- Duplicate/pending commands cannot execute twice. Recent receipts are bounded
  to128;65536 identity fingerprints retain non-replay tombstones even after a
  receipt expires. Only the true identity limit fails closed with an explicit
  reconnect message; Stop does not stop working after128 normal commands.
- WebKit recovery restores snapshots only; it never silently resends a prompt.
- SC1 scene assets, palette and mining path geometry are preserved. Motion is
  a native activity indicator, not measured percentage completion. A stopped
  queue is labelled as a stopped queue, not proof of every external effect.

## Files and interfaces

- `Sources/OS1Context/SimulationSessionControl.swift`: typed parse, payload
  fingerprint, bounded receipts/tombstones, truthful status projection.
- `Sources/OS1App/SimulationGardenView.swift`: exact file/main-frame/UUID checks,
  one host callback, `window.os1SimulationReceipt` delivery, no second engine.
- `Sources/OS1App/OS1App.swift`: existing owner controls and isolated process test.
- `SimulationGarden/src/control-state.js`: pending/receipt/draft state, no network.
- `SimulationGarden/src/main.js`: real controls and explicit resume, no phase ACK.
- Generated `Resources/SimulationGarden`: rebuilt bundle and integrity manifest.

The old lockfile pointed outside the checkout to an outputs/node_modules tree.
It was regenerated from the same pinned package versions into a portable
registry/integrity lock; no new library or version upgrade was introduced.

## Model-free checks

From this runtime root:

```sh
node scripts/build-simulation-garden.mjs
node scripts/test-scv-session-controls.mjs
node scripts/test-terran-motion.mjs
node scripts/test-classic-theme.mjs
node scripts/test-simulation-garden.mjs
```

Build with a **private scratch path and --jobs2** to avoid competing with Claude
for RAM. The unthrottled first debug build was interrupted, not passed.

```sh
swift build --scratch-path /private/unique/scv-build --jobs 2 --disable-index-store --product OS1App
/private/unique/scv-build/debug/OS1App --self-test-simulation-control
swift build --scratch-path /private/unique/scv-build --jobs 2 --disable-index-store --product OS1ContextTests
/private/unique/scv-build/debug/OS1ContextTests --simulation-control-only
```

The App fixture uses the production SessionStore controls in a private store and
real, owned sleep processes: Stop A must terminate A while B remains alive;
follow-up IDs/order/messages survive; explicit resume starts the next request
once, not the cancelled request. It does not run Codex/Claude or spend quota.
This proves the new UI control plumbing, not a new live-provider cancellation or
quality-parity measurement. Do not represent model-free fixtures as provider runs.

## Integration gate

Before a future integration, re-read current installed source/binary identities
and Claude's new source changes. Apply this scoped commit on the actual current
source; do not overwrite a newer installation with this older baseline. Preserve
original sessions, drafts, queued IDs/order and native bindings. Use one release
owner, the existing installer/maintenance/quiescence/backup/rollback gates, and a
fresh exact-source test receipt. UI/source identity and backend identity must
remain separately attributed.

Repair approach: actual source/observations → bounded change → deterministic
regressions and owned-process observation → adoption or hold. Supporting research
read: https://arxiv.org/abs/2210.03629 and https://arxiv.org/abs/2310.01798 (abstracts).
Native cancellation semantics checked against https://learn.chatgpt.com/docs/app-server
(turn/interrupt acknowledgement versus turn/completed interrupted).
