# Informed local-plan candidate view (source-only integration)

This change extends the existing local planner, not the task owner, scheduler,
executor or verifier. It performs no model/provider/native call itself. Pure
fixtures use canned local completions. Source/test success is not activation,
quality parity, learned routing, quota savings, or deployment success.

## Host integration API

Keep the existing proposal output schema **2** and host projection shape.
Pass the actual independently validated, current Core catalog alongside it:

```js
const result = await proposeLocalPlan({
  hostProjection: prepared.hostProjection,
  expectedBinding: prepared.expectedBinding,
  ownerPolicy: task.policy,
  projection: prepared.projection,
  candidateCatalog: catalog, // exact host catalog, not a model-produced view
  attempt: {index: 0, revision_of: null, correction_codes: []},
  signal,
  observeResourceUsage,
});
```

`projectLocalPlannerCandidates({catalog, hostProjection, expectedBinding,
now_ms})` is also exported for a pure host-side inspection/test. It verifies
canonical complete-catalog SHA-256 against `expectedBinding.catalog_sha256`,
exact task/request identity, and exact equality of the candidate-ID set. Hashing
uses the existing `joint-route-selector.mjs::stableJSON`, the same encoding as
`adaptive-plan-host.mjs::createPlannerHostProjection`. Do not hash raw JSON bytes
or repair a mismatched binding by accepting a model's replacement digest.

The complete native catalog is never spread into the model prompt. A strict
whitelist projects each current native row into:

- exact candidate ID, whole-config fingerprint and source configuration hash;
- physical surface, derived provider, transport, model and supported effort;
- machine account ID (not account label, email, auth home, credentials or cache);
- shared quota pool, tools, scope and permission profile;
- original availability/quota timestamps and fraction plus derived
  `current` / `stale` / `future` / `unknown` / `exhausted` states;
- measured total cost and reference performance explicitly **unknown**. A
  non-null catalog `estimated_cost_units` is retained only as an unqualified
  estimate; it is not measured usage, dollars, quota credit, or parity.

Supported physical tuples match this source's actual routes: native Codex,
Claude Code, the gated Claude chat surface, and explicit Local. Dropped GPT
routes cannot be recreated by supplying their old IDs. Every proposed ID still
identifies one complete existing tuple; the model cannot separately invent a
model/effort combination or gain tools/rights through its proposal.

## Versions and legacy behavior

With `candidateCatalog`, the local model receives input schema **3**,
`kind: OS1_LOCAL_PLAN_INPUT_V3`, and compact `candidate_metadata` version
`shared-candidate-profiles-v2`. The inspectable expanded projector uses
`host-candidate-metadata-v2`. `compactLocalPlannerCandidates(expandedView)`
losslessly factors byte-identical common facts into `profiles`; each candidate
row retains exact ID, `profile_id`, model, effort and both configuration hashes.
Different quota times/values, account, scope, tools or quality states never
merge. Profile inheritance is explicit in the local kernel. This is structural
representation compression, not source summarization or tuple truncation. Successful return metadata says
`candidate_view.informed_metadata_supplied: true` and records exact catalog and
projected-view hashes. This proves which DATA was supplied, not that the model
used it correctly.

Omitting the optional parameter deliberately preserves input schema **2**
(`OS1_LOCAL_PLAN_INPUT_V2`) and records `informed_metadata_supplied: false`.
The legacy path must not be described as informed joint selection. Explicit
`null`, malformed objects or counterfeit hashes do not silently fall back to
IDs-only input. The local kernel version is `rcc-local-plan-kernel-v2`.

Root integration must supply the new argument on the actual generation path
and update the existing source/resource pins. This patch does not alter
`adaptive-plan-host`, the runtime/plugin, configuration, source pins, version,
installation, registries, frozen evidence, or existing native dispatch policy.

The reviewed planner ceiling is now 1536 output tokens and 30000ms callback
abort, while the 4096 output-byte bound, max8 nodes and 65536 input-byte cap
remain unchanged. Explicit caller token limits (including512) remain exact and
cannot exceed1536. A maximal-prose compact four-node fixture fits the fixed
byte contract; neither its token fit nor real-model latency is thereby proven.
Core's observer timeout must be aligned by the integrating owner.

A pure full-input probe used the exact immutable Schedule430 task's18554-byte
policy,1825-byte request and46-row catalog with a canned local completion.
The finalizer-aware lossless compact view was14823B; total serialized
system+user+response schema input was48141B, below65536. All46 tuple rows survived in one shared
profile. This establishes full-input construction, not actual local-model
execution, fresh quota, routing quality or provider inclusion. The frozen
snapshot and score artifacts were not changed.

## Boundaries preserved

