# OS-1 bounded task workflow (build154)

## Owner objective

A substantial workspace write is one owner task, not a single model prompt or three independently completed jobs. OS-1 detects a bounded multi-stage request, then runs:

1. **Architecture / root cause:** strongest model tier visible in the available native Codex / Claude Code catalogs; read-only. Source, logs, target, scope, test and rollback contract.
2. **Implementation:** lower eligible observed coding tier; one native workspace-write attempt. It must preserve the architecture contract and run deterministic tests.
3. **Verification:** strongest visible tier, new native session, read-only. It inspects the actual diff/tests/effect and must end with an exact `OS1_WORKFLOW_VERDICT` line.
4. **Bounded repair only if verified BLOCK:** one implementation correction, then one fresh verification. Missing verdict, uncertain write, invalid native record, permission mismatch, or second BLOCK holds the task rather than replaying it.

The owner's original objective, source handoff and existing conversation state remain the task floor. Stage outputs and native receipts are saved in OS-1. The governance monitor receives one parent task ID and every stage attempt is charged to that task; partial stage adoption is not counted as owner-task completion. Measured native token/latency records remain per attempt. If any usage is missing, a complete task token count remains unavailable rather than becoming zero.

## Routing and cost boundary

The current tier rules are **routing heuristics**, not measured quality rankings or price tables. Architecture and verification are capability-first; bounded implementation is capacity-aware and chooses the lower eligible observed coding tier. The signed OS-1 router still issues each permissioned native execution ticket. This build does not claim that these choices minimize real cash cost, quota opportunity cost, or expected rework. Those require matched, task-level outcome and usage data; first-pass completion and owner retry already exist in the governance ledger.

The executable pool here is the authenticated native **Codex** and **Claude Code** backends. ChatGPT Chat/Pro and Claude chat are not silently treated as programmable APIs or zero-cost endpoints. No browser-session scraping, subscription quota conversion, or API billing assumption is part of this build. They can be added only after a lawful, supported connector and actual capacity/usage contract are verified.

## Proof boundary

Deterministic tests validate task detection, stage catalog filtering, verdict shape, bounded-repair gate, parent governance accounting and the existing CLI/app self-tests. A signed release and installed-app receipt validate packaging/installation. A real Instagram task has **not** been run by this new workflow in a fresh matched comparison here. Therefore completion-rate, token-savings and architecture-uplift claims remain unmeasured; no synthetic percentage should be shown as such.

The earlier build153 work is preserved. This change does not deploy the separate public website page or automatically replay prior Instagram/SCV external side effects.
