# OS-1 local OpenClaw agent-controller seam (not yet activated)

Status: source-only, disabled by default. No installed/live/recovery claim. The
existing `LocalRouterBridge` still calls `infer model run`, which has no agent
loop or tools. Do not treat this branch as a finished product.

## Exact host call path

1. The OS-1 host resolves the current trusted RCC/REVAS source, records its
   SHA-256, derives a task-relevant bounded policy projection, and freezes the
   current request, session, eligible host candidate IDs, authority, workspace,
   and stage. The projection is **not** a claim that the entire source was
   injected into an 8k-context local model. The host keeps full authority.
2. Verify the installed Node, OpenClaw 2026.9.9, `os1-bridge` plugin, and
   Ollama `qwen3.5:4b` exact digest against packaged/recovery manifests. A
   source checkout or package presence alone cannot enable execution.
3. Call `OpenClawAgentController.prepare(enabled:runID:sessionID:request:
   policySourceSHA256:policy:state:pluginDirectory:workspace:)`. `enabled`
   defaults to `false`. It returns immutable `contractBytes`, `configBytes`,
   and `contractSHA256`.
4. Under `~/.os1/openclaw-controller/<runID>/` (0700), atomically write
   `contract.json`, `config.json`, and `request.txt` (0600). A retry requires
   a new run ID. Keep the original OS-1 session/queue as source of truth.
5. Call `OpenClawAgentController.command(prepared:privateHome:nodePath:
   entryPath:configPath:contractPath:messagePath:workspace:)`, and execute
   the returned `/usr/bin/env -i ... node openclaw.mjs agent exec ... --json`
   command under the existing OS-1 timeout/cancellation owner. Do not use
   the plain `openclaw agent` Gateway or the old `infer model run` for this
   agentic path. The user request is in `--message-file`, not argv.
6. Before enabling any model call, offline-inspect the exact generated config
   using pinned `openclaw plugins inspect os1-bridge --runtime --json`: status
   `loaded`, exactly `os1_state_read`, hooks `before_prompt_build`,
   `before_agent_run`, `before_tool_call`, and no diagnostics. Merely seeing
   `loaded` is insufficient: without `hooks.allowConversationAccess=true`,
   OpenClaw blocks both policy hooks while leaving the tool loaded.
7. `before_prompt_build` appends the exact projection in the OpenClaw system
   prompt. Since that modifier fails open on error, `before_agent_run` checks
   the exact request/policy binding and writes `gate-receipt.json` before the
   model call, or blocks. The only model-visible tool returns a bounded OS-1
   state snapshot. It cannot execute a backend or modify any file.
8. On terminal exit read the gate receipt and bounded JSON envelope, then call
   `OpenClawAgentController.propose(prepared:gateReceipt:envelope:exitCode:)`.
   This rejects wrong provider/model, missing gate, bad tool trace, timeout,
   empty final, or nonzero exit. Its result is an **unverified candidate**.
   Apply the existing exact downstream intent/plan/surface admission gate and
   OS-1 host-signed ticket. Native Codex/Claude attempts retain their own
   pre-dispatch governance instructions and post-return REVAS check.
9. On any failure, preserve the last valid route/fallback without importing
   the local candidate. Never create an API route, change account permissions,
   invoke the other provider's CLI from OpenClaw, or call Handy.

## Deliberate boundary

This plugin has **no `os1_work_submit` tool**. The secure host IPC, exact
run/attempt lease, idempotency, signed route ticket, and workspace write scope
must be implemented in OS-1 first. Do not enable OpenClaw's generic `exec`,
filesystem, browser, node, Gateway, or MCP tools as a shortcut. The local
model's Ollama metadata advertises `tools`, but actual `qwen3.5:4b` tool-call
reliability and output quality have **not** been measured by these offline
checks. Use one bounded local tool-call smoke and a small matched quality
comparison before making this path default. No self-reported model quality is
reference parity.

## Offline proof executed in this branch

- `node --test Resources/openclaw-os1-bridge/bridge.test.mjs`: three tests pass.
- `swift build --product OS1ContextTests` and
  `.build/debug/OS1ContextTests --openclaw-agent-controller-only`:
  24 deterministic checks pass (no provider call).
- Pinned OpenClaw `config validate --json` with the Swift-generated config:
  `valid=true`, zero warnings.
- Pinned OpenClaw `plugins inspect --runtime` with that exact config:
  one tool, all three hooks, no diagnostics.

These checks prove the seam/contract, **not** source→package→installed→live→
recovery convergence or task-quality equivalence.
