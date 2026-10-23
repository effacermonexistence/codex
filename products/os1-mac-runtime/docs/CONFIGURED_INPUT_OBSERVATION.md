# Current native configured-input observation

This is mechanical observation in the existing ONE-Core/native-adapter path,
not a new scheduler, route policy, tokenizer, quality certificate or P7 producer.
It does not enable cheaper routing or activate the unmerged dynamic witness.

## Executed source path

1. The selected native adapter reads its provider's typed current inventory.
   It hashes that exact typed inventory and records the observation time before
   authorization. This is **not** the full Core candidate catalog, raw provider
   transport JSON, an entitlement proof or a quota measurement.
2. The adapter constructs the actual `RCCDelegatedEnvelope.prompt`, then the
   actual `providerPrompt` with bound source/history. These exact string values
   enter the ordinary `execute` call, unchanged.
3. Immediately before its owned Codex writer's model turn, `execute` supplies
   the actual developer channel and OS-1's base projection where its delivery
   was mechanically checked, plus the final app-server override array. A foreign
   Desktop-owned writer is not captured. For Claude it supplies the exact final
   `--append-system-prompt` value and final argument array, after normal argument
   additions and before process launch. OS-1 does not claim to see Claude's base
   system instructions, provider defaults, context files or hidden state.
4. `RCCNativeConfiguredInput` uses the OS loader's current process path and a
   bounded descriptor read of that executable and the selected native launch
   artifact (which may itself be a wrapper; the downstream loaded image is not
   observed).
   It emits only byte counts/digests, identities and preparation timestamps in
   the existing private `ExecutionRecord.configured_input_observation`.
   It does not retain new copies of prompt bodies, account secrets or arguments.
5. The actual Core validates the optional metadata's task/node/attempt/request,
   original/effective source, selected tuple, channel and non-authority status.
   The existing exact private-receipt `routing-outcome-capture` carries it into
   the same Core's durable attempt capture when adaptive observation is enabled.
   With that feature OFF the original private native receipt still preserves
   it; this patch does not turn an OFF observation policy ON. Existing public
   task snapshots and chat output are unchanged.

Optional preparation/capture failures cannot create another attempt, select a
model, grant scope or manufacture successful quality. Old records omit the new
field, keeping their canonical identity unchanged. A failed native attempt can
still retain its prepared input metadata; preparation does not prove dispatch.

## Exact coverage and unknowns

`delegated_input`, `provider_input`, `instructions` and optional
`base_instructions` each bind exact configured UTF-8 bytes. Counts are **bytes**,
not model tokens. `execution_configuration_basis` distinguishes Codex overrides
from Claude's final argument array; neither covers arbitrary inherited settings. Image blocks, tool schemas and
subsequent steering messages/native history are not counted by these text-only
preparation components. No complete provider-input count is claimed.
`input_coverage` is always
`os1_explicit_channels_only_provider_hidden_defaults_unobserved`.

These values remain explicit JSON null:

- tokenizer ID;
- input-token count;
- model context-window token count;
- semantic task family;
- full configured-input capacity upper bound.

A native model name, historical cache entry, byte/4 heuristic, successful launch,
usage counter or hash cannot populate those fields. Provider instruction
inclusion, executed-model equivalence, subscription quota savings and quality
remain independently unverified. Catalog/preparation/dispatch/return timestamps
are separate objects. No exact internal classification or causal latency is
inferred from a visible timestamp.

The actual executable hash is its preparation-time read identity, not proof of
which image a provider later loaded. The local read checks size, type, inode,
mtime and ctime while hashing; normal executor authorization, budget, permissions,
model/effort support and cancellation gates remain the same.

## Source repair found by the fixture

The canonical encoder previously interpreted *any* object carrying
`original_source_fingerprint` as `CoreRouting` and injected `model_answer:null`.
A configured-input object legitimately has that source field but is not a
routing resolution. The narrow normalizer now also requires
`resolution_sha256`. Existing CoreRouting encoding retains its same fields;
the new observation no longer gains an unrelated property. The strict record
fixture caught the original unsupported-field failure before adoption.

## Validation and proof boundary

- Real Swift configured-input producer/record roundtrip; unknown/null, wrong
  tuple, channel/time, fresh-ID and raw-text rejection cases.
- Actual preparation helper compiled against this worktree's real Context
  objects; private fake native bytes and current test harness only, no launch.
- Real SQLite Core plus fake executor: exact private receipt capture persists
  the configured metadata and survives restart without replay. No quality,
  learning eligibility, quota or cost is promoted.
- Legacy outcome captures and Core hard-zero/model-budget checks remain active.
- `test-os1-configured-input-wire.py` inspects exact source hook ordering. That
  part is a source-wiring test, not proof a native provider consumed a prompt.

Full native runtime confirmation, installed package identity and actual
strongest-reference comparisons require their own later receipts. This patch
alone is not a general fresh-GUI calibrated selector producer. It cannot fill
missing independent family/capacity/tokenization/native-consumption contracts.

## Research actually inspected

The abstract of Huang et al., *Large Language Models Cannot Self-Correct
Reasoning Yet*, https://arxiv.org/abs/2310.01798, distinguishes intrinsic
self-correction from correction using external feedback and reports failures of
unanchored self-correction. Here the useful mechanism is exact external input
and execution evidence rather than a generated self-explanation. The paper is
not proof of OS-1 efficacy; deterministic checks and actual runtime receipts
remain the adoption evidence.
