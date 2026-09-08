# Account-scoped model availability

Objective: OS1 selects only models and efforts reported by the current user's
native Codex/Claude backend, while preserving RCC's quality floor and private
ranking. Installed executables, owner model caches, and executor profiles are
not entitlement evidence.

Observed divergence: Codex used an unscoped models_cache.json with a static
fallback; Claude availability meant only that its executable existed. The R2
v28 adapter enumerated fixed Claude tuples without an account filter.

Architecture: native metadata probe -> intersection with executable profiles ->
request-scoped capability envelope -> private RCC candidate filter -> signed
ticket -> native pre-dispatch check -> existing execution/result manager.
No credential, email, private policy, or generated prompt is included in the
public model inventory. No metadata probe starts a user/model turn. Metadata is
fresh for each execution; no cross-user shared availability cache is introduced.

Five review views:
- Intent/completion: unavailable models cannot satisfy a task; exclude before ranking.
- Context/source: preserve capability envelopes through retries and recovery.
- Execution: query model/list and Claude's initialize control response, not filenames.
- Verification: validate returned signed tuples against the supplied inventory.
- Cost/latency: bounded metadata probes, zero inference tokens; preserve RCC ranking.
- Security/UX: no entitlement grants, auth cache transfers, or background app activation.

Convergence gates: account A/B fixtures differ only in actual inventory; no
Daybreak/Fable when absent; unsupported efforts excluded; empty/unknown inventory
does not become a baked-in default; one available provider works; explicit user
provider choice remains explicit; retries retain constraints; live metadata probe
and installed build self-tests pass. These are eligibility checks, not a proof of
global model optimality or a guarantee that providers never change availability.

Alternatives rejected: API-key model lists (wrong auth surface), a static plan
matrix (drifts), trial inference on every model (waste), copying owner caches
(cross-account leakage). Unknown metadata fails closed or uses the other eligible
provider. Existing pre-update sessions keep their pinned policy for readback.

Rollback: retain v28 immutable policy/source and prior installed signed app;
new fields are optional for old clients, while the updated client requires the
new capability handshake. No migration of conversations or credentials.

Primary sources: https://learn.chatgpt.com/docs/app-server (model/list),
https://code.claude.com/docs/en/model-config (availableModels), and official
@anthropic-ai/claude-agent-sdk 0.3.263 SDKControlInitializeResponse/ModelInfo.

## Verified result

Installed 0.9.43 / build94 with unchanged signing identity; preserved all 58
conversations and their messages, pins, drafts and native bindings. The private
v29 adapter, private routing service, evaluator binding and public capability
endpoint are deployed. Private source and policy were independently read back
from R2 with matching SHA-256; no private engine source entered the app package.

- Native metadata parser: 13 deterministic checks.
- Private account/candidate matrix: 365 checks; no absent model/effort selected.
- Public gateway: 100 tests; private service: 11 tests; Durable Object persistence:
  4 groups, including preservation of model restrictions through recovery.
- Production route-only matrix: 8/8, zero inference calls. Includes no Daybreak,
  no Fable, Codex-only, Claude-only, empty inventory and unsupported effort.
- Installed read-only end-to-end: Codex Luna/low and Claude Fable/low each returned
  the exact requested marker in one adopted, native-record-verified step. Neither
  backend window was opened.

Limits: the live account is one account; restricted-inventory fixtures are not
separate paid accounts. Eligibility uses each native provider's reported list,
not an independent entitlement service or a promise against later revocation.
New models still need a reviewed executor profile; they are not automatically
trusted just because a name appears. Legacy clients lack the new inventory field
and need build94 or later; in-flight legacy execution policies remain pinned.

Two earlier end-to-end probe requests used a different, non-read-only-prefixed
wording and did not complete: the existing task-intent classifier assigned
workspace_write; Codex returned the marker but the mutation verifier retried,
and Sonnet treated context text as an injection. These are retained as separate
intent/context issues, not counted as passes or model-entitlement failures.
Four live inference attempts were made in total, not zero; the eight route-only
checks and metadata/parser tests made zero inference calls. This change does not
claim that all task routing or all models are globally optimal.
