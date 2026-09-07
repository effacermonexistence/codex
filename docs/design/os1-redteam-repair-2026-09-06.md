# OS1 CLODEX independent red-team repair — design note (2026-09-06)

Historical Claude-session note. The authentication/sandbox observations below
describe that session, not the current machine. Codex takeover verified existing
owner GitHub access and the existing R2 profile successfully. The offline-ref
Fleet guard below was strengthened to an exact remote commit read. See
`os1-codex-takeover-2026-09-06.md` for the active repair contract.

Objective lock: OS1 must route well between Claude Code and Codex, and the
user must finish work inside OS1 at Codex/Claude-Code-level UX. Everything
below is a sub-condition of those two goals. Baseline: installed
OS-1 CLODEX 0.9.22/build72 (app SHA-256 5e69ff7f…, bundled runtime 73655f7e…),
source = upstream main 155c920 + the uncommitted build72 deltas, imported as
commit cb5054b on branch `os1/redteam-fixes-20260906`.

Method: /Users/lua/.codex/workflows/evidence-first-debugging.md. Findings are
recorded as expected / observed / PASS-FAIL-UNKNOWN; hard failures do not
compensate. Prior acceptance documents are claims under review, not evidence.

## Environment facts that bound this pass

| Item | Observed | Consequence |
| --- | --- | --- |
| GitHub CLI | `gh auth status`: keyring token invalid | No push/PR from this Mac until the user re-authenticates (OAuth only the user can do) |
| Cloudflare | `wrangler whoami`: token expired, non-interactive | No R2 listing/upload/readback verification until `wrangler login` |
| Session sandbox | writes denied to `/var/folders/…/T`, `~/Applications`, `~/.local/bin`, `~/Library/Application Support/OS-1` | Deterministic test binaries, self-tests, `os1 run`, install and SwiftPM builds cannot run in this session; manual `swiftc` builds and temp-dir-free harnesses can |
| Fleet agent | LaunchAgent running; `~/.os1/fleet/agent.log` ends in repeated `retry: Local provider execution timed out` | Reviewed under execution/recovery |

## Reproduced defect 1 — prompt hook dispatches harness text and context-dependent prompts to the Fleet

Reproduction (recorded incident, no model call): Claude Code delivered a
`<task-notification>…</task-notification>` block through the `UserPromptSubmit`
channel at 15:22 PDT. `os1 exo-claude-hook` accepted it as a user request and
created Fleet job `3d1eeb4f-f9f2-4545-be14-0f1903dfe681` (profile claude,
workspace_revision `cb5054bf…`, task = the verbatim notification block). The
hook then instructed the assistant to run `fleet-result` and wait before any
write. Evidence: `~/.os1/fleet/jobs/3d1eeb4f-…/fleet-result.json`
(`assignment.task` starts with `<task-notification>`; `outcome: failed`;
`error: Fleet revision fetch failed`).

