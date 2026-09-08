# OS1 signed write-intent repair — build 88

## Objective and incident

Prove the build87 automatic-review path with one harmless, isolated Codex file
write. The live probe was correctly stopped before a model call because the
signed ticket said `read_only`, but the local task classifier had incorrectly
classified the explicit English request `create auto-review-probe.txt` as a
read-only objective. Automatic approval review cannot and must not widen a
server-signed ticket.

## Failure boundary and five-view audit

| View | Divergence | Convergence check |
| --- | --- | --- |
| Intent | Filename-targeted English create/write verbs were absent | Explicit filename/directory mutations resolve to `workspace_write` |
| Authority | Client must not upgrade a `read_only` ticket | The existing signed-ticket guard remains unchanged |
| Execution | The backend was never called | Router receives a normalized `Modify workspace files` task |
| Verification | A broad `write` keyword would over-authorize prose | `Write a concise summary` remains read-only |
| Cost/latency | Bad tickets stop or cause another routing attempt | Correct intent is present in the first routing request |
| Security/UX | Auto-review could be mistaken for blanket authority | Only explicit filesystem targets qualify; prohibitions still win |

## Minimal architecture

```text
unchanged user request
  -> bounded local semantic scope classifier
       explicit filesystem target -> workspace_write intent
       ordinary prose generation  -> read_only intent
       explicit prohibition       -> read_only / retained constraint
  -> normalized public routing objective
  -> private router issues signed permission profile
  -> executor requires exact profile match
  -> on-request + auto_review handles eligible Codex approvals
```

The patch adds two narrowly bounded English filesystem forms: an explicit
file/directory noun or a filename with an extension. It does not inspect model
output, mint a local ticket, bypass a denial, or change the provider safety
boundary. Rollback is the verified build87 recovery package.

## Additional reproduced boundaries

The first isolated live run exposed two independent downstream failures after
the initial classifier repair:

1. The requested literal `OS1_AUTO_REVIEW_OK` contained the ASCII substring
   `OS1`. Project-preparation detection used substring matching, intercepted
   the request, and prevented the intended file operation. ASCII project
   aliases now require token boundaries; Korean aliases retain their existing
   behavior.
2. The result evaluator called the currently bound RCC verifier without the
   source-locked policy identifier that issued the route. During a policy
   rollover, a valid in-flight result could therefore be checked by the legacy
   adapter and rejected. Verification now carries the persisted issuing RCC
   policy SHA, and a focused unit test fixes this invariant.

The private RCC adapter was rolled forward without weakening its permission or
safety checks. It now recognizes concrete executed-change evidence such as a
created file, exact byte count, and exact comparison match. The prior adapter
remains present so already-issued routes remain verifiable during rollout.

```text
explicit bounded write request
  -> local scope classifier (workspace_write)
  -> source-locked route + RCC policy SHA
  -> background Codex execution with on-request auto-review
  -> immutable result artifact
  -> evaluator reuses issuing RCC policy SHA
  -> executed-change verifier checks exit, workspace delta and concrete evidence
  -> OS1 adopts the result and records the receipt
```

## Acceptance matrix

| Invariant | Expected | Observed before repair | Build 88 check |
| --- | --- | --- | --- |
| Explicit filename create | `workspace_write` | `read_only` | deterministic fixture |
| Trailing scope fence | bounded write | revoked the write | exact live prompt fixture |
| Marker content | normal file content | OS1 project-preparation interception | token-boundary fixture |
| Policy rollover | issuing adapter verifies | current/legacy adapter mismatch | evaluator policy-binding test |
| Successful mutation | adopted once | verifier rejected weak wording | private adapter self-test + live run |
| User interruption | queued/steered, not duplicate execution | unchanged by this patch | existing steering/replay tests |
| Provider UI focus | background only | unchanged by this patch | focus-ownership self-test |
| Safeguards | provider and signed authority remain enforced | present | no bypass or blanket auto-approval added |

Convergence is all hard checks above passing on the built and installed
artifact. A passing source test alone is insufficient. Divergence is any wrong
scope, project interception, adapter identity mismatch, unverified workspace
change, duplicate result adoption, foreground provider reveal, or additional
file change. Rollback is the build87 recovery package plus the prior immutable
RCC policy pointer; no route state or user session is deleted.
