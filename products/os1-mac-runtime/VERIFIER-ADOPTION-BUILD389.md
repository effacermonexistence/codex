# Build 389 — reject failed node verification before dependency adoption

## Run card

- Goal: preserve failed reference/explicit candidates as evidence without allowing their dependent work or parent quality adoption.
- Source of truth: current persisted OpenClaw runtime and deterministic source-derived regression fixtures; predecessor build388.
- Target: `Resources/openclaw-os1-bridge/rcc-runtime.mjs`, its exact installed-resource pin, version metadata and two runtime fixtures.
- Allowed: the node-verifier settlement transition, targeted regression coverage, pin/version/documentation.
- Forbidden: another coordinator, changed objective/permissions, provider fallback, verifier weakening, transcript/queue cleanup, ordinary ChatGPT revival, automatic paid API, merge without the existing merge gate.
- Symptom: a failed reference/explicit verifier with no remaining escalation set the child to `completed`, allowing dependent dispatch and a permissive parent verifier to certify it.
- Expected: failed node retained as `held` with `node_verifier_failed`, `task_quality=failed`, `parity_state=unverified`; downstream remains blocked; no duplicate provider execution.
- Validation: reproduce before patch, false/throw/malformed matrix across direct-reference/explicit/already-escalated routes, passing controls, existing cancellation/restart/lease/route tests, full source/resource build and verified install.
- Stop condition: preserve any failed result/unknown side effect; do not replay a real task or loosen a gate to obtain success.
- Output receipt: private timestamped installer and evaluation receipts, pushed exact source SHA and R2 source manifest. Written policy is not runtime proof.
- Proof mode: internal source-derived regression and bounded local runtime validation, not flagship-quality/public benchmark proof.
- Gold/scorer visibility before final lock: not a benchmark generation run; deterministic fixture expected states are source-derived development tests.
- Adoption: only passing verification releases dependents; a failed reference has no higher fallback and is retained without task-quality adoption.

## Repair and regression

`_verifyNode` previously escalated a failed cheaper candidate, but otherwise marked both passes and failures completed. The repaired terminal transition marks only a pass completed. A failed final candidate is held, retains its output/native receipt/attempt history, and cannot be laundered through a subsequent parent verifier. Existing retained-evidence parent presentation is unchanged (`returned_unverified` where applicable).

The regression was first run against the old implementation and observed an incorrectly `completed` parent. After the repair, the focused runtime/tier pair passed 165 tests. Source/resource advisory wiring passed 101 checks. Full release/install/CI results are separate receipts and must be read before claiming those gates.

## Evidence method

The [ICLR self-correction study](https://arxiv.org/abs/2310.01798) was inspected for the bounded repair method: generated self-critique is not independent external verification. The paper does not establish this implementation's correctness. The actual reproduced regression and executed tests are the local repair evidence.

## Quality comparison boundary

Neither these tests nor build388's arithmetic smoke establish general task equivalence with latest flagship maximum reasoning. A separate small matched experiment must freeze the task, instructions, artifacts, checker, model/effort and call budget, lock outputs before scoring, preserve unavailable reference arms and compare each reference separately. Never promote missing quota/model access or a single contract pass into general quality parity.

OhMyBug was explicitly uninstalled by the owner. No review/attestation exists; no main merge is authorized by a local advisory result.
