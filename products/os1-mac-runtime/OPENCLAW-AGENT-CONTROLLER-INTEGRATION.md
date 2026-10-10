# OS-1 / OpenClaw typed local controller seam

**State: source-only, disabled by default.** A disposable Gateway local-only
smoke passed its pre-model gate, but OS-1 host dispatch and package/install/
recovery identity remain unwired. No flagship-quality claim. Do not enable from source checkout alone. Handy is a
separate trust domain and is never part of this path.

## Executed failure: `agent exec` is not a governed route

Two bounded, local-only tests on 2026-10-10 used pinned OpenClaw 2026.9.9,
local Ollama `qwen3.5:4b` with the expected digest, the generated config, and
only `os1_state_read`. Both returned a candidate with exactly one allowed tool
call (18s / 8s), but **neither created the `before_agent_run` gate receipt**.
Their private evidence is retained under:

- `~/.os1/openclaw-controller/smoke-20261010T080359Z-4b766092/`
- `~/.os1/openclaw-controller/smoke2-20261010T080712Z-5ba07d06/`

`OpenClawAgentController.command(...)` now rejects `agent exec` unconditionally.
The result of either smoke cannot be adopted as RCC-governed execution. The
model also fenced its JSON in Markdown, which would require the existing closed
answer-shape verifier to reject or normalize by a registered rule.

Pinned source trace explains the failure: `loader-DpAS3szV.mjs`'s
`loadPluginRegistryHandle` forces `activate:false`; the one-shot local command
uses a scoped registry (`runtime-plugins-BLHoCGWb.mjs`) that can expose plugin
tools, but it does not initialize the global hook runner.
`hook-runner-global-CFWs616h.mjs::getGlobalHookRunner()` remains null, so the
embedded prompt path cannot call `before_agent_run`. Adding manifest activation
hints did not alter this runtime result. `plugins inspect --runtime` describes
registrations; it is not proof that the agent loop invoked the hooks.

## Candidate supported path: disposable authenticated loopback Gateway

Gateway startup (`server-start-Bz-KV48j.mjs`) activates the registry, which
calls `initializeGlobalHookRunner`. Build **one Gateway per OS-1 run** until a
safe host run-ID IPC exists; its process env and contract remain specific to
that run. No OpenClaw service install, default/global Gateway takeover, port
force-kill, ambient login, hosted model, browser, shell or filesystem tool.

1. OS-1 locks the current request/target/authority, installed component hashes,
   owner policy source SHA, bounded task-relevant RCC/REVAS projection, allowed
   candidate IDs, and workspace. A projection is not the full v26 source and
   cannot be presented as such. Full authority stays in OS-1's signed host
   policy and native pre/post execution gates.
2. Verify the **installed** Node/OpenClaw/plugin bytes and exact local Ollama
   model digest. Source presence is not installation proof. Create a fresh
   `~/.os1/openclaw-controller/<runID>/` at mode 0700. Use
   `OpenClawAgentController.prepare(enabled:runID:sessionID:request:
   policySourceSHA256:policy:state:pluginDirectory:workspace:)` to obtain
   exact contract/config/request bytes and fingerprints. `enabled` defaults to
   `false` and must only be set after real installed-resource preflight.
3. `prepareGateway(turn:port:)` adds a **fresh random 256-bit token** and a
   random high loopback port (a test may pass a fixed port). It disables
   Control UI, uploads, CLI-agent picker, terminal and Tailscale. Write its
   config, the contract and `request.txt` under the run directory as private
   0600 regular files. Never log/print the token or include it in argv/env.
4. `gatewayCommands(prepared:privateHome:nodePath:entryPath:configPath:
   contractPath:messagePath:workspace:)` returns two exact child commands:
   `openclaw gateway run --bind loopback --auth token --port <selected>` and
   Gateway-backed `openclaw agent --agent main --session-key
   agent:main:<runID> --message-file <request.txt> --model
   ollama/qwen3.5:4b --thinking off --json --timeout 45`. **Do not use
   `--local` or `agent exec`.** The client command submits an `agent` RPC and
   waits for its terminal result; a direct client may instead retain the
   Gateway-returned run ID and call `agent.wait({runId})`.
