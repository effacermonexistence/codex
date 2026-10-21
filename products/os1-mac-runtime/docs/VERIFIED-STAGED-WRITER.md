# Bounded verified writer descent (build 413)

This is one extension of the existing OpenClaw RCC task loop, not a second
scheduler, a model-authored quality judge, or an ABCD carry cache.

## Admission

The native host may advertise `staged_writer_envelope_sha256` and
`staged_writer_base_sha256` only for an exact, current, owner-custodied **full**
contract with a local-effects declaration and a bounded plain-directory
workspace. The owner envelope must already pin the exact pre-catalog content
manifest as `stagedWriterBaseSHA256`; size/mtime equality alone is insufficient.
The complete checker and owned artifact paths must exist before
model execution. Partial/discovered test suites, Git/source trees, resumed
native sessions, links, external-effects tasks and permission continuations
are not admitted to this capability. Legacy records gain no new authority.

Core binds the cheapest available admitted Codex tier and an available fixed
reference. Both attempts keep the exact isolation and transaction bindings.
It does not use a correctness score, answer key or post-hoc baseline score to
choose an answer. The native adapter independently rechecks every binding.

## Execution and adoption

1. Acquire the existing original-project lease and freeze the whole bounded
   directory manifest. Clone it to private same-volume custody.
2. Grant the native process only candidate-directory and native-scratch access.
   The original and transaction/verification custody are not model-writable.
3. Run the immutable complete checker over the staged candidate. Reject changes
   outside the declared paths or unsafe filesystem/permission changes.
4. After the native turn is proven ended, compare the original and candidate
   manifests again. Atomically swap directories with `RENAME_SWAP`.
5. Verify the adopted artifact against the original contract, preserving the raw
   staged native artifact and the explicit mapping in the transaction receipt.
6. Roll back only while both roots still have the exact known identities. An
   external edit or ambiguous swap is preserved and held, never overwritten.
7. Core checks the private receipt bytes, hashes, attempt/configuration/envelope
   bindings and full assessment before accepting the result.

A failed candidate with proven local isolation, terminated native execution,
and byte-identical untouched original may be discarded (candidate retained).
Only that exact receipt permits one reference attempt from a clean clone.
A held/uncertain result, missing receipt, changed original, partial checker or
cancelled/unsettled native execution never authorizes automatic replay.

## Claims and measurements

Full operational verification covers only the explicitly declared task domain.
It is not a claim of universal correctness or flagship parity. Native execution,
operational completion and external quality comparison remain distinct fields.
All attempted calls, failed candidates, verification, context, latency and
integration costs belong in resource totals. Observed tokens are not cash cost
or subscription quota savings. Native Ultra may create its own subagents;
parent dispatch counts are not backend-call counts.

Ordinary tasks without a complete verifier/certificate still have no automatic
proof of cheap-route quality. This capability must not be generalized by
silently promoting partial tests or by choosing benchmark winners after scores.


## Explicit shared temporary-directory denial (build414)

A real bounded validation found that the native named profile could permit a
model-created helper in shared `/private/tmp` even when the recorded compatibility
sandbox description excluded slash-tmp. The declared `:minimal` read grant and
workspace/scratch roots were not enough to certify that boundary. That run's
source-isolation result is HOLD; its successful functional checker does not
retroactively make the out-of-scope write acceptable. Raw output and findings are
preserved separately from the repaired implementation.

Every local-quality profile now explicitly requires `:slash_tmp = "deny"`.
The private per-attempt scratch directory remains separately writable. Actual
configuration verification must reject a missing, non-string, read, or write
replacement for that denial. A configuration/turn summary is not a substitute for
a real command-level negative canary.

The bounded no-model canary exercises the exact native named profile: workspace
and own scratch writes succeed, an unrelated owned directory is denied, and a
unique shared temporary-file write is denied. The previous profile is retained
as the positive failure control. No model turn, API key, credential transfer,
global permission change, or provider-billing fallback is needed for this test.

Official profile semantics: https://learn.chatgpt.com/docs/permissions
Official zero-turn command execution: https://learn.chatgpt.com/docs/app-server

This repair does not turn the failed validation into quality-equivalence proof,
expand finite checker coverage, or authorize replay of an ambiguous native call.
