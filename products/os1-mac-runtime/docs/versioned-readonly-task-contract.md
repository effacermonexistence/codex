# Versioned owner-published read-only task contracts

Status: source implementation and synthetic regression specification. This
document is **not** a live registration, model execution, quality-parity result,
or authority to change an existing task. No version is selected from the
environment, a model answer, a filename supplied by an adapter, or a score.

## Scope

`TaskQualityContractSource.acquire` is the single acquisition helper used by
`PreparedTaskQuality.prepare` and `RCCOperationalQuality`'s original
local-effects boundary. With **no current pointer**, the existing legacy file
lookup, legacy custody rules, missing-contract fallback, and validity behavior
are unchanged. A present malformed, missing-target, or untrusted pointer fails
closed; it must never fall back to the expired legacy envelope.

The optional successor path is deliberately restricted to both predecessor
and successor having:

- declared trusted, schema 1, **full coverage**, `read_only` scope;
- `localEffectsOnly = true`;
- no reference result or reference profiles, no owner collection;
- no public partial-regression snapshot or staged-writer base.

There is no writer admission, reference/parity promotion, model override, task
start, retry, lease acquisition, or publication performed by this helper.

## Registry layout and typed pointer

All paths are derived from the exact original objective SHA-256:

```text
task-quality/                                      owner / 0700
  contracts/                                      owner / 0700
    <objectiveSHA256>.json                         immutable legacy predecessor
    versions/                                     owner / 0700
      <objectiveSHA256>/                          owner / 0700
        <envelopeSHA256>.json                     immutable successor / 0600
    current/                                      owner / 0700
      <objectiveSHA256>.json                      explicit owner pointer / 0600
```

The current pointer is a JSON object containing **exactly** these fields:

```json
{
  "schema": 1,
  "objective_sha256": "<64 lowercase hexadecimal characters>",
  "envelope_sha256": "<SHA-256 of the exact successor bytes>",
  "predecessor_envelope_sha256": "<SHA-256 of the exact legacy bytes>"
}
```

The process owner's UID is required; “owner” does not mean an arbitrary
account or an inferred agent identity. The pointer, legacy predecessor and
successor must be canonical private regular files, mode 0600, single-linked,
owned by the process UID. The root and named registry directories must be
canonical owned 0700 directories. Symlinks, extra pointer fields, duplicate
JSON keys, malformed hashes, relative/caller-provided paths, and predecessor
chains are rejected. The sole predecessor is the unchanged legacy file.

The pointer read is bounded to 4,096 bytes; envelopes to 128,000 bytes. Both
the initial stat **and the actual read** are bounded. `O_NOFOLLOW` plus
before/open/after/named identity checks protect every selected file. The
pointer, both envelopes, and directory identities are re-observed before
return. Mutating or replacing a pointer, including replacement with identical
bytes under a new inode, invalidates the acquisition.

## What may change

The successor must preserve the complete predecessor JSON object, including
all envelope fields, checker identity, source/context/tree/policy bindings,
required check IDs and their ordering, scope, coverage, profiles, conditions,
and optional/unknown field presence. Only `contract.issuedAt` and
`contract.validUntil` may differ. Whole-object sorted JSON comparison occurs
after removing only those two keys; a subset comparison is not sufficient.

Both original dates must be finite and ordered. The new dates must be finite,
the new issue time must be at or after the old expiration, the new expiration
must be after the new issue time, and the successor must currently be valid.
No timestamp in the legacy object is overwritten or interpreted as a new
historical observation. The new envelope has its own new hash and provenance.

Root/owner publication is a separate explicit operation: preserve the original
legacy bytes; create the separately hashed successor with exclusive creation;
verify its exact bytes/semantics/custody; then atomically publish the private
typed pointer with a registration receipt. This implementation does not
publish a pointer or manufacture that authorization. Versions remain retained
immutable objects; a pointer update is an explicit new state mutation.

## New admission, not renewal of an issued task

The pointer resolves an envelope by objective, not by task ID. It cannot infer
whether a caller already issued a ticket. Therefore publication is suitable
only when the owner separately authorizes a **new, unissued** task and obtains
fresh admission/catalog metadata before dispatch.

The original local-effects boundary hashes `acquired.bytes`: the **selected
successor's exact raw bytes**, not a reconstructed encoding or the old
predecessor. Existing `enforceRequiredExecutionIsolation` still requires this
hash to equal the ticket's `executionIsolationSHA256`. A ticket issued under
the old envelope hash consequently rejects the new boundary. The publication
does not renew, replay, mutate, or authorize that old ticket. Stored historical
witnesses and the earlier failure/hold remain separate original evidence.

Existing context, source, workspace/tree, policy and checker checks still run
in `prepare` and the local-effects boundary. No pointer grants correctness or
reference quality. A valid envelope is necessary admission evidence, not an
executed result.

## Verification

Run the model-free source-extracted component fixture:

```sh
python3 products/os1-mac-runtime/scripts/test-versioned-readonly-contract.py
```

It compiles the actual acquisition helper, actual Envelope and evidence
definitions, actual duplicate-key scanner, and actual execution-isolation
guard. Synthetic files are created only in a fresh private temporary root.
The test checks legacy behavior, valid successor selection, exact selected
hash, old issued-ticket rejection, predecessor/hash/objective/date drift,
checker/context/source/tree/policy/check-ID drift, excluded scopes and
reference/owner-collection authority, paths, permissions, links, malformed
pointers and oversized objects. A separately labeled fault-injected build
places mutation callbacks immediately before the unchanged production read
and re-read checks, testing pointer inode replacement, envelope mutation,
directory change and concurrent growth beyond the read limit.

The fixture does not inspect or register the live registry, invoke SDK/RPC/
models, read evaluation answers or grades, change budgets, or install/restart
the app. Full Swift 6 host typechecking and independent review remain separate
gates; fixture success is not production quality parity.
