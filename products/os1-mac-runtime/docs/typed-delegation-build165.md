# Build165 — typed execution capability, semantic task preserved

## Locked target
Ordinary owner tasks delegated by OS1 must not be silently downgraded to a read-only executor by a heuristic intent classifier. Codex/Claude receive the original task and prohibitions. Their capability envelope is separate from the verification objective. Explicit internal reconciliation remains read-only and must not replay an uncertain operation.

## Failure boundary and minimal repair
A previous local attempt rewrote the routing prompt to force implementation. That granted write access but also selected `executed_change` for an architecture-only stage. The backend correctly returned a plan; verification then rejected it for not changing files. That failed run is retained, not counted as a successful edit.

The repair adds `execution_context.execution_permission_profile` with exactly `read_only | workspace_write`. The authenticated routing service selects the signed executor envelope from this field, but strips it before calling the strict legacy semantic RCC interface. The semantic prompt and verification profile are not rewritten. Missing fields preserve legacy client behavior; invalid values fail validation. Durable execution context and native continuation/recovery paths preserve the field.

All three ordinary workflow stages receive executable workspace capability. Architecture and verification instructions still prohibit inappropriate implementation. Capability does not authorize actions outside the owner's request, remove backend restrictions, or authorize automatic replay. This does not grant unrestricted host permissions or install ordinary Chat subscription executors.

## Scope / rollback
Allowed: runtime delegation, shared request schema, private route adapter, associated tests and local installation. No website, Instagram, messages, old failed job replay, credential transfer or conversation rewriting.
Rollback: revert this commit and rebuild the prior reviewed runtime if required; restore the private/gateway Worker versions recorded by the deployment system. Old clients remain compatible with the new optional field, so rollback is not forced by client/server deployment order.

## Deterministic and deployed checks
- Private TypeScript and gateway TypeScript checks passed.
- Private tests: 15/15; Durable Object workerd integration: 4/4.
- Public gateway tests: 118/118.
- Tests exercise semantic prompt preservation, executed-review verification under write capability, retry preservation, absent-field compatibility and invalid enums.
- Live route-only requests: 3/3 HTTP 200 with expected permissions (ordinary read-only wording -> workspace_write; implementation -> workspace_write; explicit internal reconciliation -> read_only). These checks invoke no model and do not establish task completion.
- Private Worker version: d21babf1-e9f1-4159-ac68-5328d41b31f2.
- Gateway Worker version: b9efc9aa-77de-4acf-a719-e834558c57ac.

## Method / source boundary
Inspected https://arxiv.org/abs/2310.01798 (intrinsic self-correction limitations). The applied mechanism is external feedback: failed actual run -> isolate semantic/capability coupling -> typed correction -> deterministic and installed execution checks. A paper or self-critique is not proof that the patch works.

Private execution receipts and the exact uncommitted source patch are retained under `~/.os1/verification/typed-capability-build165/`. Raw failed runs remain in OS1's execution records. Source commit metadata alone does not identify a build made from a modified working tree.

## Installed execution (2026-09-19 UTC)
- OS1 self-update staged 11 checks PASS and applied build165 / 0.9.99 itself. Installer 9 checks PASS; conversations 95 -> 95, existing messages/pins/drafts/native bindings preserved.
- Running installed app observed at `~/Applications/OS-1 CLODEX.app`.
- App SHA256: f1525d8d98f934159b9f88e29f20328535fc9f2b01ae3ebdedefac1c864deaa0.
- CLI SHA256: 0613eb0b9c031c537b6ab742a16a0118acfb2998a476f4fec7ed0c8bfcde980c.
- Context fixtures: 245 passed; source context/output: 13 regression groups passed.
- Real installed OS1 -> Codex execution created `receipt.txt` with exact bytes `CAPABILITY_OK`: one adopted result, workspace_write ticket, verified native record. Selected gpt-5.6-luna / medium.
- Real installed OS1 -> Codex read-only request retained workspace_write capability but obeyed the instruction: reported `PRESERVE_ME`, sentinel unchanged, no extra files, one adopted result with verified native record. This verifies that capability is not an instruction to modify.
- Claude's existing live attempt hit the account weekly quota. No additional Claude request was spent after that evidence. Its backend path shares the delegation contract, but post-fix Claude provider execution is not claimed.

## Three-stage installed-runtime closure

The installed CLI completed the isolated plan → implement → independent verify task with `3 adopted result(s)` and `OS1_WORKFLOW_VERDICT: PASS`. Each stage received `workspace_write` capability while planning and verification respected their no-edit instructions. The independently checked file contained exactly `WORKFLOW_OK` (11 bytes, no newline). The task authorized only this temporary workspace; no external deployment or messaging was requested. Private execution receipt: `~/.os1/verification/typed-capability-build165/workflow.log`.

Source branch was fast-forwarded onto main `b544f7c` before publication. Installed executable identity is the recorded binary hash, not a claim that uncommitted build inputs were an immutable commit.
