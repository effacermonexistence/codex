# OpenClaw RCC Runtime — source implementation and verification

## Scope / authority

Current objective: implement the owner-approved single OpenClaw task core, not
another OS-1 routing server or per-request final model judge. OS-1 submits and
projects. OpenClaw owns the durable plan, exact configuration, dispatch, retry,
cancellation, adoption and event journal. Existing authentication/signature and
native executor permission boundaries remain in force.

Branch: `os1/openclaw-rcc-runtime-20261010`.
Base source: `117a68ef16b29c9e117d9b958a35977651f011f8`.
Candidate package: 0.9.302 / build 368. Installation is a separate receipt.

## Implemented source

- One persistent authenticated loopback OpenClaw Gateway service with the RCC
  Runtime extension; Node 24 SQLite task/event state and exclusive ownership.
- Swift typed, source-bound request/catalog/DAG/ticket/record/snapshot contracts.
  A reused task ID with changed input is rejected rather than replayed.
- OS-1 App, CLI, shared task/workflow and ordinary Fleet ingress submit the same
  original request to the core. A core connection failure never falls back to
  the old independent planner. Native adapter child re-entry is denied.
- Actual native model/effort/account/authentication/quota inventory. No API-key
  fallback, guessed quota, alphabetical model ranking or silent model change.
  All admitted candidates survive the bounded inventory; >256 is explicit hold.
- Authentication observed once per provider per inventory, not once per model.
  Planner receives losslessly grouped configuration IDs with the same exact
  admission catalog. Own-input overflow is held, not silently truncated.
- Local Qwen is a tools-disabled planner; per-model RCC instructions travel
  through existing supported native developer/system-instruction channels.
  Unknown cost and unmeasured quality remain unknown.
- Plain arithmetic and exact local check-in record one local child and use zero
  planner/native-model calls. Explicit named route tests never use this shortcut.
- Durable DAG scheduling, provider-pool reservation, serialized overlapping
  original-workspace writes, cancellation tombstones, restart reconciliation,
  and retry only after proven not-dispatched/no-side-effect failure.
- Requested children are projected to the existing task-tree interface. An
  unavailable explicitly requested route is held visibly, never renamed.
- Single native result bytes preserved. Candidate output is not erased because
  task quality is unknown; missing summary provenance is not invented as local.
- Exact explicit-route arithmetic can be checked using task/config/output-bound
  private native receipts. This is task verification, not flagship parity.
- Native observed usage persisted privately where exposed. No inferred bill,
  token saving, quota reduction or model-quality uplift is manufactured.
- Exact-profile authorization in existing public/private services: authentication,
  signed tuple, immutable policy, actual capability, source hash and one existing
  ledger. No /decide, RCC model call or result-evaluator call on this endpoint.
- Installer/rollback require exact-current-CLI quiescence, retained queued work,
  no unresolved startup intent and no owned native adapter still running.
  Maintenance denies new core admission. No guessed process kill or DB deletion.
- Exactly five sealed bridge resources, source→staged→expanded byte checks.
  0.9.302+ requires 38 payload / 41 component files; older recovery remains exact.

## Evidence / source limitations

Verified offline: Node bridge/core/plugin tests 42 PASS; typed contract 78 checks;
projection 17 checks; Gateway transport 21 checks; installer quiescence 19;
paging recovery 21; process scope 14; resource provisioning 59; sidecar wiring 35;
single-owner/source/resource wiring 43; public authorization tests 194;
private tests 123 and local workerd integration 13. Existing context, CLI, App
and Fleet suites are also run; exact final receipts/logs are retained locally.
These are separate scopes, not an aggregate benchmark score.

Actual pinned OpenClaw 2026.9.9 + local Qwen 3.5:4b was exercised in an isolated
Gateway with synthetic request and mock native transport. One local inference
returned a plan, mock native output `hello` was retained as returned_unverified,
idempotent submission did not replay, and quiescence drained. That smoke used an
earlier source plugin hash. New final source requires its own runtime receipt.
No hosted/provider call is established by that mock smoke.

A live native metadata probe exposed the older 64-row truncation. Source now
retains every admitted row (up to 256) and performs provider auth only once.
Consumer ChatGPT is NOT a native catalog capability. Codex-funded tool-free
`gpt-chat` stays in `openai_codex`; it is not an independent ordinary Chat pool.

The current private Worker immutable policy hash was read from its actual
version metadata and preserved in source; this is not a policy rollover.
Worker deployment, local installation, native end-to-end outputs and quality
comparison each require their own subsequent receipts.

