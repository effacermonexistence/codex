# OS1 frontier usage/news monitor design

## Installation closure audit (2026-09-12, builds 99–101)

Observed divergences: build 98 is installed, the monitor is only compiled in a
worktree; malformed HTTP 200 can be labelled verified; incident edits are ignored;
the UI has no history or actionable notice; Anthropic has status but no news.
Fix these boundaries before replacing the idle installed bundle. Preserve the
existing signing requirement, CLI, sessions, pins, queues and rollback copy.

Acceptance (hard gates, not a confidence score): strict successful parsing before
caching; isolated public HTTPS transport; incident revision upsert and restart
dedupe; no invented reset deadline; unavailable/stale status visible; OpenAI and
Anthropic news and status plus Google/DeepMind/Cohere sources; in-app actionable
notice and browsable history; live source poll; installed binary self-tests and
session-preserving upgrade; OS1 Instagram preparation matching the current
production manifest followed by bounded backend/context/result-return checks.
The Instagram check must not deploy an unspecified change or contact customers.
Production readiness is reported separately from delivery visibility.

Official OpenAI documentation consulted: https://learn.chatgpt.com/docs/pricing
(fetched 2026-09-12). Public announcements are not authenticated account usage.
No model request, quota redemption or automatic token-spending action is added.

Live Instagram reproduction after registration found a second boundary: v171's
hash-verified SCV_DESIGN_INTENT_LOCK.md is 86,174 bytes, exceeding the old 80,000
byte context-member limit in BOTH local and R2 paths. Build 100 shares a bounded
128,000-byte UTF-8 member reader. Hash validation, protected-material guards and
the overall snapshot limit remain intact. Tests cover the actual size and
rejection of oversized/invalid UTF-8 input. Publish only the exact source package
and non-secret custody record; preserve production, customers and Gold.
The new immutable R2 custody namespace also needs an explicit acceptance rule:
`source-custody/<archive SHA-256>/source.tar.gz`. Build 101 permits only that
digest-matching key in addition to legacy release-ready keys; arbitrary private
bucket paths and customer-state keys remain rejected.

## Objective and scope

### Coordinated prohibition closure (build 103)

The exact installed follow-up “도구 호출, 파일 변경, 배포, 고객 데이터 접근은 하지 마”
still produced a write ticket. The old bounded list grammar required a file
edit first and could not consume customer-data access last; the correct signed
read-only guard stopped execution. Extend the shared action-list grammar to
tool calls, commands and data access in any order, including a shared “없이”.
Classify each forbidden action separately. Only a forbidden file/code edit
implies a global no-file-write fence; a deployment-only list must not revoke an
otherwise authorized local edit. Normalize only the routing projection, keep
the original request and all prohibitions in backend context, and keep ticket
enforcement unchanged. Regress the exact sentence, decomposed Korean, alternate
order, non-negated lists, affirmative edits with separate side-action bans and
contradictory file authorization. Recheck the exact installed UI follow-up.
Rollback is the prior signed bundle, without replacing newer conversation data.

### Installed UI closure findings (build 102)

The real UI (unlike a pinned-provider CLI smoke test) exposed an intermittent
read-only GitHub preflight transport failure. Its status-review retry also sent
negative mutation verbs as the routing objective, attracting a write ticket
that the client correctly refused. Keep that hard guard: normalize the status
review objective to affirmative read-only inspection, retaining the original
request/prohibitions in the execution context. Retry only a read-only transport
probe once with a delay; authentication, permission and rate-limit failures must
not trigger identity changes or model calls. Cancellation remains terminal.

A separate native arithmetic check returned `\\(2 \\times 3 = 6\\)` and was
incorrectly rejected as English. Extend only the language-neutral presentation
check to bounded numeric LaTeX with allow-listed math commands; do not waive
language checks for text commands, prose or unknown commands. Regress the exact
answer plus adversarial text-in-math, and rerun automatic routing on the installed
build. This does not certify mathematical correctness or replace result checks.

The macOS 15 CI entropy scanner identified a generated private Objective-C/Swift
type name, demangled to OS1Context.FrontierRedirectGuard, not a credential.
Use a module-internal stable type name; the entropy scanner and policy remain
unchanged. Local and CI package scans must both pass before upstream adoption.

OS1 should surface fresh, actionable changes from frontier providers—especially
OpenAI and Anthropic—without routing the notice through Codex or Claude, adding
the notice to a user's task context, or inventing a quota/reset deadline. The
monitor is informational: it never changes provider selection, credentials,
billing, or a running task. It reads public, first-party status endpoints and
persists only bounded metadata and links.

## Evidence-first boundary review

* Intent/completion: a new provider incident or usage-limit announcement must
  appear once in OS1 with provider, title, source URL, publication time, and a
  conservative signal type. A failed fetch is a visible `unavailable` state.
* Context/provenance: monitor items live in a separate state file and SwiftUI
  panel; they are not `ChatMessage`s and are never included in `sessionHandoff`.
* Runtime/capabilities: the service uses `URLSession` with a short timeout and
  official HTTPS JSON/RSS/newsroom endpoints only. No provider token, CLI credential, or
  dashboard cookie is read.
* Output/verification: each item has a stable provider ID when supplied by the
  source, otherwise a SHA-256 fingerprint of provider/title/time/body. ETag and
  Last-Modified are retained; a 304 is a successful no-change poll.
* Tokens/cost/latency: polling performs no model call and sends no prompt. It
  is capped at one request per source per interval (default five minutes), with
  a bounded response body and a thirty-day display window (at most 100 items).
  Concurrent refreshes share the same poll; requests use isolated ephemeral
  sessions, reject cross-host redirects and stop reading at the byte bound.
* Security/privacy/UX: only public source text is retained, HTML is not
  rendered as executable content, URLs are allow-listed by source, and new
  high-value notices are visually distinct from provider execution status.

## Dataflow

```text
official status JSON -> bounded parser -> classifier -> stable dedupe key
                                      |                  |
                                      +-> persisted state +-> OS1 monitor panel
```

Convergence is the explicit acceptance checklist: parser tests, classification
tests, stable dedupe, 304 handling, persistence round-trip, source allow-list,
and UI compilation all pass. Divergence is any duplicate item, a reset date
invented from missing text, an item entering a task transcript, a non-official
URL, or a network error reported as fresh data. A single passing source does not
compensate for another source's failed verification.

## Source policy

The eight sources are OpenAI news/status, Anthropic visible newsroom cards and
Claude status, Google AI RSS, DeepMind RSS, Google Cloud's AI-filtered incident
array, and Cohere status. They are operational/news signals,
not proof of account-specific quota state. A provider's account quota remains
unknown unless OS1 receives a separately authenticated, user-authorized usage
response. The classifier therefore labels `reset` only when the source text
explicitly contains reset/quota/usage-limit language and leaves `resetAt` nil
unless a single timezone-qualified ISO timestamp is attached to an explicit
usage-reset clause. Unrelated or contradictory dates remain unknown. Initial
history older than 24 hours does not trigger an alert storm. Incident revisions
replace the previous item and can notify again; identical polls/restarts cannot.
Malformed HTTP 200 responses never update successful cache validators. First-load
304 responses without verified prior state are rejected. Notifications are in-app
and polling runs while OS1 is open, not a server or background-machine service.

## Rollback

The installer retains the previous signed app and CLI in a new private recovery
directory and refuses an upgrade during active/queued work. Binary rollback must
not replace a newer sessions.json. Monitor history is separate from user tasks;
removing its state would reset deduplication, not disable the periodic monitor.
