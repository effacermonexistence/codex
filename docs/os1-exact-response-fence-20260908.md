# OS1 response-contract / trailing prohibition repair

## Objective and observed failure

On the installed build89, a read-only acceptance request asked for exactly
`READ_ONLY_OK`, followed by explicit prohibitions against commands, service
restarts, file changes and private-data access. All four native attempts
returned that exact answer with exit 0 and verified native persistence. OS1
nevertheless retried and failed. Correlated execution:
`e3a51088-a4c2-4f20-bf90-df6786d14c14`.

The literal matcher was anchored to the end of the entire request. A trailing
safety fence therefore changed the verification profile from exact response to
review, whose minimum-length gate rejected the correct 12-character response.

## Five-view audit and architecture

| View | Divergence | Required convergence |
| --- | --- | --- |
| Objective | Exact answer treated as a review | Parsed literal equality, not prose length |
| Context | Final prohibitions obscure output contract | Preserve the full provider prompt and objective hash |
| Execution | Four successful native calls | First valid answer adopted; no repeat model call |
| Verification | Length overrides explicit output requirement | Wrong/extra output, missing record, nonzero exit still fail |
| Cost/latency | Three unnecessary retries | One attempt; record actual usage, never invent cost |
| Safety/UX | Safety wording causes failure | No permission widening, backend foregrounding or session deletion |

Minimal path: original request -> bounded derived contract view -> signed
read-only route -> background provider -> exact output + native evidence gate
-> same OS1 execution manager. Only fully parsed standalone negative action
clauses can be omitted from the derived view. Mixed/conditional/quoted clauses,
positive actions, source-value extraction and extra answer requirements cannot
be silently discarded. The full request remains intact for execution.

Do not remove review checks globally, accept every short answer, add more
critique prompts or upgrade models to mask a deterministic verifier failure.
The intrinsic self-correction limits studied in
https://arxiv.org/abs/2310.01798 motivate using external executable checks here;
this patch is a parser regression repair, not a new research algorithm.

## Rollout and rollback

Preserve the immutable preceding private adapter; deploy a new private adapter
and content-addressed policy bundle, then update service bindings. Keep the old
policy selectable for already-issued tickets. Public Git contains tests and
deployment metadata, never private routing implementation or credentials.
Follow https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
for private service bindings and checked deployment. Rollback is the prior
route/evaluator deployment and policy pointer; no conversation rollback.

## Acceptance

Reproduce the exact incident offline; test suffix permutations, punctuation,
wrong/extra output, refusal, nonzero exit, missing native evidence, positive
mutation, mixed instructions and source-value requests. Run existing router,
evaluator and installed native regressions. Repeat the exact incident through
the installed CLI and remote policy: one adopted answer, zero workspace file
changes, no external app opened. Recheck the already-approved isolated write
path separately. Record evidence and limitations before completion.

## Additional installed-path boundary

The authorized isolated write probe exposed a second mismatch before a model
call: `Create auto-review-probe.txt ... Do not modify any other files, services
or settings.` received a write ticket but the local classifier interpreted the
relative fence as a blanket prohibition. The existing `anything else` form worked;
the `other files` form did not. Add a bounded, whole-clause relative-target fence
parser before general prohibitions. Preserve the matched prohibition verbatim,
require a separate positive mutation to grant write scope, and keep conflicting
blanket prohibitions read-only. Repeat the exact failed probe on installed build90.
This follow-on change requires a signed local app/CLI upgrade with session and
signing-identity preservation; the remote-only repair did not.
