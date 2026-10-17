# Build390 — bounded task-scope authority repair

## Run card

- Goal: retain implementation capability when a task protects a different named file or describes a separate evaluator's read-only sandbox; preserve genuine worker read-only constraints.
- Source of truth: the native task-scope resolver and the original frozen two-task diagnostic. Original task text is not rewritten.
- Target: `ScopeResolution` in `Sources/OS1Context/TaskContext.swift`; native catalog fixtures in `Tests/OS1ContextTests/RCCNativeCatalogBuilderFixture.swift`.
- Allowed: narrow resolver/authority-text enforcement, regression fixtures, version metadata, this receipt.
- Forbidden: live conversations/queues, authentication, provider policy, model substitution, JS runtime changes, original experiment answers/scores, ChatGPT relay, OhMyBug reinstallation.
- Symptom: a real implementation task reached the local planner with 40 read-only and zero write candidates despite the host not requiring read-only. The worker correctly refused to write its requested deliverable.
- Expected: the exact implementation task can retain write candidates, while explicit host read-only, global no-write, contradictory same-target requests, ambiguous protected targets and quoted instructions stay fail-safe.
- Verification: native deterministic fixtures, release/source gates, verified installation preserving queue, then one separately frozen corrective execution.
- Stop: do not broaden into a general natural-language permissions compiler or alter checker assertions to make generated output pass.
- Receipt: private evaluation records under `~/.os1/evaluations/quality-preflight-20261016` and the source-linked release/install receipt.

## Observed failure, not a hypothetical quality claim

The frozen build389 diagnostic contains two synthetic tasks and a separately declared Astra/ultra reference. The text-extraction task passed the same required checks in both arms. The file-implementation task failed in OS1: a prohibition on modifying a different named instruction file and the independent evaluator's future read-only sandbox were promoted into a global worker no-write rule. The reference produced the file and passed its checks.

The original negative result remains immutable. This repair does not relabel it as success. The comparison does not establish general flagship parity, subscription-quota savings, or Anthropic parity. The declared Claude reference was unavailable because its observed native quota was exhausted; no alternate model/account/API fallback was used.

## Repair boundary

The resolver separates a bounded named-target prohibition from a global prohibition and preserves the original restriction for execution. It consumes only a narrowly recognized other-actor runtime description beside a direct implementation request. Worker references, restrictive tails, global restrictions, same-target contradictions and unresolved path/glob ambiguity remain fail-safe.

Host `requireReadOnly` remains an absolute catalog constraint. Quoted action examples do not independently authorize writes. Original request and policy continue to be forwarded unchanged. The existing OpenClaw task retains ownership of planning, execution, cancellation and adoption; adapters do not acquire another decision loop.

This is scope classification, **not a new per-path filesystem ACL**. Retained named-file restrictions still travel with the task; the patch does not prove symlink identity or arbitrary absolute/relative path equivalence. Existing source confinement and runtime permissions are unchanged.

## Proof and retest contract

The corrective task is one new OS1 Auto execution with at most one native worker attempt, no new baseline/judge, and unchanged original prompt/checker bytes. Its answer/artifact must be locked before scoring against the existing cached reference. It is labeled `post_dev_reproduction`, not fresh held-out or clean public proof. Source tests are model-free; fixture specifications are not provider executions.

The runtime and plugin SHA-256 pins remain unchanged from build389 because this repair is native-only. Version/build metadata changes identify the executed installation; staged source alone is not completion. Exact command/test/install outcomes are preserved in the private receipt rather than asserted before execution.
