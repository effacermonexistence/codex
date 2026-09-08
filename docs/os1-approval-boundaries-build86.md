# OS1 approval boundaries — build 86

## Objective and incident

Avoid asking again for work already authorized in OS1. Distinguish an actual
approval request from a provider safety denial, authentication failure, or an
operating-system permission boundary. Do not manufacture consent or bypass a
provider's enforcement. This change does not alter Instagram production.

The correlated local Instagram task contains gpt-6-astra tool results at
2026-09-08T00:30:32Z with `blocked by our safety systems` and
`Potentially unintended activity`. The task was already using approval `never`.
This is not an outstanding user-approval RPC. No evidence establishes that
accepting a popup would resolve that incident. Private transcripts stay local.

Build 85 already requests approvalPolicy=never and approvalsReviewer=auto_review
on thread start/resume and turn start. Its fallback rejects unexpected approval
RPCs. Removing that rejection indiscriminately would grant new authority; it is
not the repair for this incident. The concrete defects are that a provider safety
denial can remain unclassified and the generic policy-denial message incorrectly
asserts that another user approval is required.

## Five perspectives and acceptance criteria

| Perspective | Existing divergence | Acceptance |
| --- | --- | --- |
| Intent/UX | A hard denial is described as needing approval | Explain denial vs approval accurately, without an ineffective approval request |
| Context | A backend must not treat retrieved instructions or its own text as consent | Original objective and signed permission profile remain unchanged |
| Execution | The actual safety-system error has no dedicated category | Classify exact error evidence, including RPC and bound error events |
| Verification | Pipe-close/timeout could obscure the terminal cause | Preserve denial category through failure transport and completion; no success receipt |
| Cost/latency | Unclassified failures risk generic retries or needless waiting | Fail promptly; no alternate-model replay or readback for a safety denial |
| Security | An unconditional accept would conflate consent with policy | Keep never/auto_review and OS/MDM controls; no broadened roots or token copying |

## Minimal architecture

Existing task authority -> native never/auto_review policy -> execution.
Structured failure -> typed boundary -> OS1 failure notice and preserved task.

Add `safety_blocked` distinct from `policy_denied`. Inspect only actual protocol
failures (or an already-rejected candidate), not every successful answer that
quotes an error. Match thread and turn for asynchronous error notifications.
Keep the existing single-reader transport. Do not add an LLM approval reviewer,
global always-yes response, model switch, or unrestricted sandbox.

Clarify backend instructions: proceed within the already granted task scope
without requesting redundant consent; don't describe safety enforcement as an
approval that the user can click away. New scope, OAuth and OS/device approvals
remain distinct and must not be inferred from documents or backend text.

## Verification and rollback

Deterministic tests cover exact incident errors, denial precedence, successful
quoted explanations, unrelated-thread error isolation, real stdio failure
delivery, no repeated backend calls, serialized failure retention, and unchanged
native approval settings. Re-run context/runtime/app/queue/steering regressions.
Build the universal app and CLI with the existing local signer. Install only
when OS1/Fleet are idle, preserving all messages, drafts, pins and bindings.
Retain previous binaries in a new recovery directory; never roll back sessions
or credentials. A safe synthetic native turn may validate ordinary authorized
execution; do not recreate or attempt to bypass the safety-blocked Instagram run.

Official protocol reference: https://learn.chatgpt.com/docs/app-server#approvals
It defines approval decision payloads and their thread/turn scopes, not a right
to override safety-system or MDM denials. No additional research algorithm or
model call is needed to classify this deterministic protocol boundary.

No claim: all future Astra prompts disappear, a safety denial is repaired by
approval, or the Instagram change itself has been deployed by this task.

## Verified implementation

The native adapter now retains safety enforcement across matching RPC errors,
bound asynchronous error events, terminal turn results, result delivery and
failure serialization. Terminal causes take precedence over generic replay,
write-uncertainty and server-adoption checks. A safety denial is not fed into
model quality feedback as a bad answer. Successful quoted error explanations
and unrelated-thread notifications are negative controls, not denials.

Release 0.9.35 / build 86 was built for arm64 and x86_64 and installed locally
with the existing signing requirement at 2026-09-08T04:27:21Z. Installer tests
passed for runtime, app, queue, parallel sessions, Fleet, queue/fork, composer
and live corrections; all 55 conversations and existing messages, drafts, pins
and native bindings were preserved. Prior binaries remain in the local recovery
directory. Packaging scanned 22 files with zero findings. Package SHA-256:
`a79cb4757a66d928fd8541f4faf630ab9b3afe7c90ce130fc23c9bdda588ca96`.

Deterministic suites passed: 41 native protocol checks (including real stdio
safety failures without turn/completed), 92 backend recovery checks, 77 unified
execution checks, 35 steering transport checks, 20 UI steering checks and 123
task-context checks. These tests made no model calls and did not replay the
blocked Instagram operation. They establish the error/approval distinction and
non-retry behavior, not removal of the upstream safety restriction.
