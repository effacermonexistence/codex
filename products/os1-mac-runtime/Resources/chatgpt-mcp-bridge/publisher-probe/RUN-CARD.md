# Publisher-hosted native Chat falsification probe

This is an isolated diagnostic, not the customer connection implementation or
production OS1 admission. It tests the next missing layer before constructing
customer OAuth, pairing, routing, or installers around an unproven host path.

- Objective: registered native host UI accepts one OS1-origin fixed 1+1 request
  and the actual model calls the matching result tool. No customer Tunnel/API
  key, paid model API, Chrome, Codex surrogate, host-pipe impersonation.
- Source: this private branch; no public Git publication of proprietary code.
- Allowed: new isolated Worker/DO, fixed HTML, synthetic request only. Existing
  publisher Wrangler authentication may deploy it; no new user credential.
- Forbidden: current OS1 installs/stores/queues, Handy, existing services and
  credentials, arbitrary prompts/files, unverified ordinary-Chat/quota claims.
- Request state: one durable offer; no automatic retries; expiry/cancel holds.
- Read-only observation: idle polling is bounded; only a definite pre-offer
  rate rejection permits at most two delayed reads. A model message, one-shot
  offer, timeout, ambiguous failure or ACK never gains replay permission.
- Host entry: documented global MCP App entrypoint and desktop plugin deep link
  after a genuine technical plugin ID exists. Never fabricate the ID.
- Native gate: initialization -> ui/message -> actual model tool callback ->
  exact request-bound durable result. ACK does not satisfy the gate.
- Attribution gate: real ordinary Chat conversation/turn/tool record plus the
  callback. Anonymous HTTPS receipt alone is not authenticated model evidence.
- Quota gate: resource identity/accounting must be verified separately. Rounded
  aggregate usage and the string `ChatGPT` do not establish zero Codex debit.
- Stop: host failure/unsupported capability, exact runtime success, or an
  unavoidable registration approval. Never replace a failed path with API,
  browser inference or a Codex agent.

Documentation inspected: OpenAI MCP Extensions revision
`0d606217705e0e71eb21fff009619b67b80611dc`, global entrypoint/deep-link and
`openai/message` specification; official stable HTTPS MCP deployment guide.
ReAct (arXiv:2210.03629) motivates external/runtime observations only; it is not
proof of this connection.

Customer distribution still requires publisher authentication/isolation,
approved plugin publication, legitimate account/native-host binding and
restart/reconnect proof. This diagnostic must not accept private customer work.

## Current executed state — 2026-10-11

- Private source candidate only; not included in the current OS1 app/package.
- Probe/package regression: 48/48 PASS. Prior local mailbox/setup: 44/44 PASS.
- Dedicated Worker HTTPS health, MCP initialize, tool inventory and exact
  widget-resource identity checked from outside the Worker.
- Endpoint: `https://os1-native-chat-probe.omar-git-r2-backup.workers.dev/mcp`.
- Isolated durable namespace: `os1-native-chat-probe-20261011a`.
- Publisher operation authorization is generated/stored privately; it is not
  a user API key and is never bundled into an OS1 download.
- Safari's existing main-account registration was explicitly approved and
  completed. The plugin UI showed Installed / Connected; a genuine
  `plugin_asdk_app...` identifier was returned by that registration.
- The initial cloud-plugin deep link reached a real desktop `Plugin not found`
  error. It did not send a model request.
- The installed CLI `0.162.0-alpha.17.2` supports registered apps only through
  its legacy package path. The source now uses `.codex-plugin/plugin.json` and
  `.app.json`, with no duplicate direct MCP attachment. A fresh public CLI
  `plugin/read` returned one registered mapping for installed version 0.1.1.
  Standalone CLI discovery does not establish desktop host activation.
- The corrected desktop launch progressed to the exact registered-connector
  lookup and returned HTTP 404 `Connector not found`. This is a distinct gate
  from manifest discovery. Registration and native Codex authentication have
  different account contexts; that is a leading scope hypothesis, not a claim
  about every native ordinary-Chat login.
- Registering the identical fixed diagnostic in the current native account was
  separately approved. Google device verification was completed by the user,
  and Safari showed the second connection as Connected with all four tools.
  No credential cache was copied or account credential changed.
