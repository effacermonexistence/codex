# OpenClaw single-owner RCC Runtime — implementation run card

- Goal: implement the owner-approved single OpenClaw task core. OS-1 presents and submits; the core owns plan, exact configuration, scheduling, cancellation, retry and result adoption.
- Source of truth: source commit `117a68ef16b29c9e117d9b958a35977651f011f8`, installed build 367 (0.9.301), the current owner policy verified from its enrolled source, and the user's architecture plus the six reviewed execution contracts.
- Target: existing `products/os1-mac-runtime` and the existing route authorization services only. No new hosted orchestrator or evaluator.
- Allowed: RCC Runtime OpenClaw extension, typed RPC/client, native metadata/one-attempt adapters, durable task/event state, UI projection, exact-profile authorization, deterministic fixtures and build/release verification.
- Forbidden: Handy, auth cache copying or output, arbitrary API/paid fallback, other products, unrelated source trees, deleting sessions/queues, weakening source/permission/signature checks, treating native execution as flagship quality proof.
- Current symptom: OS-1 and OpenClaw do not share a sole task owner. OpenClaw chooses only a surface while OS-1 independently chooses model/effort and manages retries.
- Expected result: one original task, one durable state owner, exact configuration tickets, visible child tree, zero LLM arithmetic fast path, and truthful unavailable/unverified states.
- Validation: pure state/configuration/side-effect regression; native compile and existing self-tests; actual pinned OpenClaw plugin RPC; isolated cancellation/restart/dedup and deterministic runtime observation; live installation only after preservation/rollback gates.
- Stop condition: fully verified in-scope outcome, or a genuine access/transport/payment gate after exhausting safe alternatives. No partial success represented as product completion.
- Receipt: source SHA, branch, tests, raw failed outputs, Gateway/plugin hashes, task journals, installation/session preservation receipts and any unresolved transport/quality limitations.

## Evidence boundary

The current ordinary consumer ChatGPT transport is not a verified native-app adapter. Codex tool-free chat consumes the Codex pool. Never register a renamed lane as independent ordinary Chat capacity.

Execution confirmation, task verification and quality parity are separate fields. First-run policy proposals are permitted but remain unmeasured. No per-request mandatory flagship comparison or final LLM judge.

## Research mechanism

Inspected: ReAct (arXiv:2210.03629) and intrinsic self-correction limitations (arXiv:2310.01798). Apply external state/action receipts and bounded changed-path repair; do not substitute fluent self-review for actual transition validation. These papers are mechanism references, not proof that this runtime succeeds.