Boundary: `promptHookInput()` validates shape only (non-empty, ≤48 kB). Nothing
classifies the prompt's origin or whether it can run standalone.
`automaticFleetSubmission` then enqueues every accepted prompt. Earlier hook
outputs in the same session injected low-value EXO drafts ("안녕하세요! 감사합니다.
이 질문에 답변해 드릴 수 있습니다.") as additional context on every turn.

Invariants to keep: hook fails open; exactly-once submission per event identity;
foreground execution is always the safe fallback; no credentials in output.

Alternatives considered: (a) disable automatic Fleet dispatch — removes a
feature the user built; (b) require an explicit marker per prompt — changes the
UX contract; (c) feasibility preflight before dispatch — smallest change,
consistent with §9 of the instruction (실행 가능성 확인 before routing). Chosen: (c).

Minimal fix: `PromptIntentPolicy` (OS1HookSupport) returns
`harnessGenerated` for harness blocks (`<task-notification>`, `<system-reminder>`,
`<command-message>`, `<ci-monitor-event>`, autonomous-loop sentinels, …),
`notStandalone` for continuation-only prompts ("계속 진행해", "ok", "go on"),
prompts under 24 characters, and short prompts that open with a deictic
reference ("그거 설명해 봐", "this one…"). `runEXOPromptHook` returns an empty hook
response for anything but `dispatch` — no Fleet job, no EXO draft, no wait
instruction. `EXODraftPolicy.isUseful` drops greetings/refusals/one-liners.

Regression tests (Tests/OS1HookSupportTests): the exact incident block, five
other harness blocks, eight continuation phrases, three deictic prompts and a
tiny prompt must be blocked; four standalone tasks (including the Fleet canary
prompt actually used on 2026-09-06) must dispatch; a long prompt containing
"this" mid-sentence must dispatch. Draft policy: two verbatim low-value drafts
and a refusal are rejected; a substantive draft is accepted.

Rollback: revert the three files; the hook is a pure acceleration path.

## Reproduced defect 2 — Fleet dispatches revisions that only exist locally

Same incident: `fleetWorkspaceIdentity` requires a clean tree and a GitHub
origin but never checks that HEAD is on origin. The executor's
`git fetch --no-tags origin <sha>` failed. Any Claude Code session on an
unpushed branch reproduces this deterministically.

Fix: after validating the SHA, require
`git for-each-ref --contains <sha> refs/remotes/origin/` to be non-empty
(offline evidence of what origin has). Otherwise the submission is refused with
"push HEAD before Fleet dispatch" and the prompt runs in the foreground. Verified
on a scratch repository: pushed commit → 1 ref, local-only commit → 0 refs; on the
fix worktree HEAD (local-only) → 0, on origin/main → ≥1.

Rollback: remove the guard block.

## Resumed Claude pass (after the Codex takeover, builds 73–76)

The takeover's commits and installed builds are treated as claims under
review; an adversarial review of `cb5054b..HEAD` runs separately. The
following defects were still present in HEAD and are repaired here with
paired controls where a deterministic control exists.

| Defect (evidence) | Repair | Control |
| --- | --- | --- |
| `workspaceHash` returned the empty-input digest for any non-Git workspace, so before/after comparison on the default home workspace could never observe a change (execution-outbox 9acc6933-…-1..4: identical `e3b0c442…` hashes while files were written) | `nonGitWorkspaceHash` hashes a bounded, sorted manifest (relative path, size, mtime; caps at 20,000 entries; skips Library/caches/media) and `workspaceHash` falls back to it | Create a file in a temporary non-Git directory: hash must change; identical trees hash identically |
| Event journal froze at 8,000,000 bytes and silently dropped the terminal phases of long runs (run-journals/50B20CB1… ends at 21:38Z while the run continued to 21:46Z) | Rotate once to `<journal>.previous` at the cap and keep writing | Fill a journal past the cap and emit: the new record is present and the previous file exists |
| `verify-*.mjs` `check()` helpers only pushed PASS; `failed: 0` was a literal, so a thrown assertion aborted the process without a report | `check()` records FAIL with the message, `failed` counts real failures, the process exits non-zero when any check failed | Inject a throwing check: report shows FAIL and exit code 1 |
| Focus observers reported PASS when a watched app (Codex/Claude/OS1) was already frontmost, where activation can never be observed | Status `UNKNOWN_WATCHED_APP_ALREADY_FRONTMOST`, `observable:false`, non-zero exit | Run with Codex frontmost: status is UNKNOWN, not PASS |
| Fleet dispatch guard called `gh api` first on every prompt (20 s worst case offline) and reported any transport failure as "push HEAD" | Offline `for-each-ref --contains` first; `gh` confirmation second; transport failure reports "could not confirm on GitHub" and skips dispatch | Local-only commit → refused without network; pushed commit with network → confirmed |
| Installing a new CLI left the LaunchAgent running the previous executable image (pid from Sep 5 23:29 kept running after the 09:22 binary replacement; the takeover restarted it by hand) | The agent records its own executable digest at startup; `configure-fleet-agent` restarts an idle service whose recorded image differs from the on-disk CLI; the installer invokes it with the configured role | Replace the binary and run configure: restart only when the digest differs and no job is active |
