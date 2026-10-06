# Full-access handback — frozen verification receipt

Scope: source patch for later Claude build330 integration. Base `385d60ab0e3cea2e62274da6700b4ffb8be4b5c9` / build328. Branch `os1/full-access-handback`.

## Executed final gates

| Gate | Result |
| --- | --- |
| `swift build` / all debug products | PASS |
| `OS1ContextTests` / entire existing suite | PASS |
| Source-confinement fixtures, including real temporary sandbox-exec operations | 128 checks PASS |
| Source call-site wiring | 100 checks PASS |
| New actual fake-backend shared-lease + original `--resume` argument trace | 19 checks PASS |
| `os1 self-test`, en and ko configurations | Both PASS, including the same19check handback regression |
| `os1 fleet-self-test` | 79 checks PASS |
| OS1App `--self-test`, `--self-test-profile`, `--self-test-sidebar-queue`, `--self-test-parallel`, `--self-test-queue-fork`, `--self-test-composer`, `--self-test-steering` | All7PASS |
| Independent bounded source audit | PASS, no remaining material call-site defect identified |
| Adversarial call-site mutations | Initial12 + later6 rejected by structural gate |
| Existing source-only guard launching actual installed Claude `--version` | PASS, Claude2.1.290; no model call |
| `git diff --check` | PASS |

Paid provider-model calls:0. No `os1 run`, backend-health refresh, version bump, self-update stage/apply, installation, live OS-1 restart, authentication-cache copy or Handy operation performed.

Final tests used temporary synthetic backends/stores/paths. The required Fleet test uses the existing public `Config/production.json` through OS1_CONFIG; a debug binary has no installed adjacent configuration by default. No production configuration was altered.

Existing live conversation/queue JSON was byte-identical before/after the final test run. Raw snapshot/digests and full test stdout/stderr are kept privately, not committed to the public repository.

## Behavioral assertions

- Explicit full-access control line, exit0, eligible actual REVAS/delivery state, original Claude UUID, no cancellation; neither quoted markers nor denial alone start it.
- Broad Claude sandbox OFF only inside one task-local resumed attempt.
- Source-only protected path writes denied (including symlink spelling) while a temporary plugin-like outside path can be written.
- Actual shared lease excludes an exclusive source repair; terminal fixture releases it.
- Actual fake backend receives `--resume` original ID, not `--session-id` or a fork, and observes sandbox.enabled=false.
- First reports and correction receipts remain visible through refusal/cancellation/failure; a required failed continuation is not marked adopted.
- Full-access then OS1-change ordering; no second full-access loop, no provider substitution or automatic source finisher/install in that phase.
- Precise masked transport errors retain partial-stream/native custody through the existing interruptedExecution catch.

## Limits and lineage

No paid provider end-to-end task or real Explyt/plugin installation was executed. The branch is not installed. The source-only OS guard proves wrapped-process/inheriting-child protection, not global containment of existing LaunchServices/XPC daemons. Normal owner approvals and managed OS/provider restrictions still apply.

During development, an inert fixture first failed because its generated Python path string incorrectly treated JSON slash escaping as Python path syntax; that fixture was repaired before the final gate. A Fleet test initially lacked the debug command's public config path; supplying the standard OS1_CONFIG fixed the harness setup. Failed logs were retained privately. Neither was labeled as a successful production repair.

Version/build files and the concurrently owned UI/progress/governance/installation surfaces remain unchanged. Claude can integrate the verified branch after its build329 changes, then perform its own build330 release/install/runtime verification.
