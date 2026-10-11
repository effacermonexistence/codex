# Native ChatGPT MCP return transport — candidate, not activated production

This package implements the bounded adapter half of:

```
OS1/OpenClaw task -> mailbox -> registered live MCP App -> ui/message
  -> ChatGPT -> os1_return_result -> same request/task mailbox -> OS1
```

It does **not** invoke a model API, Chrome, the Codex agent, a private ChatGPT
endpoint, or a copied host pipe. The mailbox is not another planner or scheduler.
OpenClaw still owns planning, retries, cancellation and result adoption.

## What is implemented

- `store.mjs`: private durable SQLite request/result journal; exact payload and
  RCC policy hashes, single-use delivery, independent result capability,
  idempotence, conflicting/late callback rejection, cancellation tombstones,
  restart preservation and uncertain-send holds.
- `server.mjs`: MCP tools and fixed HTML resource over stdio, or loopback-only
  HTTP for a properly authenticated connector/tunnel. HTTP does not itself
  provide remote authentication and is not a public production endpoint.
- `app.html`: registered MCP Apps host initialization, private tool data,
  one outstanding request, `ui/message`, ACK separate from result, no resend
  on timeout/teardown. No DOM automation, model API call or external script.
- `client.mjs`: enqueue/status/wait/cancel for an OS1-owned transport request.
  Waiting timeout preserves uncertainty; it never retries or changes provider.
- Node built-in tests use private temporary state and fake host/provider replies.

## Production gates still closed

Host mode, model, effort and quota are `NOT_EXPOSED`. The callback alone does not
prove it came from ordinary Chat, authenticate a user, prove a model setting,
show exact quota debit, or establish flagship-quality parity. Successful
fixture callbacks are not native execution evidence.

The existing RCC catalog and native adapter are deliberately not changed to
advertise this candidate as live. Current exact-config and quota gates must
not be defeated by invented model/effort names or `remaining_fraction=1`.
Installed OS1 build371 is unchanged.

Requests require `diagnostic:true` and a private, short-lived
`ROOT/activation.json` containing precisely authorized request IDs:

```json
{"schema":1,"mode":"diagnostic_only","request_ids":["EXACT-DIAGNOSTIC-ID"],"expires_at_ms":0}
```

The example is intentionally expired. Do not enable ordinary traffic by
replacing the gate with a blanket boolean. Activation is checked again before
delivery. Keep root 0700 and files 0600; symlink/hardlink substitutions fail.
Do not add credentials, private application state, or owner material to an
unregistered endpoint.

## Supported registration prerequisite

Official docs describe ChatGPT **Plugins -> Add custom MCP server**, a reachable
HTTPS endpoint or Secure MCP Tunnel, authentication/risk review, creation of
a real registered plugin ID, installation, then testing in a new ordinary Chat.
The resulting genuine ID can be referenced in `.app.json`. Do not invent it.
Local stdio package installation is a separate step, not proof of ordinary Chat
registration/discovery. A connection/control-plane key for a secure tunnel is
not an inference API key, but its presence/authority must still be established.

Keep the App alive; background lifetime is a host constraint. `ui/message` ACK
does not carry the model's final answer. ChatGPT must actually invoke the
model-visible `os1_return_result` tool with the supplied binding. A model that
does not call it has not completed the roundtrip. Widget-only control tools
carry sensitive capabilities in `_meta.bridge`, not model-visible text.

Launch with pinned Node 24.20.0 or a separately validated Node version:

```sh
node server.mjs --stdio --root /ABSOLUTE/PRIVATE/ROOT
# Optional authenticated tunnel target; never binds a public interface:
node server.mjs --http --root /ABSOLUTE/PRIVATE/ROOT --port 8791
node client.mjs enqueue --root /ABSOLUTE/PRIVATE/ROOT --request-file /PRIVATE/request.json
node client.mjs wait --root /ABSOLUTE/PRIVATE/ROOT --request-id EXACT-DIAGNOSTIC-ID
```

Request files contain `request_id`, `task_id`, `request_sha256`, `policy_sha256`,
`prompt`, `policy_text`, `diagnostic:true`, optionally `expires_at_ms`. Hashes are
SHA-256 of exact UTF-8 strings. The client never prints return/dispatch tokens.

## Validation and acceptance

```sh
node --test Resources/chatgpt-mcp-bridge/*.test.mjs
node --test Resources/openclaw-os1-bridge/*.test.mjs
```

Keep these distinct:
1. Source/test pass.
2. Package installed and discovered in the actual native Chat host.
3. Actual OS1 task sent autonomously by its initialized component.
4. Exact model callback received and displayed in that OS1 task.
5. Ordinary Chat resource attribution / Codex debit evidence.
6. Quality parity (separate task-specific measurement).

No build/install/activation/quality claim may substitute for another stage.
Missing registration must not cause a hidden fallback to Work/Codex or Chrome.

## Sources inspected

- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/build/extensions
- https://developers.openai.com/plugins/concepts/mcp-server
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

These support interface components and documented registration, not a claim
that the composed OS1 route has run successfully on this machine.