- Same single Core owns task state, retry/cancel, reservations and final adoption.
- Structural metadata is not a new trust source. Only Core may provide the
  catalog. A self-consistent caller-authored catalog plus hashes does not prove
  quota reality, provider support, account authority or source authenticity.
- Unknown/stale quota is never changed into capacity. Missing time windows do
  not become observations; local has no subscription pool and no native quota.
- An informed returned hint must be an exact row with matching node scope,
  current availability and positive current quota (or genuine Local/no pool),
  with no mismatch state. Null means no tuple hint; it grants nothing.
- After the awaited local callback, the helper rechecks hint freshness against
  the copied original catalog. Core must additionally refresh current facts,
  compare current bindings, independently admit the graph/row, reserve resources,
  enforce path scope and verify actual provider settings before dispatch.
- Source bodies, material locators, private path lists, free-form account labels,
  task-contract bodies, exclusions, credentials and raw histories are not in
  the candidate projection. Narrow token grammars reject instruction-like
  values in model/tool/account fields. Structured DATA never enters the system
  policy channel. No helper claims prompt-injection immunity.
- Input bounds reject oversized complete-catalog/projection data instead of
  truncating IDs or original objective/material coverage. No secret-dependent
  fallback or hidden higher input/token limit is introduced.
- One-attempt/revision/cancellation/resource-event rules are unchanged. There
  is no automatic retry and no model is invoked by metadata projection.

## Pure regression scope

`node --test scripts/fixtures/openclaw-rcc-local-plan-{planner,metadata,proposal}.test.mjs`

Tests cover the exact current `RCCNativeCatalogBuilder` row shape using
explicitly synthetic values; both native providers, gated chat, Local;
null/unknown/stale/future/zero quota; forged/mismatched hashes; missing and extra
fields; candidate-set changes; unsupported tuple/scope; prompt data leakage;
getters/prototypes/sparse arrays; byte/node budgets; mutation across await;
expiry during callback; and unchanged strict output compilation. They do not
open an actual model, task store, account, native CLI, gateway or grader.

Before selecting this implementation approach, the BEST-Route abstract was
read at <https://arxiv.org/abs/2506.22716>. Its joint model/compute/quality framing
supports exposing the actual candidate choices rather than opaque IDs. Its
reported experimental savings do not establish this implementation's efficacy;
this patch neither imports its numbers nor invents a calibrated forecast.

## Host-owned writer finalizer (optional proposal extension)

The schema2 `final_output_proposal` still requires only `mode` and `node_ids`.
It additionally permits optional `host_finalizer_candidate_id: string | null`.
Old proposals without it are unchanged. The pure compiler returns a separate
`host_finalizer_preference: {proposed_candidate_id}` only when the optional
field exists. It must name an exact ID in the bound host candidate set, but
this pure compiler does **not** establish writer authority or current support.
It creates no model-owned writer node, bound candidate_id, path grant or ticket.

Only informed input whose exact hashed host catalog has
`owner_scope: workspace_write` enables `host_finalizer` planning context:

```json
{
  "kind": "host_original_request_writer_v1",
  "finalizer_count": 1,
  "original_request_sha256": "<original bound request SHA>",
  "preparation_scope": "read_only",
  "max_preparation_nodes": 3,
  "model_writer_nodes_allowed": false
}
```

The effective preparation limit is min(3, caller max_nodes); response schema,
visible input budget and returned proposal budget agree. The model proposes
only read-only preparation. Core adds one original-request writer and passes
it the required preparation results; the model cannot paraphrase that writer
or borrow the prep nodes' read-only IDs as write authority.

A non-null finalizer hint must reference a distinct supported writer tuple in
the exact supplied catalog: workspace_write scope/permission, write+execute
capabilities, current availability, positive current quota and no quality
mismatch. Stale, future, unknown, missing-catalog or read-only owner inputs
reject a non-null writer hint. Null or omission leaves Core's existing choice;
it must not be described as a model-selected writer tuple. The helper checks
original observation freshness again after await, without backdating times.

Root must separately validate `compiled.host_finalizer_preference` against
CURRENT host scope, catalog, original binding, explicit owner constraints,
source/paths, budget and reservation gates before applying it. A copied or
independently compiled proposal is still untrusted DATA, not a capability.
This planner change does not enable the Core writer policy itself.

Regressions cover optional-field absence/null/invalid types, unknown ID,
read-only ID instead of writer, stale/future/unknown quota, invalid owner scope,
legacy IDs-only mode, Local/chat writer rejection, non-write-capable row,
3-prep/4-prep distinction, unchanged original intent and no bound writer node.
A full-size synthetic18554Bpolicy+1825Brequest+46read/46write tuple input
retains all92 rows in two profiles and fits65536 bytes with three canned prep
nodes and one separate writer hint. This is an input/contract test only, not
actual model execution, token fit, live writer behavior or parity proof.
