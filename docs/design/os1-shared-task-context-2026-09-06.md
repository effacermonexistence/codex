# OS1 shared task context and backend handoff — design (2026-09-06)

Status: design draft written before implementation. Sections marked
"(from code map)" are filled from the line-level maps of `OS1App.swift`,
`main.swift`, `SourceContext.swift` and `ProjectMaterials.swift`; nothing in
this document is a claim that a feature exists until the matching test and
installed-build check are recorded in the acceptance table.

## 1. Objective lock

The user works in OS1. Codex and Claude Code are execution backends. OS1 owns
the shared task state, selects and hands over the context a backend needs,
routes to a backend that actually has the required capability, carries the
same task across backend changes, and collects results back into the shared
state. The user reads progress and results in OS1 and continues from there.

Non-goals for this change: SCV production deployment or reset, Gold changes,
ManyChat, customer-data loading, billing/permissions, credential copying,
publishing the private branch history to the public repository.

## 2. Reproduced incidents (evidence)

| Case | Request | Observed | Evidence |
| --- | --- | --- | --- |
| A | "인스타그램은 오토매이션 수정 좀 보자 데이트 다 가져와 봐" | Routed to Codex Luna/medium with a "verified local directory candidates" list; Codex inspected the old public mirror checkout, reported an empty git diff and a Node 24 vs 20.20.2 mismatch, never acquired R2 project materials; no source snapshot | `~/.codex/sessions/2026/09/06/rollout-…T17-08-51-01a07932….jsonl`, run journal `59E29DFD…` (109 s, 9 tool batches) |
| B | "R2 연결시켜" → "R2 연결됨" → "야 인스타그램 수정 좀 하자 준비해" | Codex Luna/medium, workspace-write; inspected the same stale mirror (v122 README, v134 branch), read the v157 record on origin/main, checked Node, reported Railway "not linked", acquired nothing, prepared no editable checkout, asked the user what to change | rollout `…T18-55-49-01a07994….jsonl`, run journal `D38828A9…` (77 s, 4 tool batches), conversation `B696A18B…` (no `sourceContext`), control receipt `d557a6eb…` (r2_verified true) |

Build 76 repaired only the explicit acquisition phrasing of case A. Case B
and the general continuity problem remain: OS1 does not own a task state that
says "this conversation is about project scv-instagram, its baseline is X,
its verified materials are Y, the user decided Z, the next step is W".

## 3. Current state flow (from code map)

| Stage | Where (file:line) | Input → output | Stored |
| --- | --- | --- | --- |
| Input | `OS1App.swift:3052-3106` `send()` | composer text → `PendingSubmission` (request, provider, workspace snapshot, capacities) | `sessions.json` (queued/inFlight) |
| Context assembly | `OS1App.swift:2067-2086` `sessionHandoff` → `SourceContext.swift:16-56` `SessionHandoff` v2 | last 16 user/assistant messages (12,000-char heads) + ONE `SourceReference` → `--context-file` (≤150 KB transcript, ≤190 KB envelope) | temp file only |
| Project identification | none for conversations; `WorkspaceDiscovery.context` (`main.swift:5257`) only when the workspace is the home directory and no evidence is attached | prompt + `~/.codex/config.toml` → advisory candidate list appended to the prompt | not persisted |
| Source binding | `main.swift:5173-5229` (`resolveR2RetrievalObjective` 1997-2072 → `r2RetrievalEvidence` 2906-3081 → `persistSource` 2273) | prompt + transcript → at most one `R2EvidenceBundle` snapshot | `source-snapshots/<uuid>.json` |
| Routing | `main.swift:801-815` `sourceRoutingTask` (only when a source or URL exists) → REVAS `/v1/executions` 5285-5296 | objective text → signed ticket (provider, model, effort, permission) | routing-input diagnostics |
| Backend execution | `main.swift:4394-4594` `execute` (`providerPrompt` 3567-3590: preamble + prior transcript + preloaded source + request) | prompt + instructions → provider output, native session id, native record | execution-outbox, run journal |
| Verification | `main.swift:5576-5585` local adoption veto; server evaluator; `stepRecordIsVerified` (`OS1App.swift:2171-2231`) | exit code, output, native record read-back | receipts (prose) |
| Persistence | `OS1App.swift:3173-3235` adoption: `sourceContext = summary.sourceContext` (unconditional), `recordNativeSession`, assistant + receipt messages | `RunSummary` → `ConversationSession` | `sessions.json` |
| Next turn | `sessionHandoff` again | messages only; receipts and system notes excluded | — |

## 4. First broken boundaries (from code map)

