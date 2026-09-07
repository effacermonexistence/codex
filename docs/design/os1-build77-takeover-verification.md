# Build 77 takeover verification

## Objective and boundaries

Finish the interrupted shared-task-context release, install it on this Mac with
the existing signer, and verify the installed behavior. Preserve conversations,
pins, drafts, queues, native bindings and recoverable previous binaries. Do not
deploy/reset SCV, change Gold, load customer state, copy credentials, or change
billing. A successful compiler exit alone is not completion.

## Five-perspective inspection before repairs

1. Intent/completion: preparation must acquire the selected source, not merely
   display a newer release label next to an older archive.
2. Source/context: task identity must isolate conversations; every bound source
   must remain readable across backend changes. Truncated history is not full
   context. Native ingestion must not permanently skip unfinished records.
3. Execution/capabilities: use this environment's existing authorized GitHub/R2
   clients and normal Swift builds. No sandbox interposers or credential bridges.
4. Verification/output: unit fixtures, actual acquisition, backend continuation,
   package/signature audits and installed-state preservation are separate gates.
5. Cost/latency/security/UX: deterministic preparation uses no model; reuse pinned
   verified material, avoid unnecessary retries, and keep both backends hidden.

## Observed divergence in the inherited code

- `scvProjectEvidence` still downloads `plan.runtime` from recovery LATEST (v151)
  before adding the newer custody record (v157). BaselineSelection is tested but
  not used to select the acquired archive.
- `TaskContext.adopting` merges sources/bindings/facts from a foreign conversation.
- NativeIngestion advances its cursor past incomplete records; its test manually
  rewinds the cursor instead of exercising real subsequent polling.
- Native first ingestion drops all but 40 records. Provider handoff still loads
  only the legacy single SourceReference despite storing multiple references.

## Minimal architecture / repair sequence

Keep the existing shared-state design and public interfaces. Add executable
selection and identity guards at the failing boundaries, regression tests that
fail on the inherited implementation, then repeat the production build. Acquire
the recorded operating source for preparation when available, verified against
its pinned size/hash and embedded release ID. Keep recovery separately labeled;
never infer current deployment or move recovery pointers. Source attachments
remain untrusted data and hash-checked before delivery. Reject cross-task merges.
Cursor advancement must stop before an unfinished record. Retain native history
locally without adding expensive model calls.

Alternative rejected: changing labels only, upgrading the model, or adding more
reasoning prompts does not repair incorrect artifact selection or lost state.

## Convergence checks and rollback

Record actual pass/fail/unknown results, never a synthetic confidence score:
source selected key/hash/release agreement; recovery unchanged; no foreign data
merged; partial-then-complete ingested exactly once; retained source delivery;
normal arm64/x86_64 build and self-tests; signatures and package scan; live bounded
backend continuation; idle-gated installation and semantic session preservation.

Before replacing installed binaries, snapshot the exact app/CLI and session file
into a new private recovery directory. Stop only the verified OS1 processes after
checking active/queued runs and Fleet claims. Stage verified replacements before
swapping. Roll back binaries on install failure without overwriting conversations
that may have acquired new user work. Re-verify running hashes and session state.

This note is a plan and code-inspection record, not a completion receipt. Final
evidence is appended after execution.

## Live findings during takeover

- Actual R2 acquisition selected the v157 source archive (1,441,639 bytes;
  SHA-256 `d74cb331eac33465c043a5f3f59286c6a7198dda39ce8ef0c1a28e20b7873ad0`).
  Its embedded release ID and the trusted-main custody record agree. The v151
  recovery descriptor is separate and unchanged. This is not a live Railway
  production verification and does not establish a new approved Gold.
- A real source-explanation call received `workspace_write` despite explicitly
  forbidding changes. The local scope guard and routing intent normalization
  now require `read_only`; the original user request is still delivered intact.
  Subsequent real Codex calls passed the read-only and source-continuity checks.
- Claude returned an actual account-wide session-limit error. An explicitly
  pinned Claude run correctly did not switch providers. Do not report a live
  Codex–Claude–Codex round trip as passed. Deterministic recovery fixtures are
  separate evidence, not a substitute for a successful live Claude answer.
- The live harness initially wrote activity logs inside the execution workspace,
  triggering workspace-change detection. Test instrumentation now uses a sibling
  directory so it cannot masquerade as a backend file mutation.
- Installation verification rejected a flaky parallel-test assertion. It searched
  the entire JSON handoff for `A1`, including random UUIDs. A UUID ending in `00A1`
  reproduces the false positive even with a clean B transcript. The assertion now
  decodes the transcript and includes this collision as a deterministic control.
  The failed installation automatically restored build76 binaries, restarted
  Fleet, and preserved all 44 conversations and every existing message. This
  failed attempt remains recorded separately; it is not an adopted build77.

## Installed result — 2026-09-07 06:03:54 UTC

Build77 (marketing version 0.9.26) is installed at
`/Users/lua/Applications/OS-1 CLODEX.app`; `/Users/lua/.local/bin/os1` and
the bundled runtime have the same SHA-256. The application (PID 14705) and
Fleet (PID 14703 at verification) are running the installed paths. All 44
conversations retain their messages, native bindings, pins and drafts; all 44
now have a TaskContext whose conversation identity matches its owning session.
No active or queued run was interrupted.

