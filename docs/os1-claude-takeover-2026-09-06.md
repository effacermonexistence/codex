# OS1 Claude audit takeover — build74 verification record

This is the bounded handoff repair, not a universal model-optimality certificate.
The objective remains: route effectively between Codex and Claude and complete
work inside OS1 without needing either backend UI. Backend opening is explicit;
OS1 does not pin itself above other applications.

## Provenance and preservation

Claude's interrupted session: `f3855626-ade7-486f-86c3-b794c4b3acf6`.
Its worktree and four modified Swift files were preserved, then continued on
`os1/redteam-fixes-20260906` from imported baseline `cb5054bf`.
The original dirty worktree remains untouched. SCV, Gold, ManyChat, billing,
account permissions and the deployed private routing core are out of this change.

Private evidence root: `/tmp/os1-claude-takeover.ExrAfE`.
Build72 app/CLI and the local session-store snapshot are retained for executable
rollback. Never restore that session snapshot over newer conversations.

## Adjudicated audit findings

| Perspective | Observed mismatch | Repair / evidence |
| --- | --- | --- |
| Intent | Harness task-notifications and deictic continuations became standalone Fleet jobs | Preserved Claude's public intent guard and EXO boilerplate filter; exact incident and legitimate-task negative controls |
| Execution feasibility | Local-only SHA dispatched to an executor that must fetch it | Exact GitHub commit read before dispatch; stale local tracking refs are not publication proof |
| Native continuity | Writer-process readback was weaker than independent persistence proof | Close producer; a new read-only app-server checks exact thread, turn and answer; no second model turn |
| Live continuity | Backend identity could remain old until answer adoption | Validated native session ID now travels in progress and is persisted per owning OS1 session |
| Authentication | Current owner access incorrectly inferred absent from another session | Current authenticated owner + R2 profile readback succeeds; no login performed for this takeover |
| Authentication | Global gh account switching and owner-name requirement | Existing stored identities are tested against target permissions without changing the active account; token stays in the authorized CLI/request path |
| Error classification | Network/403 failures treated as logged out | Separate authentication, permission, transport and unknown results; OAuth only for actual missing/expired login |
| Recovery UX | No one-login continuation path | OS1 invokes official CLI OAuth, holds a per-service process lease, rechecks access and resumes the same original request; concurrent/cancelled failures have a cooldown |
| Crash custody | Interrupted preflight always looked like a dispatched writer | Persist preflight-only stage separately; legacy/uncertain stages remain conservative |
| Write safety | Remote verifier retry could replay a dispatched writer | No automatic write replay after dispatch, including quota recovery; saved answer/state review stays inside OS1 |
| Candidate custody | Local quality rejection discarded an already-paid answer | Carry actual candidate/native record into durable outbox; record local rejection; never turn it into adoption by delivery retry |
| Recovery UX | A rejected saved result could get stuck on delivery retry | Distinguish pending delivery from rejected result; offer read-only result/state review for rejected work |
| Cost | Quota restart carried stale feedback | Refresh completion observations and block the failed tuple before another call; unknown/cancelled effects are not zero-cost or quality-success records |
| Cancellation | No current-execution stop control | Per-submission stop marker, exact Codex turn/interrupt, owned child termination and no model failover on user cancellation |
| Voice lifecycle | Failed local audio start left input tap installed | Stop/remove tap before fallback |
| Voice integrity | Late transcription overwrote typing | Recognition owns only its emitted span; preserve prefix/suffix edits and stop if user edits the dictated span |
| Voice privacy | Apple fallback could use network while implying local | Require supported on-device recognition; otherwise explain unavailability without uploading audio |
| Voice resource bound | Recording length unbounded | Finish capture at five minutes; preserve existing Handy model/language selection |
| Tests | Retrieval fixture not part of normal build | Dedicated SwiftPM executable and release gate |
| Tests | Installed audit pinned old build and native IDs | Explicit expected version/build; use stored session IDs; persist failures rather than a pass-only report |
| Tests | Any exception could pass a forged-result negative control | Require normal rejection with expected HTTP 400/401/403, not timeout/crash/outage |
| Diagnostics | Failure marker survived successful adoption | Clear the owning marker only after verified adoption or successful stored-result delivery |
| Live quota | Claude session limit retried four model/effort configurations | Parse failed protocol `errors` arrays as quota; no same-request Claude retry; Auto obtains a same-permission Codex ticket; explicit pin and write-replay guard remain |

The reported artifact "character limit" issue was not reproduced: `boundedString`
uses `Data.prefix`, hence bytes. Workspace hashes still cannot prove absence of
remote side effects; the write-replay guard does not rely on that claim. Receipt
integrity is explicitly not a guarantee of answer correctness. Journal retention
is bounded; current activity and durable output are separate records.