- A subsequent exact setup-page inspection exposed a separate App ID as well
  as the plugin-page ID. They are different objects. The compatibility mapping
  now uses the actual App ID from that page, not a derived/guessed identifier.
  Existing native metadata caching still referenced the earlier wrapper ID;
  a fresh diagnostic package identity excludes that stale lookup key without
  restarting the current desktop session.
- Native package is `os1-native-chat-probe-active@os1-native-chat-publisher-probe`
  version 0.1.4. Old diagnostic source/cache evidence is preserved; the source
  marketplace now exposes only the active replacement, not both bindings.
- The approved connector's `os1_probe_open` became available and returned
  `component_requested` through this task's official tool connection. That
  confirms the tool connection, not an initialized UI, model request or answer.
- The user explicitly confirmed native ChatGPT / Chat mode (not Work). The
  native launch was attempted again and one fixed 1+1 request was queued. The
  user reported that the diagnostic window itself did not appear. After the
  bounded ten-minute deadline, the request terminated as expired with no offer,
  submission acknowledgement or answer. This is a failed native transport test,
  not a successful arithmetic result or proof that the widget was mounted.
- Native ordinary-Chat execution, result callback, exact quota-debit evidence
  and full OS1 integration remain unverified. The installed OS1 app is unchanged.

The public diagnostic endpoint accepts only a fixed server-owned 1+1 fixture,
not arbitrary user prompts. Anonymous callback evidence remains unauthenticated
until correlated with the actual registered native host and conversation.
Private execution receipts are kept outside the source tree. No customer
source, policy corpus, prompts, credentials, or existing app state was uploaded.

Exact-version package source inspected:
`openai/codex@740e5af33c71225640e0c1c1555c514c2c93ab74`,
`core-plugins/src/loader.rs` and `app_mcp_routing.rs`.
Current official local registered-server setup:
https://developers.openai.com/plugins/build/plugins#create-and-test-a-plugin-locally-with-an-mcp-server

The compatibility package is a source/local diagnostic package only, not a
publicly submitted plugin. A plugin ID, App ID and version ID are separate typed
identifiers. The current App ID is account-scoped; it must be replaced only by
the corresponding verified setup field, never by guessed prefix conversion.

## Ordinary Chat / native mode boundary

The complete public `ui/message` extension supports `target` and `send`, not a
Chat/Work/Codex selector or a billing-pool field. Read-only inspection of the
installed client found separate ChatGPT and app-server submission branches.
Host name, user agent, `selectChat`, `kind:chat` and a visible draft alone do not
identify ordinary Chat or zero Codex debit. The recipient binding must match.
Static source evidence is not a runtime request receipt.

Do not synthesize an answer through this Codex task's return tool and present
it as a separate ordinary-Chat model response. Do not open the web widget while
an active request is queued: that would create an unauthorized browser route.

## Terminal test receipt

- One request queued; offers 0, submission acknowledgements 0, returns 0.
- Terminal state: expired. No automatic replay or fallback was invoked.
- Actual model response and same-OS1-task answer adoption: not verified.
- Native diagnostic window: absent according to the user's current report.
- Fresh CLI mapping plus four-tool/global metadata discovery: verified.
- Current desktop global-view selection/mounting/handshake: not verified.
- Codex aggregate usage before/after was 15 percent in both reads. That does
  not expose per-request debit and is not a zero-Codex-debit proof.

Current official local-plugin instructions require restarting the ChatGPT
desktop app after package changes. A fresh standalone CLI reload does not
reload that existing desktop owner. Preserve this checkpoint before any host
restart; no hidden host-pipe call or protected-UI automation is authorized.

## Executed repair update — 2026-10-11 after the real desktop restart

The earlier failed-run history above is retained. It is not the current mount
diagnosis. The actual restarted desktop owner was independently observed.

1. Own-resource native logs showed `mcp_app_resource_read_failed` with
   `resource_not_allowed`. Standard request `_meta` was rejected as an extra
   resource argument. A fixture reproduced the failure before modification.
   The Worker now validates and discards common transport metadata before the
   unchanged exact business-argument/URI checks. Metadata is not authorization.
2. The fixed resource was read successfully through both HTTPS and the actual
   registered `codex_apps` proxy, byte-identical to source. Native own-resource
   events subsequently recorded sandbox creation and widget execution/running.
   These events establish mounting, not ordinary-Chat inference.
