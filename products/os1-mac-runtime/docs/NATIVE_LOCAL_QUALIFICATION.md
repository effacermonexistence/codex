# Exact native local-profile qualification

This is a closed compatibility list, not a model selection rule or permission
for arbitrary signed future native SDKs. The existing launcher must still have
SHA-256 `50ab38ba21d0d9f8346f32f41848382f15b556190f3c7a07e885a4fb73e379c8`.
Only these exact backend/version mappings are recognized:

| Backend SHA-256 | Observed version |
| --- | --- |
| `1afb28c01d7d49e892bd75f11076b10f1451e34e0ee308a95e5ab7f69f9c84fe` | `codex-cli 0.163.0-alpha.10.2` |
| `9394a943e3fce54f998ecc150eb0b7d6e22ce0da48e5063c59b4883e80aeaecd` | `codex-cli 0.163.0-alpha.11.1` |

Unknown or swapped hashes reject before the local-profile discovery app-server
starts. A native version string alone is not an admission key. The original
entry is retained; current records report the version matching their own tuple.

## Actual current-tuple evidence

The owner-scoped zero-model canary result is retained privately at:

`$HOME/.os1/evaluations/routing-lego-20261022-rea-execution/resume-full/CURRENT-NATIVE-CANARY/ACTUAL-002/RESULT.json`

Its exact SHA-256 is
`13370fd0356c33e268224f08cbe05f44a5189c41e0b4146fe74a45de4af52efa`.
Private raw protocol/config observations are not committed. The preceding
`ACTUAL-001` failure is also preserved: the `/usr/bin/python3` shim attempted
an xcrun cache write outside the private scratch and timed out before the
capability program ran. That is interpreter-startup failure, not a passing or
failing filesystem canary. The next attempt changed only the executor to the
same selected Apple SDK's native Python interpreter, not the permission grant.

The four actual current-native `command/exec` cases covered legacy/fixed
profiles crossed with read-only/writer workspace scope. Positive controls
confirmed workspace reads and exact private scratch writes. Writer workspace
writes succeeded; read-only workspace writes were denied. The fixed profile
denied both `/tmp` aliases, an owned unrelated home-directory path write and read, and an
owned loopback TCP connection with an independent host positive control.
Legacy shared-temp writes reproduced the old escape. All four SDK processes
and the owned network listener reached a terminal state. No thread or model
turn was started, and no account/auth RPC was sent. Existing SDK internal
maintenance is outside the model-tool sandbox claim.

## Reproduction boundary

The production `scripts/test-native-local-quality-tmp-boundary.py` remains the
original older-tuple canary. It does **not** accept the new tuple, and must not
be advertised as doing so. Its original strict allowlist is not weakened.

The owner-reviewed private derivative actually used for `ACTUAL-002` is:

`$HOME/.os1/evaluations/routing-lego-20261022-rea-execution/resume-full/CURRENT-NATIVE-CANARY/current_native_zero_turn_canary_v2.py`

Derivative SHA-256:
`0a1d60b17adc9b3b145b19a596519810b66b02cdb9bd33342cfe36e1c4f47bb5`.
It preserves the original source separately and records derivation/input pins.
On this exact machine, after verifying those immutable files and authorizing a
fresh private output directory, its bounded invocation is:

```sh
python3 "$HOME/.os1/evaluations/routing-lego-20261022-rea-execution/resume-full/CURRENT-NATIVE-CANARY/current_native_zero_turn_canary_v2.py" \
  --execute-zero-turn \
  --native-executable /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex \
  --expected-launcher-sha 50ab38ba21d0d9f8346f32f41848382f15b556190f3c7a07e885a4fb73e379c8 \
  --expected-backend-sha 9394a943e3fce54f998ecc150eb0b7d6e22ce0da48e5063c59b4883e80aeaecd \
  --output '<NEW_PRIVATE_ABSOLUTE_DIRECTORY>'
```

No argument launches nothing; its 7 offline tests passed. The parent must
exist, be canonical, owned, and mode 0700; output must not exist. Only
`initialize`, `initialized`, `config/read`, `command/exec` are permitted.
No inference, user message, API key or external network. The owned loopback
listener is a denial test, not an external service. Targeted profile ACK and
full-frame digests are retained, not unrelated private configuration.

The private derivative pins the **actual same selected Apple SDK's native
interpreter** and exact bytes before/after execution, rather than widening the
sandbox for xcrun caches. Its Python path/hash are machine-specific. It is not
bundled or a general permission to execute arbitrary Python. On a different
Mac/SDK, re-resolve and review the approved selected-system-Python contract and
canary source before execution; do not silently substitute an interpreter or
assume the historical receipt is fresh evidence. No production diagnostic
canary rewrite is part of this focused compatibility patch.

## What this does not prove

Standalone `command/exec` is not an LLM tool-call test, model access proof,
semantic quality comparison, quota saving, or complete MCP/plugin attestation.
`rcc-native-local-preflight --request-file <EXACT_BOUND_EXECUTION_TICKET.json>`
still needs the original registered owner local-effects boundary and checks
actual config/hooks/trust/plugin/thread metadata. `metadataOnly: true` sends no
model turn. A real execution still rechecks those gates and the running native
process identity. The original request, original/final source fingerprints,
exact selected configuration and owner contract remain independently bound.
