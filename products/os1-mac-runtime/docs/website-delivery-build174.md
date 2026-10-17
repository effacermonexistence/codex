# Website execution and durable preview — build174

## Locked scope
Repair the observed U-SUNG website delivery path: owner request -> backend implementation -> surviving local preview -> external delivery check. Preserve existing projects, conversations and queue. No Instagram replay or public deployment.

## Observed failures and repairs
1. `r2RetrievalEvidence` interpreted an authoritative nil owner retrieval decision as permission to classify generated workflow text again. An architecture handoff could therefore introduce an unrelated R2 requirement and block implementation. The helper now requires an explicit resolved objective and never reclassifies nil. Owner-policy source/control classifiers use the original owner objective, not generated stage prose. Explicit owner-requested R2 retrieval remains available.
2. A backend-created temporary server did not survive its tool execution lifetime; files existed while the advertised localhost URL was dead. `ManagedPreview` adds per-user launchd ownership, absolute workspace/executable validation, per-port leases, ownership receipts, HTTP readiness, idempotent reuse and explicit stop. Foreign listeners/configurations are rejected without killing them. Failed startup stops its own service and preserves logs.
3. Website execution receives the managed-preview capability card. Outside the backend process, the runtime checks returned loopback URLs before adoption. A dead URL produces an explicit delivery blocker while preserving generated files/output. HTTP redirects are not accepted as local readiness. Architecture-only and read-only tasks do not start previews.

## Executed verification
- Debug and universal release builds succeeded; release package audit: 23 files, no findings.
- Existing runtime/workflow/queue/steering/source-context/Fleet checks passed in release and installation logs.
- New owner-object regression: a poisoned generated stage mentioning R2/QMGR cannot override a nil retrieval objective; explicit owner R2/QMGR retrieval remains positive.
- Real launchd lifecycle suite: 9/9 PASS (launcher exit survival, same-config idempotency, foreign config/listener preservation, redirect rejection, non-loopback URL rejection, stop/file preservation and dead-URL rejection).
- Installed app and CLI are build174 / 0.9.108. Verified installer preserved 101/101 conversations and four queued requests; reopened the app and restarted Fleet. No automatic replay of those queued requests was requested by this repair.
- Fresh installed `os1 run --provider auto` in an empty disposable workspace actually routed to Codex `gpt-5.6-sol`, action `cx_56sol_xhigh`, native session `01a0bd13-eb89-76f2-bc66-b22d1a10e96f`. Backend exit0; OS1 status `complete`, adoption `adopted`. This was one execution step, not evidence of a three-stage workflow run.
- The backend, not this repair script, created index.html/server.js and started managed preview on 127.0.0.1:4187. Independent Chrome check after the launcher exited verified the title, Waiting -> Ready button interaction, and no page errors (2026-09-20T04:33:21.910Z).
- Existing U-SUNG project restored to a durable preview on 127.0.0.1:4173. Fresh static checks: 11 PASS. Fresh browser checks cover desktop/tablet/mobile/small viewports, overflow, assets, menus/focus, filters/dialogs, local form download, media lifecycle, reduced motion, no-JS content and HTTP range. Captured browser results: 2026-09-20T04:26:19.382Z. Desktop/mobile screenshots inspected. Both servers bind 127.0.0.1, and both remain HTTP-ready after backend exit/app installation.

## Artifact identity and rollback
Installed app: `/Users/LUA/Applications/OS-1 CLODEX.app`.
App executable SHA256: `9d2de487a41e257499ff880ebdf2b090ff8f91b4b0ffb8a4ca4e33facfd0bd0e`.
CLI SHA256: `f2d23a00cd02d38cc186e844e6fa49000bcd139dfb5b283ca89dca72b57c98f9`.
Package SHA256: `edf8d083d38ac2e5fc744704a7bdc2f7c2ebbde24b60d40cc940be462451877b`.
Private installation/rollback receipt: `~/.os1/recovery/website-delivery-build174-20260920T042859Z/install-receipt.json`; previous app/CLI and sessions snapshot retained beside it.
Private execution evidence: `~/.os1/verification/website-delivery-build174/` (raw backend JSON, independent browser check/screenshot, lifecycle tests and build/install logs).
Existing website artifacts: `products/usung-demo/artifacts/`; the pre-existing untracked website is deliberately not swept into this runtime patch.
To stop only a preview: `~/.local/bin/os1 preview-stop --url http://127.0.0.1:4187/`. Workspace/files remain intact. Never stop unrelated processes by port.

## Verification boundaries
- Local delivery, not external deployment. URLs are usable on this Mac while its user launchd session is active.
- HTTP readiness is not semantic website quality; independent browser evidence is recorded separately.
- The delivery gate validates returned loopback links; it is not a universal proof that every website request must emit a link or that every future task will converge.
- The capability card requests explicit loopback binding; the current real server listeners were independently checked. Arbitrary executable behavior is not proven by a URL alone.
- One real coding-backend run plus deterministic stage-authority regressions; no claim of a fresh multi-stage model benchmark or measured uplift.
- Backend stderr contains browser elicitation/sandbox warnings; the final task succeeded and independent browser verification passed. These warnings are retained, not relabeled as absent.

## Research used
[ReAct](https://arxiv.org/abs/2210.03629): interleave actions with external observations. Applied as actual backend invocation followed by process/HTTP/browser checks.
[Large Language Models Cannot Self-Correct Reasoning Yet](https://arxiv.org/abs/2310.01798): do not treat model self-assessment as proof. Applied as deterministic negative tests and independent delivery verification.
Neither paper establishes this implementation's correctness; the executed receipts above provide the bounded evidence.
