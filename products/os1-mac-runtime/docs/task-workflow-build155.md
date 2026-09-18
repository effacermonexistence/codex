# OS-1 workflow self-repair integration — build155

## Scope
Preserves build154 task decomposition and build153 continuity. No Instagram production action, public-site deployment, credential migration, or previous external-task replay is authorized by this verification.

## Repairs
- Signed routing requests describe the current stage, not quoted future write instructions. Architecture/verification remain read-only; implementation requires workspace-write.
- Owner text, not OS-1 stage scaffolding or quoted verifier failures, selects the project and permission intent. A generic scratch task must not jump to OS-1's own checkout.
- Implementation catalog retains all supported efforts; a low/medium preference cannot remove the router's required capability floor. Tiers are heuristics, not measured price/quality claims.
- OS-1 source custody spans the entire workflow, with child stages sharing its lease rather than deadlocking on reacquisition.
- Implementation cannot stage an OS-1 update. Independent PASS precedes the existing deterministic version/build/test/stage/commit/push tail. The idle installer separately checks preservation and rollback. Staged is not installed.
- A fresh verification session receives runtime-verified native record locators plus the architecture contract. It can inspect primary pre-change observations and tool results rather than being asked to trust an implementation summary. Record persistence is not blanket proof of model claims.
- No-eligible-route before any provider call is reported as a capability/routing block, not as failed result verification.

- Self-repair secret scanning now requires a token boundary before the API-key prefix; a long `task-...` filename no longer blocks a clean release. Synthetic credential cases still reject.

## Validation contract
Deterministic fixtures cover stage intent, permission shape, project-scaffolding isolation, catalog effort retention, PASS/BLOCK shape, bounded retry and source-update gating. Live smoke uses only an isolated calc.py addition defect; it must execute architecture, implementation, and a fresh read-only verification and preserve test_calc.py. The actual private receipts live under ~/.os1/verification/workflow-build155/; the sanitized successful execution receipt is task-workflow-build155-live-receipt.json. The final live run executed three stages, corrected only calc.py, independently passed the tests, preserved test_calc.py and used a fresh verifier session.

Earlier live attempts are preserved, not counted as success: write/read-only ticket mismatch, implementation read-only classification, no eligible effort tuple, and wrapper-induced project substitution, and missing primary-record handoff to the independent verifier (which correctly blocked despite functional tests passing). An operator attempt launched before a rebuild finished was interrupted and is not counted as validation.

## Evidence discipline
ReAct (https://arxiv.org/abs/2210.03629) motivates source/action feedback; intrinsic self-correction limitations (https://arxiv.org/abs/2310.01798) motivate independent evidence rather than fluent self-certification. Neither paper proves this implementation. Native receipts, actual source diff, deterministic tests and installed artifacts are the proof gates.

Only authenticated Codex and Claude Code are executable backends here. Ordinary ChatGPT/Claude chat subscriptions are not implemented as programmable/free endpoints. No measured token savings, first-pass improvement, or universal self-repair guarantee is claimed from this smoke. Unreported usage remains unknown, not zero.
