# Retained owner-collection control recovery

Status: implemented source + synthetic fake-backend tests only. Runtime integration,
installation, actual retained adoption and external quality comparison are separate
Root gates. This is not a new dispatch authorization or a parity certificate.

## Why

A finished source-bound owner child may have a successful native execution record
and FULL operational output checker, but its native-control observation may have
failed. Core preserves that child's exact output/receipt/usage and holds the task.
Re-running an adapter would waste another model call and could repeat work. A
`held -> queued/running` edit is not verification recovery.

The operator-only gateway `os1.rcc.recoverOwnerControl` runs proof on those SAME
retained attempts. It does not call the scheduler, catalog, intent resolver,
executor, continuation, model-generation gate, repair, escalation or `_settleTask`.

## Exact gateway input

```json
{
  "schema": 1,
  "recovery_id": "unique-operator-recovery-id",
  "task_id": "existing-task-id",
  "request_sha256": "<original request SHA-256>",
  "expected_revision": 14,
  "expected_fingerprint": "<original immutable task fingerprint>",
  "expected_snapshot_sha256": "<SHA-256 of exact stored snapshot bytes>",
  "historical_runtime": {
    "app_path": "/private/frozen/OS-1 CLODEX.app",
    "bundle_inventory_receipt": "/private/frozen/bundle-inventory.json",
    "bundle_inventory_receipt_sha256": "<SHA-256>",
    "install_receipt": "/private/recovery/install-receipt.json",
    "install_receipt_sha256": "<SHA-256>",
    "cli_sha256": "<original executor CLI SHA-256>"
  },
  "children": [
    {
      "id": "owner_0",
      "attempt_id": "<original attempt ID>",
      "native_receipt": "/private/own-state/native-receipts/<UUID>.json",
      "native_receipt_sha256": "<SHA-256>",
      "witness_sha256": "<original private witness SHA-256>"
    }
  ]
}
```

The illustrated children list must actually contain ALL 2–8 original obligations
in exact `owner_0 ... owner_N` order. Unknown/additional fields reject. The current
native retained host is responsible for historical archive/signature/install
custody; the archive is evidence of the old executor, NOT a new executable or
permission source. Core passes these bindings unchanged only to proof operations;
it never mutates the original task/ticket to introduce them.

Response is the existing public task snapshot. A successful exact repeat of the
same `recovery_id` and request digest returns the already-adopted snapshot with
no second proof/model/usage event. Conflicting IDs or stale bindings reject.

## Native host seam

The only new host callback is:

```
rcc-owner-control-retained --request-file <private input>
{
  task: ORIGINAL_ADMITTED_TASK,
  child_id,
  expected_native_receipt,
  expected_native_receipt_sha256,
  expected_witness_sha256,
  historical_runtime
}
-> {schema: 1, record: ORIGINAL_CANONICAL_EXECUTION_RECORD,
    control: EXISTING_TYPED_NATIVE_CONTROL_REPLY}
```

The Swift host must load the original stored witness ticket, not construct a new
execution ticket. It must validate current account, owner policy, source/tree,
FULL child/parent contract/checker, original receipt/witness/configured input,
old-runtime archive, and current non-CLI native/hook/notify identity. This JS
commit does not weaken global native-profile checks or implement that Swift seam.

Only reviewed `codex_owned_turn_rollout_v1` and
`codex_owned_turn_rollout_9394_v1` observations are accepted. The normal child gate
and recovery share this closed list; unknown future tags do not imply support.
Turn, output hash, task/node/attempt/request, completed and zero-tool checks remain
mandatory. A sourceKind label alone does not establish control.

After child controls pass, the existing `rcc-task-verify` receives the original
plan and an internal completed-child projection, plus `historical_runtime` only
for this recovery. Normal parent calls retain their original three-key shape.
The native parent verifier must recheck current account/policy/profile/source and
receipt/witness identities after its deterministic external checker returns.

## State and adoption

- Exactly `held / owner_collection_control_unverified`, no cancellation,
  previous result, installation handoff or later attempt.
- Exact original fingerprint, snapshot SHA/revision, request and current
  owner-collection authority. Contracts must still be valid; recovery does not
  extend or invent authority.
- Finished read-only native attempts only: succeeded/dispatched/ended/no effects,
  FULL local-only operational witnesses, same original configuration/receipt,
  no active own controller/worker, lease/pool claim or pending settlement.
- Original native record, raw child output and summary, usage and attempt history
  must match retained state and expected private file digests.
- No durable child completion is published before every control AND the existing
  full parent checker pass. The existing native collector's canonical JSON key
  order is allowed only when ordered values exactly match retained children.
- Final source/private-file rereads and owner transaction compare-and-swap reject
  stale revision/fingerprint/snapshot/cancel/stop/quiesce changes.
- A single adoption event records prior HOLD identity, proof digests and parent
  verdict; original HOLD events, native receipts, attempts and usage stay intact.
  `parity_state` stays `unverified`. No second routing-ledger attempt is appended.
- Cancellation while proof is pending cancels the recovery without inventing
  effects uncertainty. Cancellation after completion cannot downgrade the result.
  Close/quiesce abort pending proof; restart does not schedule held tasks.

JSON numeric comparison is intentionally bounded: only exact safe-integer numeric
LEXEMES are supported during recovery. Fractions, exponents, nonfinite or unsafe
integers stay HOLD; Node's reviver source lexeme must be available. This avoids
rounding `9007199254740993` into `9007199254740992`, or `0.99999999999999999` into 1.
Strings/bools/null remain unchanged. No raw output is rewritten to fit this gate.
An independently justified lossless codec is needed before expanding that numeric
boundary; no general JSON-number equivalence is claimed.

Any unknown control, tool request, custody/authority drift, checker failure or
concurrent mutation leaves the task held without new work or fallback. Native
partial proof receipts may exist, but are not Core adoption. Their exact-match
idempotency is separately enforced by the host. Phase HOLD/budget reconciliation
and final-lock external scoring remain separate explicit Root decisions.

## Synthetic validation

Run with the pinned Node runtime (no SDK/provider/model):

```
node --test scripts/fixtures/openclaw-rcc-retained-control.test.mjs \
  scripts/fixtures/openclaw-rcc-owner-collection.test.mjs
```

Fixtures use temporary synthetic contracts, fake native records and deterministic
callbacks. They test SAME-task adoption, repeated/concurrent requests, partial
control failure, cancellation during proof and after adoption, stale hashes,
account/policy/source/checker refusal, source mutation, forbidden execution
callbacks, restart, full parent rejection, exact parser kinds and numeric
rounding counterexamples. Passing these is source regression evidence, not actual
retained recovery, public proof or model quality parity.

The release build must explicitly include the new retained-control fixture and
regenerate its existing resource pins in the Root integration worktree; this
isolated change deliberately does not edit version/build/install/pin constants.
