# OS1 Claude full-access handoff

## Objective

When OS1 assigns an authorized mutating task to the local Claude Code backend,
Claude must execute without returning permission prompts to the OS1 user.
Read-only tasks must remain read-only. The change must not copy credentials,
weaken provider-side safeguards, or grant authority beyond the OS1 execution
ticket.

## Evidence and failure boundary

The installed Claude Code user setting already selects
`permissions.defaultMode = "bypassPermissions"`, and Claude Desktop already
enables the bypass-permissions option. OS1 nevertheless appends
`--permission-mode auto` to every `workspace_write` invocation. Command-line
arguments have higher precedence than user settings, so this explicit argument
re-enables the Auto classifier and its permission interruptions. Claude
Desktop also persists `auto` as the per-folder mode, independently of the CLI
default.

## Five-view audit

| View | Divergence | Convergence check |
| --- | --- | --- |
| Intent/completion | Authorized writes can stop at an Auto permission request | OS1 `workspace_write` maps to `bypassPermissions` |
| Context/provenance | Per-folder Desktop mode overrides the user default | Owner folders persist `bypassPermissions` |
| Runtime/capability | Strict sandbox forbids necessary out-of-sandbox commands | Sandbox escape hatch is enabled; bypass mode answers it without a prompt |
| Output/verification | A permission denial can be rendered as an incomplete result | Harmless write-and-command probe exits successfully without a permission request |
| Cost/latency | Auto denials cause retries and extra model calls | The probe completes in one provider turn |
| Security/UX | Blanket access could leak into read-only tasks | `read_only` keeps `dontAsk`, the tool allowlist, and MCP denial unchanged |

## Minimal architecture

```text
OS1 signed ticket
  read_only       -> dontAsk + bounded read/web tools
  workspace_write -> bypassPermissions + existing task contract
                          |
                          +-> Claude hooks/provider safeguards still run
```

The OS1 permission profile remains the authority boundary. `auto` is not
redefined: Anthropic defines it as classifier-reviewed execution. Full local
access is represented by the separate supported `bypassPermissions` mode.

## Patch, rollback, and acceptance

Patch only the Claude argument mapping, its deterministic self-test, the
owner-machine bootstrap settings and merge verifier, and local owner
preferences. Rollback is the previous build96 package plus the pre-change
settings backups.

Acceptance requires: runtime self-tests; both architecture builds; signed
installed build readback; unchanged read-only argument fixture; a one-turn
Claude write/command probe with no permission request; and preservation of OS1
conversation state.