- (a) Preparation not recognized. `ProjectMaterials.swift:11-13`: "인스타그램 수정 좀 하자 준비해"
  contains neither a material noun nor an acquisition verb, so `scv()` is nil; `resolveR2RetrievalObjective`
  (`main.swift:2043-2044`) fails its guard; `r2Evidence` is nil (2907); `sourceRoutingTask` returns the raw
  prompt because of the `hasSource` gate (802); REVAS receives an unannotated edit request and issues
  `workspace_write`. The generic run then explores whatever checkout the discovery list offered (cases A/B).
- (b) Single source. `main.swift:5217-5224` computes one `SourceReference`; `SessionHandoff.source` (line 19),
  `RunSummary.sourceContext` (552) and `ConversationSession.sourceContext` (`OS1App.swift:1999`) are single
  optionals; `OS1App.swift:3198` overwrites unconditionally, including with nil.
- (c) Truncation. `OS1App.swift:2072` `.suffix(16)` removes the originating objective first; per-message
  `prefix(12_000)` (2074) cuts the tail of long decisions; `SourceContext.swift:24/38` then trim the head again.
  Receipts/system notes never enter the handoff, so executed actions and verified facts are invisible.
- (d) Mixed allow/deny. `main.swift:811-813` replaces prohibition clauses with the bare token `read-only`
  anywhere in the prompt: "파일을 수정해. 서버를 변경하지 마." becomes "파일을 수정해. read-only" (pinned by
  self-test 5816), and without a source no normalization runs at all (802, pinned by 5819).
- (e) Late results. `OS1App.swift:3173-3282` adopts by `submission.sessionID` without checking
  `activeRuns[...]?.submissionID == submission.id`, so a cancelled or superseded run can append output and clear
  the newer run's bookkeeping.
- (f) Native turns outside OS1. `nativeMessages` (`OS1App.swift:2787-2933`) are displayed only; they never
  reach `sessions[].messages` or the handoff, so OS1 and the backend histories diverge silently.

## 5. Invariants the new structure guarantees

1. One logical OS1 task (conversation) keeps one `TaskContext`; backend
   session IDs are bindings inside it, never a substitute for it. A new native
   session never resets objective, decisions, project baseline or sources.
2. Objective, active constraints, confirmed decisions, project baseline and
   verifiable source references are always handed to the backend, independent
   of transcript truncation. Truncation only ever drops old transcript text.
3. Sources are a set with roles and provenance. Adding a source never deletes
   a source with a different role; replacement is explicit (`supersedes`).
4. Three baseline facts stay distinct: recovery baseline (LATEST.json /
   Gold), recorded operating release (custody record), live-verified state
   (only when actually checked, with timestamp). "Latest" is never inferred
   from a file name.
5. Preparation/continuation requests ("수정 좀 하자 준비해", "그거 이어서 해",
   "아까 자료 기준으로") are one common capability: resolve project → attach
   context → select baseline → ensure materials → prepare workspace → ask only
   the genuinely missing decision → route. Project adapters interpret sources;
   they do not own the flow.
6. Feasibility before routing: required capabilities (R2 read, web, file
   write, tests, deploy, native resume) are checked against the bound backend;
   "tool unavailable" is never adopted as the final answer.
7. Results return as the same OS1 shape: native binding, executed stage,
   side-effect status, changed artifacts, verification facts vs claims.
   Executed-path evidence precedes any status upgrade; dispatched writes are
   never replayed automatically (existing DeliveryOutbox/BackendRecovery
   guards are kept).
8. Native transcripts produced outside OS1 are ingested incrementally by
   stable ID and cursor, deduplicated against OS1-sent messages, and marked
   partial vs complete; unlinked native sessions are shown as unlinked.
9. Secrets, unrelated projects' sensitive data, and protected routing
   material never enter the handoff payload.

## 6. Shared state model (new module `OS1Context/TaskContext.swift`)

`TaskContext` (Codable, schemaVersion 1, `contextRevision`):
- identity: `conversationID`, `projectID?`, `objectiveID`, timestamps
- objective: request text, normalized kind (`acquire`, `prepare`, `modify`,
  `explain`, `verify`, `other`), completion conditions, allowed scope
  (`read_only`/`workspace_write`/`full_access`), prohibitions, pending
  decisions
- project baseline: repository identity, workspace, `recoveryBaseline`,
  `operatingRecord`, `liveVerified` (each a `BaselineRecord` with id, key,
  sha256, bytes, recordedAt; `liveVerified` only with `verifiedAt`)
- sources: `[TaskSource]` — role (`sourceCode`, `operatingReleaseRecord`,
  `recoveryBaseline`, `researchOriginal`, `testResult`, `userDocument`,
  `retrievedSnapshot`), existing `SourceReference`, provenance (repository,
  commit, bucket, key, path, sha256, bytes, retrievedAt), coverage
  (`full`/`excerpt`/`truncated`), verification, `supersedes`
