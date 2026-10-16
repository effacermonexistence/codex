# Core-owned routing interpretation — build 387

## Locked scope

OS1 submits the original request and host context once. The same persisted
OpenClaw RCC task owns optional interpretation, deterministic admission,
catalog selection, planning, dispatch, cancellation, verification and result
adoption. This does not reopen abandoned ChatGPT routing or promote Qwen9B.

The native `rcc-intent` bridge is a pure compiler, not another scheduler or
model owner. Core invokes the existing pinned local model only when grammar
and source screening require an interpretation. The original schema literal
preserves property order. The local completion uses reasoning off and the
existing strict recipient, payload, exclusion and source gates. Its output
is a candidate, not authority.

## Interfaces preserved

- Original `snapshot.task` remains immutable; source-bound `effective_task`
  is a narrow read-only routing derivation owned by Core.
- Native catalog/adapter validation reconstructs the original host and reruns
  the same compiler against the raw candidate before accepting derived routes.
- Explicit legacy tasks retain their contract; exact local arithmetic and
  check-ins bypass interpretation and provider calls.
- The same Core controls the interpretation deadline, cancellation and
  quiescence. Late completion cannot resume a cancelled/held task.
- UI exposes only bounded `routing_intent` state/notices/reason/hash and the
  real coordinator node while interpretation runs. No fabricated workers,
  raw private context or model output is published.
- Sessions, queues, provider authentication, sandbox boundaries and model
  digest pins are not replaced. No autonomous fallback to API/browser/Work.

## Source verification before release

- Swift debug build and full OS1ContextTests passed.
- New compiler fixture: 34 checks; existing interpreter 344 negative cases,
  fan-out 106, native catalog 327 and projection 83 checks passed.
- Node RCC suite: 201 passed, zero failed, one explicitly gated native test
  skipped in default mode; the native test was then explicitly run and passed.
- Native integration uses actual Swift compiler/decoder + real SQLite Core
  with injected completion/executor fixtures. It checks source/derivation
  hashes, native rejection of tampering, grammar and model-assisted paths,
  original-task preservation and four projected child nodes. Provider calls0.
- Source wiring: RCC99, confinement110, OpenClaw sidecar38 checks passed.

These are deterministic/source integration results, not measured flagship
quality parity or broad natural-language routing guarantees. Prior 4B/9B
experiments used a different prompt and are not production efficacy proof.
Release packaging, authoritative cloud review, installed runtime observation
and state-preservation receipts are separate gates and must be recorded from
their actual outputs; this document does not assert them in advance.

Known pre-existing advisory: `test-parallel-execution-wiring.py` searches for
an obsolete `ParallelAgentRuntime.shouldPlan(prompt,` source fragment. It
failed before this patch and is not the release build's execution verifier.
It was not weakened to make this change pass.
