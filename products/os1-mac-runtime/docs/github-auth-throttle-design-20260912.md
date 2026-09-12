# Build 104: task execution blocked by GitHub probe exhaustion

## Objective and incident evidence

Restore OS1's prepared-source → authorized implementation → native result → OS1 path, without changing SCV production, customer state, Gold, identity permissions or provider safety policies. The reported conversation `7FECE9EC-2485-4421-8FD4-0AB34990AB83` acquired the verified v172 source at 21:02:43Z. Its next authorized repair request at 21:08:04Z stopped before any routing ticket or provider call. The app displayed an access-permission error.

Independent `gh api --include user` returned HTTP 403, `x-ratelimit-remaining: 0`, used/limit 5000, reset 1789247563, with `API rate limit exceeded`. This is NOT evidence of lost repository permission or invalid OAuth. The client selected another account after classifying this response incorrectly. No new identity, token or permission should be sought for exhaustion.

## Five perspectives / non-compensating acceptance

1. Intent: source preparation passed; requested implementation never dispatched. Require an actual isolated source modification with a checked artifact, not another explanation-only test.
2. Context: QMGR → Instagram topic switch retained v172 source. Test the selected source and authorized write scope survive auth handling, without replaying prior research context as the new objective.
3. Execution: each CLI startup performs `gh auth status` and user/repository network probes; every server request also calls GitHub `/user`. Fleet polling magnifies these redundant probes. Remove routine client probes; server remains identity authority.
4. Output: 403 quota exhaustion was mapped to permission, and the auth service maps every upstream failure to 401. Preserve separate auth-unavailable / throttle classifications through service binding and client. Never label a failed preflight as a failed model answer.
5. Cost/latency: model calls for preflight failure must remain zero. Concurrent verification must be single-flight; repeated successful server checks have a hard 60-second TTL and ETag revalidation. No quota-based identity cycling or rapid retries.
6. Security/UX: tokens remain owned by gh, in transient request memory only. Server cache keys are token SHA-256, not raw credentials; cache is bounded, TTL is not sliding, revoked credentials fail on next revalidation, error responses never extend positive entries. User cancellation and signed execution/ticket/replay boundaries remain unchanged.

## Smallest architecture change

`OS1 request → local gh credential read (no network) → OS1 auth service → bounded token-fingerprint identity cache / coalesced conditional GitHub verification → unchanged device/signature/router → backend → unchanged verified result delivery → OS1`.

Explicit “GitHub connected with write access?” still performs an actual repository permission check. Routine task execution does not require all users to be upstream repository writers. Cache identity only, never repository permissions. Throttle before any task side effect returns a typed 429 with Retry-After; genuine 401/403 stays denied. Client can wait once for a short (≤55 seconds) auth pre-dispatch throttle, never retry ahead of Retry-After, switch accounts, replay already executed work or bypass an expired auth result. Longer unavailability preserves the original task with truthful status.

Alternatives rejected: lifting GitHub limits or using a second identity (wrong failure boundary); unconditional authorization / stale-cache-on-error (unsafe); prompting models harder (the model was not called); repeatedly polling `/rate_limit` (unnecessary traffic).

## Research mapped to this failure

- GitHub official [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) and [best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api): distinguish primary/secondary throttles, obey Retry-After/reset, conditional authenticated requests and avoid redundant polling. These are the implementation mechanisms, not a limit bypass.
- [Chain-of-Verification](https://arxiv.org/abs/2309.11495): use independent evidence for source acquisition, dispatch and final artifact. This is a testing principle; no claim to implement the paper's complete model procedure.
- [Lost in the Middle](https://arxiv.org/abs/2307.03172): keep explicit current source/objective binding across long topic-switch history; verify against the actual v172 artifact. No claim this paper proves current-model behavior.

## Tests / release / rollback

Deterministic checks: many concurrent and serial auth requests → one lookup within TTL; different token/device isolation; TTL expiry and conditional 304; revoked/invalid token; cold 304; malformed JSON; network/5xx; 403 primary and secondary quota; 429; cooldown no re-fetch; no raw credentials in cache/API output. Gateway must propagate typed auth failures before private routing; actual denials remain opaque.

Swift: quota classification precedes 403; explicit GitHub connection preserves permission checks; routine credential read performs zero GitHub API calls; rate-limited auth never selects another account. Installed regression suite and actual isolated Codex/Claude work loop must pass. Verify deployed service behavior and installed build, merge only passing changes, preserve rollback binaries and immutable private R2 artifacts. Do not report SCV behavioral deployment from OS1 execution-path verification.

## Measured verification (2026-09-12 UTC)

- Route-core: 18 test files / 118 tests passed. Context suite includes 43 takeover checks, 145 task-context checks and 13 source/output regression groups; installed runtime/app/Fleet self-tests passed. The installed audit passed all 14 checks and preserved 62 sessions during replacement.
- Deterministic identity fixture: concurrent and serial requests share one upstream lookup inside the hard TTL. Live 30-request gateway probe at 21:25:42–45Z: all 30 reached the expected post-authentication malformed-body rejection (400); account-wide GitHub usage increased by 5, including measurement/other-process traffic. This is not an exact per-service lookup count.
- Deployment caught a real Workers incompatibility (`redirect: 'error'` rejected by its fetch implementation). Replaced it with supported `manual`, retaining fail-closed redirect rejection. Retested the final deployed service, not just Node mocks. Final auth version `7d8b1937-d280-4729-86a6-ae250b604f9b`, gateway `7aaa61db-3c1e-4bde-a21e-e6abd52eedb0`.
- Installed build104 native loop at 21:27:25Z: Codex wrote and read back the isolated v172/Node20.20.2 artifact; Claude continued using the same source fingerprint and artifact. Both returned progress and verified results; delivery replay required zero additional model calls. Exactly two native model executions were used.
- Existing signing identity is preserved. The package is a locally signed development build, not an Apple-notarized public promotion. SCV production and customer behavior were not changed by these tests.

Rollback: local previous binaries are in the build104 recovery directory; preserve current sessions when restoring. Prior auth Worker version `c373d082-71c3-456c-9644-4acd809c1b1e`, prior gateway `e279aab8-0cc3-49f7-89f2-6acd602b9718`. Neither rollback nor credential replacement was needed after final live checks passed.