- bindings: `[BackendBinding]` — provider, nativeSessionID, last ingested
  cursor, last handed context revision, capabilities, checkedAt
- executions: `[ExecutionRecord]` — executionID, provider, stage, times,
  side effects (`none`/`possible`/`confirmed`/`unknown`), artifacts, retry
  reason, adoption
- decisions, facts (verified vs claimed with evidence), next steps, blockers
- event log: append-only `TaskEvent` records (revision, time, kind, summary)
  persisted next to sessions; streaming progress is not an event.

`TaskContext.handoffBlock(limit:)` renders the mandatory block for backends.
`TaskContext.migrated(from:)` builds the first revision from an existing
conversation (single `sourceContext` → one `retrievedSnapshot` source; native
IDs → bindings). Old fields stay for rollback; new fields are optional.

`PreparationIntent` (pure): recognizes preparation/continuation phrasing in
NFC/NFD Korean and English, resolves the project from explicit aliases or the
conversation's `projectID`, rejects quoted/negated/other-project phrasing, and
never turns "수정하지 마" into a modification.

`BaselineSelection` (pure): picks the baseline for a purpose — recovery
restore → recovery baseline; modification preparation → operating record
(when present) with live status explicitly `unknown` unless verified.

## 7. Migration

- `ConversationSession.taskContext: TaskContext?` added; `sessions.json`
  schema stays decodable by older builds (new optional field). On load, a
  missing context is derived lazily from existing fields; nothing is deleted.
- Event logs live in `~/Library/Application Support/OS-1/task-events/<id>.jsonl`.
- Rollback: older executables ignore the new field; no data loss.

## 8. Recovery and resume

Each execution records stage and side-effect status; restart re-reads the
task context, keeps `pending`/`unknown` executions non-replayable for writes
(existing guards), and resumes from the last checkpoint. Late results are
adopted only if their context revision is not superseded by a newer decision.

## 9. Verification plan

Deterministic fixtures (executable test targets, no model calls): preparation
intent set (NFC/NFD, negation, quotes, other project, deictic continuation),
baseline selection with the real v151/v157 fixture values, multi-source
retention, truncation keeping objective/decisions, migration round trip,
mixed allow/deny prohibition normalization, incremental native ingestion
dedupe. Installed-build checks: repeat cases A/B through the installed
runtime with the same requests; conversations, pins, drafts, queue preserved.
Live backend checks are bounded and recorded separately from fixtures.

## 10. Implementation map (what exists in code after this pass)

| layer | file | what it does |
| --- | --- | --- |
| shared state | `Sources/OS1Context/TaskContext.swift` | `TaskContext` (objective/scope/prohibitions, decisions with supersession, project baseline with `recoveryBaseline` / `operatingRecord` / `liveVerified`, sources with provenance and supersession, backend bindings with ingestion cursors, executions, facts vs claims, next steps, blockers), `handoffBlock(limit:)` (essential sections never dropped), `adopting(_:handedRevision:)`, `acceptsLateResult(fromRevision:)`, `explicitDecisions(in:)`, `TaskEventLog` (append-only JSONL per conversation), `PreparationIntent` (markers + registered project aliases), `ProjectAdapterRegistry` (`scv-instagram` → remote materials, `os1-clodex` → local workspace), `ScopeResolution` (mixed allow/deny sentences), `BaselineSelection`, `NativeIngestion` (cursor, digest dedupe for every role, partial output excluded) |
| custody record | `Sources/OS1Context/ProjectMaterials.swift` | `SCVCustodyRecord.parse` reads the newest `docs/scv-instagram-v<N>-custody.md` table (release id, R2 key, sha256, bytes, date) — the *recorded* operating release, never a live claim |
| handoff | `Sources/OS1Context/SourceContext.swift` | `os1-session-handoff-v3` carries `taskContext`; v2 still accepted; only the transcript shrinks under the 190 KB envelope |
| runtime | `Sources/OS1/main.swift` `runTask` | migrates a v2 handoff, sets the objective/scope once per request, resolves the preparation project (alias → context project → registry), acquires or reuses SCV materials (`scvProjectEvidence` now captures `projectBaseline` = v151 pointer + newest custody record via `scvOperatingRecord`), binds every acquired source to the task, answers bare preparation locally (`preparedStateBundle`, `runWorkspacePreparationControl`) with three separate version facts, injects `handoffBlock()` into `providerPrompt`, binds native sessions and records the execution on completion (`finishedRun`), returns `taskContext` in `RunSummary` |
| routing | `Sources/OS1/main.swift` `sourceRoutingTask` | prohibition normalization no longer depends on an attached source; positive clauses are never removed |
| app | `Sources/OS1App/OS1App.swift` | `ConversationSession.taskContext` (migrated on load, lenient envelope decode preserves the unreadable original), objective/decisions set in `start()` (queued turns never invalidate the in-flight one), `ActiveRun.handedRevision`, late-result gate (preserve, do not adopt), source attachment kept unless the request detaches it, `adopting` merge, `ingestNativeRecords` (per-binding cursor, bounded first pass, OS-1-sent text skipped, labeled `[native session, outside OS-1]` in the handoff), `TaskEventLog` under `Application Support/OS-1/task-events/`, receipt validation for `work_preparation` |

