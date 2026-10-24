# Lossless local planner input V4

This is a host-side representation repair, not a new router, permission source,
quality certificate, or change to returned proposal V2.

## Representation

Informed catalog callers now receive `OS1_LOCAL_PLAN_INPUT_V4`, with
`representation_version: lossless-host-refs-v1`.

- `original_request` remains the complete literal original string.
- An objective or requirement text is replaced by
  `{exact_text_ref: "original_request"}` only after exact string equality.
  Different strings remain separate. Literal alias-looking user text is not
  parsed or recursively resolved.
- `{exact_ids_ref: "candidate_metadata"}` refers to every exact candidate ID
  already in the candidate table. There are no arbitrary reference paths.
- `candidate_columns` declares the closed six-column row order: candidate ID,
  profile ID, model, effort, configuration SHA, exact-configuration SHA.
  Profiles retain all provider/surface/account/pool/tools/scope/availability/
  quota/time/cost/performance/unknown facts. No candidate is truncated or hidden.
- The full current catalog, bindings, owner policy text, original task, material
  references and admission rules remain unchanged in the same Core.

`expandLocalPlannerInputV4` is a pure roundtrip checker, not a model-response
parser or admission API. Before invoking the existing completion callback,
the serializer verifies that expansion is identical under `stableJSON` to the
prior V3 logical input. Input bounds apply after serialization. The unchanged
V2 response schema, compiler, current-catalog recheck, scope checks, writer
ownership and once-only scheduler remain authoritative.

IDs-only callers still receive their original V2 input shape. No legacy caller
silently gains informed metadata or permission. The routing kernel version is
incremented because its new instructions describe V4 exactly.

## Bounded timing and consumption

The helper timeout ceiling/default is 120 seconds. Bounded Auto uses that
ceiling; the existing covered-live/shadow factories explicitly retain their
previous 30-second helper bound. Core has a separately reviewed bounded
observer deadline and always intersects it with the original task duration.
Output remains at most 1,536 tokens / 4,096 bytes; callers may lower limits.

Cancellation still awaits actual callback settlement, never treats a timer as
proof of backend quiescence, and never adopts a late proposal. Aborted/error
all-zero usage placeholders are now `null` / `unknown`, not evidence of free
execution. Positive origin-bound usage remains reportable, even on an error.
No automatic retry or budget refund is introduced.

## Source-only checks

Eight related pure suites: **339 passed**. Synthetic tests cover exact aliases,
collision/injection, table/profile/hash fields, missing data, legacy shape,
unchanged V2 output, timeout bounds and unknown consumption after cancellation.

An exact preserved 68-candidate historical input was reconstructed with fake
callbacks only. Every logical input fact, both configuration hashes, original
request and complete 18,554-byte policy survived the reversible representation.
The total helper input changed from 54,370 to 43,186 UTF-8 bytes; the user payload
changed from 30,316 to 18,556 bytes. The 576-byte new representation instructions
are included in those totals. This is byte reduction, not measured tokenizer,
prefill/decode latency, quality equivalence or installed-product success.
