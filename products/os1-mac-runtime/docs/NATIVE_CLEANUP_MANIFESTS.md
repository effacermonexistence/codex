# Exact native cleanup manifests

This is a closed compatibility update, not a tool permission grant or a rule
to trust arbitrary future plugin versions. The existing exact 26.1013.40934
manifest hashes remain accepted. Only these reviewed 26.1016.61520 hashes are
added under their existing plugin names:

| Name | New manifest SHA-256 |
| --- | --- |
| browser | `dc57e56fe6d9377479e2cfc8e3898908682a543ffb323b04fd1622a355f4005a` |
| chrome | `249fd81494e73350cfbc30b788c63c43e47076387e3ed56f6d3c21e792ae241e` |
| unified-computer-use | `4de0b181599745fdf004bb38a7804fb60f0a631937c03ccd9bce03f3eb31851a` |

## Observed provenance

The actual enabled native `plugin/installed` and `plugin/read` metadata was
inspected without an account/auth RPC, thread, user turn or model call. The
three cache manifests were byte-identical to the files in the installed
OpenAI application at:

`/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/<name>/.codex-plugin/plugin.json`

`codesign --verify --strict /Applications/ChatGPT.app` exited 0. The observed
signature identified OpenAI OpCo, LLC, team `2DC432GLL2`.

Each manifest contains exactly Stop, Interrupt and SubagentStop cleanup hooks.
Each is one fixed `mcp_tool` call to `turn_ended`, using only the event, session
and turn template values. The browser/chrome cleanup server is `node_repl`;
unified-computer-use uses `cua_repl`. There is no command hook in these manifests.
Replacing only the version bytes with `26.1013.40934` reproduces all three old
already-pinned SHA-256 values. That is a hash-verified reconstruction, not a
claim that an old provider execution was rerun.

Private source audit (not shipped as public execution proof):

`$HOME/.os1/evaluations/routing-lego-20261022-resume-full/control/MCP-IMPLICIT-AUDIT/PRODUCTION-ADAPTER-AUDIT.json`

Audit SHA-256:
`f2a8b4581ceaf1cadc244ae91955adb1b41b3ff010741f5459b04472e7f090ef`.

## Unchanged boundaries

The existing per-process plugin MCP disable, native hook/trust checks, source
file custody, exact native SDK qualification, filesystem/network isolation,
thread-scoped all-MCP-disabled verification and actual turn control checks all
remain required. The audit's no-thread MCP observation had null runtime status;
it is not thread-level disable evidence and must not relax that verification.

Deterministic fixtures cover both byte-exact generations and their fixed hook
structure, as well as malformed, future, modified, swapped-name and unsupported
hook cases. They are synthetic compatibility tests, not native model execution,
semantic quality, P7 promotion, parity or quota-saving evidence.