## 11. Acceptance tests (§19) — status by evidence source

Labels: **fixture** = deterministic check in `TaskContextTests`/`SourceContextTests` executed in this pass; **typecheck** = compiled, behaviour not executed; **pinned** = self-test assertion added but not executed in this sandbox; **unknown** = needs the installed build or a live backend; **not implemented**.

| # | item | status | evidence |
| --- | --- | --- | --- |
| 1 | "인스타그램 수정 좀 하자 준비해" | fixture + pinned, live unknown | `PreparationIntent` fixture A; `preparedStateBundle` pins; runtime path compiles; needs installed run with R2/GitHub |
| 2 | NFC/NFD same meaning | fixture | fixture A decomposed variant; routing pin NFD passthrough |
| 3 | second project via the common structure | fixture + typecheck | fixture N (`os1-clodex` alias → `localWorkspace` adapter); runtime `runWorkspacePreparationControl` |
| 4 | "수정하지 말고 설명만" | fixture + pinned | `ScopeResolution` read-only; routing pins |
| 5 | recovery vs operating record | fixture | fixture C/L (`BaselineSelection`, custody parse, three baseline lines); Gold pointer is read-only in code |
| 6 | documents A and B kept | fixture | fixture D (attach keeps both, explicit supersede only) |
| 7 | excerpt-only source | fixture | `Coverage.excerpt` carried in the handoff block; claim not upgraded |
| 8 | hash mismatch | typecheck (pre-existing) | `SourceContextStore.read` / `ProjectMaterialObject.verify` reject mismatches; not re-executed here |
| 9 | narrow fact question | unknown | explain path with attached snapshot; needs installed run |
| 10 | constraint survives 16+ messages | fixture | fixture E (objective/prohibitions/decisions never dropped under limit) |
| 11 | byte-limit overflow | fixture | `testHandoffV3CarriesTaskContext` (transcript halves, context intact) |
| 12 | decision change | fixture | fixture F/M (supersession; late result not adopted) |
| 13/14 | Codex↔Claude keep objective/project/source revision | typecheck | handoff block is provider-independent; needs live run |
| 15 | new native session keeps the task | fixture | fixture G (`bind` resets only the cursor) |
| 16 | native-app work read back without self re-import | fixture + typecheck | fixture K (+ any-role digest); app `ingestNativeRecords` |
| 17 | same-title different session | typecheck | bindings are by native session id only; no title matching added |
| 18 | A and B concurrently | unknown | existing per-session admission; not exercised here |
| 19 | late result of a previous run | fixture + typecheck | `acceptsLateResult`; app late-result gate |
| 20 | app restart | typecheck | lenient load + migration; not exercised on the installed build |
| 21 | timeout then late result | unknown | delivery outbox unchanged; late gate applies |
| 22 | revision changes mid-run | fixture + typecheck | `handedRevision` vs semantic revision |
| 23–27 | UI focus/backend view/status/copy/markdown | unknown | no UI change in this pass except receipt text; needs installed run |
| 28 | instructions inside sources | typecheck | task-context block states quoted content is data; source text unchanged |
| 29 | other project's sensitive data | typecheck | sources are attached per conversation only; no cross-conversation reads added |
| 30 | migration preserves pins/order/drafts/queue/bindings | fixture + typecheck | envelope fields untouched; `migrated` keeps ids; app self-test `taskContextSelfTest` (pinned) |
| 31 | inaccessible context | fixture | ingestion cursor unchanged on read failure; no "fully synced" claim |
| 32 | evaluator failure | fixture | scratch harness exits non-zero on the first failed check; `verify-*.mjs` record FAIL entries |

## 12. What was not verified in this pass

- `os1 self-test`, the `OS1ContextTests` executable and the app self-test could not run in the session sandbox (Foundation temporary directory denied). Their new assertions are present but unexecuted; the task-context fixture section ran through a scratch harness (79 checks + N).
- No live R2 or GitHub read, no installed-build replacement, no user-flow verification on the installed app.