## Verified checkpoints before installation

- Swift debug build and source/context/voice, hook, retrieval, app and parallel
  regression suites passed. Additional takeover fixture count is recorded in
  the final private test output, not inferred from a literal progress message.
- Live Codex test: one Luna/low read-only turn, independent native readback,
  public output before completion, two deliveries of identical saved output,
  native transcript unchanged by delivery replay. Model calls for replay: zero.
- Existing GitHub target write permission and R2 bucket access verified in
  about 4.7 seconds, including when the UI request pins Codex: no model call.
- Gateway unit tests: 95 passed. Type checks require normal generated Wrangler
  types in this fresh worktree; absence of generated types is not a source fix.

## Installed acceptance (0.9.24 / build74)

- Native arm64 and x86_64 release builds passed; application/runtime signature
  verification passed with the existing designated identity. Client artifact
  scan: 22 files, zero findings. Package SHA-256:
  `0f4fc37de59d219cb72b14eeea95cfd47a001839d3096e8311ad55f25bca06be`.
- Installed audit: 13 checks passed; all 41 conversation records preserved
  byte-for-byte during executable replacement. After application launch,
  JSON key order changed on serialization; a full deep comparison confirmed
  every stored value remained identical. Active Fleet service resumed with the maintained user-local
  runtime. Application SHA-256:
  `fb3214bb0309078f4a1ff72dbc1a6adbb732669a9644e39bf57dd99f12e09368`.
- Transcript layout: 31 checks passed at three widths, minimum measured gap
  15 points. Native interaction/render fixtures: 9 passed, 13 formulas rendered;
  continuous-copy and distinct activity/sidebar animation frames verified.
  Generated narrow-layout and activity images were visually inspected.
- Additional takeover fixtures: 37 passed; protocol recovery: 22 passed;
  exact-turn/owned-process cancellation passed without model calls. Existing
  29-check parallel-session suite, source, voice, hooks and retrieval gates passed.
- Installed Codex live turn: Luna/low, one attempt, 18.651 seconds, 61 public
  progress events. Live native ID matched the adopted record. Two re-deliveries
  preserved output and native transcript, with no additional model call.
- Forged delivery was rejected with HTTP 400, not accepted as an outage-based
  negative control. Locally rejected saved output could not become adopted by
  re-delivery. Existing valid result remained reusable.
- Live R2 readback returned 16 correctly bound OPT/QMGR files in 17.623 seconds,
  with zero model calls. An Auto follow-up produced a source-grounded architecture
  answer via Codex Sol/xhigh in 28.897 seconds; the exact source reference survived,
  and the answer did not demand a missing local clone.
- Claude's account is genuinely at its session quota. The installed explicit
  Claude test now stops after one classified quota response, not four model
  changes. Auto tests completed via Codex. Those live Auto tickets chose Codex
  initially: a live Claude-to-Codex transition is not claimed from them. The
  transition selector, permission matching and no-write-replay rules have
  deterministic regression coverage. No successful Claude inference was
  possible under the current account limit.

The first build74 installation audit rolled back because its test expected the
old literal count of 20 protocol fixtures; the suite had increased to 22. The
audit assertion was updated to require at least 22 and the installation then
passed. The failed report and rollback executable were retained privately.

## Publication boundary

The target GitHub repository is public. Claude's imported baseline also contains
private-core deltas, so the full takeover branch must NOT be pushed there.
Publish only the reviewed native-runtime subtree and these takeover documents
on a clean branch rooted at public main (`155c920`), never the imported commit's
ancestry. Keep the complete handoff delta as a separate private R2 recovery
artifact, bound to its base revision and checked file hashes. No private-core
deployment or public installer promotion is part of this native repair.
Remote storage receipts are separate from these local acceptance results.

## Explicit limits

This finite regression set cannot prove every model/effort is globally optimal
or every future task succeeds. Physical microphone input, per-device OAuth and
macOS permission dialogs require their real device/user interaction; no existing
credential was revoked or privacy grant reset merely to manufacture a test.
The current local development signing identity is retained, not Apple notarization.
Healthy Claude inference and physical end-user OAuth remain unverified under
the current account/device conditions; classified failure is not successful inference.
The old root-owned `/usr/local/bin/os1` is outside the active app/Fleet path;
the app prefers its bundled binary and then the maintained user-local CLI.
No root privilege bypass, public download promotion or private-core redeployment
is implied by this local handoff repair.

Official protocol reference checked: [Codex App Server](https://learn.chatgpt.com/docs/app-server),
including independent thread reads and exact `turn/interrupt`. Authentication
uses the pinned official Wrangler and GitHub CLI commands. Added prompts are
not presented as research algorithms or correctness guarantees.