Verified recovery directory:
`/Users/lua/.os1/recovery/shared-task-context-20260907-build77-verified`.
The previous app and CLI are recoverable there. The session snapshot is evidence,
not authorization to replace newer conversations. No credential caches were
copied. The earlier rejected install has its own separate recovery receipt.

| Gate | Observed result |
| --- | --- |
| Standard SwiftPM release, no interposers | arm64 and x86_64 built; stable local signing requirement preserved |
| Context regressions | 13 groups passed, including 94 task-context and 51 project-material checks |
| Hook regressions | 8 groups passed |
| Runtime/app/Fleet regressions | passed, including UI/math/selection/sidebar/queue and bounded recovery checks |
| Parallel execution | 29 checks passed on 10 consecutive runs, plus installation verification |
| Installed-build audit | 13 passed, 0 failed; actual native record IDs read without writes |
| Installed R2 acquisition/reuse | 20 passed, 0 failed; no model calls, no customer state or deployment |
| Live Codex continuation | 2 successful read-only calls, same native ID and source digest, public progress events; 18.0 s and 19.7 s |
| Delivery recovery | 2 actual results replayed twice each without a new model call; forged and locally rejected completions rejected |
| Package payload scan | 22 files scanned, no findings within the scanner's rules |
| Claude cross-provider live continuation | NOT VERIFIED: actual Claude account session quota exhausted |

The live Codex test used the same runtime code directory hash as the final
release (`4ce71d1b8017c9349efe18c19cb852bf34b3bb64`). Re-signing changed the
whole-file hashes, not the executed runtime code. The final app additionally
contains the corrected parallel-test oracle. App-level R2/render tests were
repeated against the installed app itself.

Final artifact identifiers:

- App executable SHA-256:
  `bd60250616c27181d54eb51c094420e617c2c207e28a6cfb848d29b3cfc71df5`
- Installed/bundled runtime SHA-256:
  `26db15920c57c736867bccf2ce6d08e009a23ffda76ca72ef8c889eb21a1c04f`
- Development package SHA-256:
  `9987f48e18b1285e01a604b1f5ffa5f49a3894e7f8b8e85f19e95932fba11373`

Evidence logs, machine-readable audits and preview images are preserved under
the verified recovery directory's `evidence/` folder. This is a verified local
development install, not a notarized public release, a production-server
deployment, an upstream-main merge, or proof of globally optimal model selection.
Claude's successful live continuation remains an external-quota-dependent test;
it is not reported as passed and repeated paid retries were not used to conceal it.

## Clean-CI compatibility follow-up

The first publication's Worker security jobs and R2 backup passed, but its Mac
build exposed an inherited ABI declaration conflict: CompletionFeedback declared
`flock` using `@_silgen_name` (thin Swift convention), while ConnectionFlow used
the SDK's C declaration in the same module. Local compiler success did not cover
that runner toolchain. Direct `Darwin.flock` also resolves to the structure, not
the function, on this Mac's SDK. Use a tiny C wrapper including `sys/file.h` to
preserve the C ABI on both toolchains; do not disable locking, remove a gate or loosen
permissions. Rebuild, repeat lock/context tests, wait for clean CI, and replace
the installed binaries only after validation. Earlier artifact hashes above
remain historical receipts; the final compatibility install will have its own
receipt and recovery directory.

### Compatibility follow-up adopted — 2026-09-07 06:18:33 UTC

Code commit `81714ff0db7ea443bdd455a59247cfd115711ac3` passed all six jobs of
[the clean GitHub security/build workflow](https://github.com/effacermonexistence/codex/actions/runs/34089792356),
including the universal Mac package, beta-bundle verification, and tamper
rejection. The standard local universal build and regression suites also passed.
Two new real Codex calls retained the same native session and source under
read-only scope (16.9 s and 17.6 s), without opening a backend app.

This compatibility build has now replaced the earlier local build77. Installation
re-ran runtime/app/queue/parallel/Fleet tests and preserved every existing message,
pin, draft and binding in all 44 conversations. Fleet restarted as PID 16911.

Final recovery root (supersedes the earlier artifact identifiers):
`/Users/lua/.os1/recovery/shared-task-context-20260907-build77-portable`.

- App executable SHA-256:
  `83bc040fe1cd132a145a899288512ac79650b8b1b67d4440619025f51ec75e5a`
- Installed/bundled CLI SHA-256:
  `e2aaba3b00066d9c873d3b83400017cf224c9a8f58eba1efd08b6164848aef71`
- Development package SHA-256:
  `eb2680d83783a0de4cc3461f4d1be2bf1423e0179391963c4c5b474788861e40`

The automatic OIDC R2 backup for the code commit also passed. Its remote manifest
and actual 8,641,392-byte Git bundle were downloaded and verified, including
`git bundle verify` and SHA-256
`461d3af8c569145b47bebf6bfb73e4f1f8dab1d9947ddff18e13d375c6135d47`.
All external-quota, public-notarization, production-state and global-optimality
limitations above remain unchanged. Publication is on
`os1/shared-task-context-20260906`, not a merge into `main`.