Actual full-policy/snapshot-derived 122-row local tests then exposed: 20144 input
tokens exceeded the legacy16K context;32K native model settings admit it, but
user-visible Conclusion formatting displaced internal JSON. Supported OpenClaw
`runtime.llm.complete` direct Ollama JSON Schema replaces only the internal
planner (same service/state owner; no new server). A further real typed plan
included a write-path hint in read_only scope; task-derived generation schema
now enforces empty read-only paths/empty source-ref list without weakening the
core gate. Final frozen-source isolated smoke PASS: loaded plugin
`03677386223aa689b60975d22217f48c7e6d66b9f83a8e3f57c969a0d321c698`
and runtime `142d4daf2bb08e7b42ba2b705be92551a2bdedacbcc8c4d18c37ce9944c7eb94`.
Actual direct local Qwen call:20,298 input/174 output tokens,45.2204s.
It selected snapshot claude-fable-5-1/low/read_only, copied the original
instruction, and one MOCK native execution returned exactly `hello`, retained
as returned_unverified/parity_unverified. Idempotent resubmit did not replay.
Plain arithmetic/check-in each produced one recorded child with zero model
calls. Four explicitly requested targets produced four held children because
ordinary ChatGPT alone was absent; no substitute or added model/provider call.
Quiescence passed. Real native and hosted calls:0. This is diagnostic runtime
proof, not real backend, live App, quota saving, automatic self-repair or
flagship-quality proof. Earlier artifacts are not promoted to final source.

Native continuation hints now exist only for one full-agent plan and match the
immutable host Codex/Claude session ID. Parallel/chat children remain fresh.
The UI retains only a single unique verified full-agent native ID per provider;
multiple siblings are not collapsed. Core-selected result bytes are displayed
once, not every intermediate child as an independently selected final answer.

## Important failure fixes found during implementation

- Released submit-RPC lifetime was inherited by background local completion:
  use the registered service's AsyncResource and local model allowlist.
- One-child output acquired a node label: preserve its original bytes.
- Initial authorization caller lacked task-bound feedback: supply explicit
  empty observations and the immutable original-objective hash.
- Auto plus historical backend accidentally reselected a provider: preserve Auto.
- Ordinary Fleet/shared entries bypassed the owner: route them before old logic.
- Missing native summary could fabricate deterministic authorship: gate that
  attribution to the actual completed local-core record only.
- Abort killed the CLI before native interrupt: forward a private cancel marker
  first, then bound escalation to the exact owned direct child.
- Installer assumed absent owner metadata meant absent core: preserve unresolved
  startup intent; quiesce forward and rollback; block during live maintenance.
- Catalog prefix dropped current 6.x/6.1 configurations: no truncation.
- Legacy one-ID output budget was too small for a DAG: runtime-only output
  capacity raised; input remains explicitly bounded, not a token-fit guarantee.

## Known incomplete product paths

- Ordinary native ChatGPT has no approved request→response transport here.
  Sanctioned computer-use target inspection denies `com.openai.codex`; official
  documentation prohibits Computer Use automating ChatGPT itself. This is not
  proof of OS1 Accessibility TCC state (still unknown), nor a reason to bypass
  the denied target through AppleScript/AX/CDP or re-label Codex.
  Source: https://learn.chatgpt.com/docs/computer-use
- Automatic OS1 source hand-back/full-access resume/self-repair→stage→install
  has not yet been ported to a same-core typed continuation. The old mechanical
  explicit commands remain source-available, but do not prove the new routed
  task performs automatic self-repair. Do not claim that feature verified.
- Existing production app is preserved at367 until native/signature/continuation
  deployment and end-to-end adoption gates pass. Candidate source is not live.

## Not established / adoption boundaries

- Native ordinary ChatGPT transport and independent ordinary Chat allowance.
- Every arbitrary task's completeness, flagship/max parity or global uplift.
- 50% quota reduction or universally cheapest selection.
- A model critic, repeated agreement or source fixture is not independent proof.
- User/source policy is content-preserved privately; this document is not a
  claim of changing hosted model weights or platform system prompts.
- OhMyBug cloud merge attestation is unavailable with the currently observed
  free-credit/balance state. Local/advisory tests do not authorize a merge.

## Continuation dependency order

1. Final source pins/build/tests and package custody.
2. Exact existing authorization services deployment with old-version rollback.
3. Verified local binary replacement while preserving sessions/queues/core data.
4. Real App/CLI task-tree, zero-model fast path and bounded native-route receipts.
5. Separate native ordinary ChatGPT adapter feasibility/permission receipt.
6. Pre-registered representative task/reference comparison; no per-row oracle.

No Handy, auth-cache transfer, OS-1 session deletion, other-product change,
billing mutation or repository-visibility mutation belongs to this work.