5. OS-1 owns both process IDs, first checks the chosen port is free, starts
   Gateway without `--force`, waits for authenticated readiness on that exact
   port, then sends the request. A collision fails before model work; do not
   kill a pre-existing process. Stop/timeout signals only the exact request
   child (the Gateway CLI sends `chat.abort` after acceptance), then drains
   and terminates the exact Gateway child. A lost client connection after run
   acceptance is **ambiguous**: inspect that run's terminal state before any
   replay. Preserve all raw receipts and the original OS-1 session/queue.
6. The plugin may offer only `os1_state_read`. It reads the immutable,
   host-prepared state snapshot; it cannot dispatch a backend, choose model or
   effort, grant permission, touch files, invoke a shell/browser or adopt final
   output. `before_prompt_build` appends the bounded policy to the OpenClaw
   system prompt. Because that modifier fails open, `before_agent_run` must
   verify exact request+policy+contract and atomically write a gate receipt
   **before** any model call, or block. A host run must be rejected if that
   receipt is absent or mismatched, even if the model returns a fluent answer.
7. The Gateway-returned terminal status, effective local model, exact session
   and Gateway run identity, successful tool list, pre-dispatch gate receipt,
   and raw output must be verified before feeding the candidate to existing
   OS-1 task-family admission. Use
   `proposeGateway(prepared:gateReceipt:gateObservedBeforeTerminal:gatewayEnvelope:exitCode:)`
   on the **actual Gateway `agent --json` envelope**. It requires outer
   `status=ok`, matching run/session IDs across terminal receipt and metadata,
   `openclaw` harness, requested/effective/response model all pinned local
   Ollama, one coherent local execution trace, no reroute/fallback, zero tool
   failures, allowed tool names, visible reply/payload consistency and exact
   policy-gate binding. One exact JSON fence is normalized deterministically;
   duplicates/prose/extra fences fail. The normalized raw JSON still goes to
   the task-family verifier for candidate ID, source and quality admission.
   Native Codex/Claude retain their actual pre-dispatch policy and
   post-return REVAS gates. Local model output is candidate-only, not
   flagship-max parity or a new permission source.

**No `os1_work_submit` tool is present.** Safe host dispatch needs an exact
run/attempt lease, typed host IPC, idempotency, workspace scope, signed route
ticket, and a downstream adoption receipt. Until then, OpenClaw may inspect
only the approved snapshot and propose a bounded route/plan; OS-1 continues
to execute via its existing host paths. Do not enable OpenClaw's generic tools
as a shortcut.

## Offline verification for this branch

- Pinned Node `--test Resources/openclaw-os1-bridge/bridge.test.mjs`: 3/3 pass.
- `swift build --product OS1ContextTests` and focused fixture: 39 checks pass.
- Pinned OpenClaw `config validate --json` on the Swift-generated Gateway
  config: valid, zero warnings.
- Pinned `plugins inspect --runtime` on the generated config: one typed tool,
  all three hooks, no diagnostics. This remains registration evidence only.

### Gateway execution receipts

The first Gateway attempt discovered a harness error: `openclaw health --json`
exited 0 with `{status:"starting",startupPhase:"waiting for Gateway listener"}`.
The client was sent too early, returned `ECONNREFUSED` before run admission,
and no model/tool/gate operation occurred. Its exact child PID was stopped and
port closed; private receipt:
`~/.os1/openclaw-controller/gateway-smoke-20261010T082118Z-99ca963f/`.
`gatewayHealthReady(_:)` now requires top-level `ok:true`, not CLI exit 0.

One corrected **local-only** Gateway attempt passed: authenticated full-health
readiness, a matching `before_agent_run` gate receipt observed while the agent
result file was still empty, Gateway terminal `ok`, effective
`ollama/qwen3.5:4b`, exactly one `os1_state_read` call and zero tool failures,
a closed candidate after fence normalization, 10-second request wall time,
no token in Gateway/client/result logs, exact Gateway child exit and closed
loopback port. The observed Gateway envelope passed `proposeGateway` offline
against its original gate/contract bytes. Private receipt:
`~/.os1/openclaw-controller/gateway2-20261010T082254Z-5f65d19e/`.

This is **one bounded local route/tool proof**, not a task-quality/flagship
comparison and not a packaged or installed OS-1 path. Default routing remains
disabled until the host process wires exact child supervision, receipt and
adoption; the release embeds and verifies its own runtime/plugin/model; and
source→package→installed→live→recovery identity checks pass.
