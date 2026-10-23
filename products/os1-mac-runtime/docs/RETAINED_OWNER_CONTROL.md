# Retained owner-collection control reconciliation

This is a proof-only recovery seam, not a held-task resume, a scheduler, a
provider fallback, a refund, or permission to run a historical executable.
Normal task dispatch, native local-profile qualification and source/account
policy checks are unchanged.

## Interfaces

The explicit operator command is:

```
os1 rcc-reconcile-owner-collection --request-file /absolute/private/request.json
```

It accepts the closed `os1.rcc.recoverOwnerControl` operator-write request:
`schema`, `recovery_id`, `task_id`, `request_sha256`, `expected_revision`,
`expected_fingerprint`, `expected_snapshot_sha256`, `children`, and
`historical_runtime`. Each child supplies only `id`, `attempt_id`,
`native_receipt`, `native_receipt_sha256`, `witness_sha256`. The exact stored
snapshot digest/revision/fingerprint and recovery-id CAS belong to the existing
Core. A transport timeout does not resubmit or replay the recovery.
The proof command requires an already-live exact owner and a fresh health
observation. It never calls startup supervision, launches/replaces a Gateway,
or wakes unrelated queued work; explicit owner startup is a separate action.

The bridge invokes `rcc-owner-control-retained --request-file FILE` with exactly
`task`, `child_id`, `expected_native_receipt`, `expected_native_receipt_sha256`,
`expected_witness_sha256`, and `historical_runtime`. It reads the original ticket
from the retained witness; it never creates a replacement ticket. Its response
is `{schema:1, record:<unchanged canonical original record>, control:<existing
control reply>}`. The original output, model/effort, usage and native summary
are not rewritten.

`historical_runtime` has exactly these six fields: `app_path`,
`bundle_inventory_receipt`, `bundle_inventory_receipt_sha256`, `install_receipt`,
`install_receipt_sha256`, `cli_sha256`. Operator-supplied immutable hashes bind
canonical owned archive/installation receipts. The archive inventory is checked
against every actual file (no unlisted files/symlinks), including the old CLI,
App executable and Info.plist. Build/version/source, installer checks and
installation time must match the original C1 harness and profile. Static strict
signature checks must match the current installed owner's designated requirement.
No archive binary is executed. There is no case, trajectory, build or CLI-hash
literal in this mechanism.

Only the exact installed OS-1 CLI locations in the original profile may be
checked against that historical CLI. Every other original native launcher,
backend, notifier, hook or source hash must still match current bytes. This does
not weaken the global verifier used to authorize new execution. A new host
binary is not falsely represented as the old executed host.

## Adoption gates

The host rechecks the original parent/source/policy/account and registered FULL
parent/child contracts/checker bytes; exact owner obligation span, ticket,
configuration, record, witness and output must match. It uses the existing
`verifyChildControl` on the original native record. Existing control-receipt
reobservation is allowed only when byte-identical; a conflict is never replaced.
Private files retain canonical/no-follow/single-link/owner/mode/size/stability
checks. Archived public bundle bytes may be readable but not group/world-writable;
the inventory and installation receipts remain under private owned directories.

Recovery passes optional `historical_runtime` into the existing parent checker
operation. The ordinary three-key parent interface remains valid. The recovery
path re-reads original record/witness and archive/current-native sources after
the external parent checker, then rechecks live account/policy/source/contracts.
The Core publishes completed children/result only after that parent proof and
its final exact snapshot CAS. Until then the original held state remains held.

The native observation is execution/control evidence, not a general quality
parity claim. A FULL operational source checker is not clean gold-blind public
benchmark proof. Display, retained proof, runtime execution, product readiness
and quality/resource comparison remain separate states.

## Validation boundary

`python3 scripts/test-owner-retained-control.py` compiles source-extracted closed
request/receipt/file guards against private synthetic files and checks wiring.
It does not call the SDK/model, an RPC, or an archived application, and does not
reconcile any actual task. Full Swift typecheck/build and an independently
reviewed installed zero-generation reconciliation are separate gates.
