# Final-output generation cardinality

The existing strict proposal V2 decoder already requires one final node for
`direct_child` and `integration_node`. An actual local proposal instead emitted
`direct_child` with two final IDs; Core correctly rejected it and preserved the
original host route. That failed source is retained, not normalized or adopted.

The generation-only response schema now uses three disjoint `anyOf` object
branches with a constant mode:

- `direct_child`: exactly one node ID;
- `integration_node`: exactly one node ID;
- `ordered_collection`: one through eight unique node IDs.

Each branch still requires `mode` and `node_ids`, forbids additional properties,
and permits the same optional untrusted `host_finalizer_candidate_id`. The
public routing kernel now explicitly describes the cardinality and is versioned
`rcc-local-plan-kernel-v4`.

This does not replace or relax P1. The decoder still independently checks known
IDs, complete dependency coverage, independent collection membership and exact
host order. Those graph constraints are not claimed to be fully expressed by
JSON schema. No reply repair, automatic retry, new authority, or task replay is
introduced. Returned proposal version, resource limits, policy/source bindings,
model/effort selection and host writer gates are unchanged.

Pure regressions cover the failed structural shape, all three valid modes,
empty/oversized/duplicate/unknown fields, optional finalizer parity, unchanged
P1 rejection, and exact conditional schema forwarding to the existing tools-free
completion callback. Installed OpenClaw/Ollama source forwarding and converter
support require separate source inspection without making a new model call. Schema source
and synthetic success do not prove that a new live generation will be valid.

## Already admitted host fields in generation schema

Each request gets a detached frozen schema derived only after host projection
validation. Read-only tasks and host-writer preparation get constant read-only
scope and zero path hints. Requirement/material/check references use the exact
host ID enums; an empty material/check set permits only an empty array. A
legitimate legacy write host retains its allowed read/write scope and only its
exact admitted path hints. This is not a claim that all writers are read-only.

The exact per-request schema, including its enums, is included in the existing
input-byte bound and passed intact to the same completion callback. The strict
P1 compiler still rejects unsupported replies if a provider ignores generation
constraints. No failed actual writer reply is normalized or re-adopted.