3. A later own-widget `os1_probe_next` call returned `probe_rate_limited`.
   Actual arguments were not logged, so that event does not prove or disprove
   lower-handler argument validity. The rate guard executes earlier.
4. `next()` incorrectly rendered terminal expired/cancelled/returned rows as
   idle, making observers continue polling. Three existing-state regression
   assertions failed before repair. Terminal tombstones now retain their exact
   state and observers stop; unknown state is not promoted into a new run.
5. Idle lookup now waits five seconds and ends after 120 idle observations.
   A definite rate rejection before any offer has at most two 60-second read
   backoffs. Submission/ACK failures are never retried. The 120/minute public
   rate guard, operator authorization, one-offer locking and old instance are
   unchanged.

Verification: 57/57 isolated regressions PASS; `git diff --check` PASS.
Including the existing bridge/setup regressions: 101/101 PASS. These isolated
tests do not invoke a model or establish native inference/usage attribution.
The deployed Worker version is `f056555b-1c1e-459f-b495-f61e066081bf`.
HTTPS verification read the current 7197-byte HTML with SHA-256
`594b16c3db64e2c6eb9b7f6f80ced1a765fa613bead8ead8819bc398305ede01`,
and `next` returned `expired` with no capability. A supported native entry
refresh was requested; requesting a refresh is not itself a UI adoption proof.

No new model request was activated. The old one-run instance remains expired;
its failed trajectory is not replayed or erased. Installed OS1 build371,
existing conversations, queues and authentication were not changed.

Remaining gate: actual ordinary-Chat recipient binding, authenticated model
callback, quota attribution and same-task OS1 integration. The public
`ui/message` extension's targeting does not expose mode or accounting. A
widget mounted in a generic app-server view must not be assumed to inherit
ordinary Chat merely because both products are in one desktop application.

## Recipient-binding investigation — no unsupported dispatch

The public extension at
`openai/mcp-extensions@0d606217705e0e71eb21fff009619b67b80611dc`
declares only `target:active|new` and `send` for message targeting. It does not
declare an ordinary-Chat mode, model or accounting selector/receipt.
Read-only static inspection of installed native build20156 found the widget
first inherits its recipient composer's destination. Without that recipient,
the direct `view-frame` callback provides an app-server destination. A separate
ChatGPT-hosted consumer can inherit a ChatGPT conversation origin; these are
different executed paths, not interchangeable app names.

Accordingly, do not activate a fresh run from the known direct app-server view.
The top-level Chat selection alone is not a binding for this widget. A documented
thread entrypoint also does not itself prove an ordinary-Chat destination.
The missing gate is the actual recipient backend/origin, followed independently
by accounting. Do not add invented `mode` parameters, impersonate native host
callers, modify the vendor app or turn the fixed callback into a counterfeit
ordinary-Chat result.

## Active-recipient repair — 2026-10-11

The same approved open tool now additionally advertises the documented thread
entrypoint; global metadata, fixed resource and four-tool permission scope are
preserved. The widget sends only `target:active`. Installed source inspection
found that the active branch needs a recipient composer and does not invoke the
new-thread app-server creator fallback. Missing recipient is a failure, never
permission to create a Codex task. An existing Work/Codex recipient is still not
ordinary Chat; the operator must establish the destination before activating.

Regressions: 102/102 PASS across bridge/setup/probe, including active-only
targeting, no invented mode parameter, no fallback, no ACK on rejected message.
Worker version `44b3e793-b101-4b28-9c34-275158a72871` deployed. HTTPS inspection
confirmed current HTML byte identity, active-only target, global+thread entries,
and the old expired state with no capability. HTML SHA-256:
`32e679ef4f6c740f91ca215d165d58906e821f2cdc374af7256b0765b2d81e1d`.

No new model request was activated. No new native widget epoch/Next event was
observed in the bounded authorized-log interval after the entry refresh request;
absence there is not proof of refresh or absence elsewhere. The native GUI and
ordinary-Chat binding remain unresolved. The user was asked to open the approved
resource inside a fresh ordinary Chat conversation (not to log in again).
Until that actual recipient is verified, the active adapter is a tested source
candidate/Worker diagnostic, not a functioning production OS1 Chat route.
