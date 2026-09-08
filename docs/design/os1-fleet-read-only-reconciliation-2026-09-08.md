# OS-1 Fleet read-only reconciliation boundary

## Objective

An OS-1 Fleet diagnostic that explicitly says `Read-only`, forbids replay and
installation, and forbids file or service changes must receive the
`read_only` permission profile. A failed historical job named in the prompt is
evidence to inspect, not an instruction to replay.

## Failure boundary

One Air receipt reported `workspace_write` for an explicit read-only audit.
The same exact prompt resolves to `read_only` in the current main source, so
the observed divergence is bounded to the executing Air installation or its
issued route, rather than the current `ScopeResolution` implementation.

## Five-view audit

- Intent/completion: inspect one existing failure; no mutation requested.
- Context/provenance: the historical job identifier remains quoted context.
- Execution/capability: read tools are sufficient; write authority is invalid.
- Verification/output: the signed receipt must report `read_only`.
- Cost/latency: reject an over-broad ticket before provider execution; do not
  spend a retry to compensate for it.
- Security/UX: preserve real safety boundaries while avoiding irrelevant
  approval prompts.

## Invariants and rollback

The current runtime already checks read-only task authority before provider
dispatch. This change adds the exact incident as a deterministic regression
fixture; it does not broaden permissions or alter production routing. If the
fixture causes an unrelated regression, revert this test-only commit. The Air
installation must be updated through its existing verified, rollback-capable
device path and the exact prompt rerun before that device is considered
converged.

