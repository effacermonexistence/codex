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

## Actual installed-OS1 Codex relay attempt — 2026-10-11

This is a new executed diagnostic, not the earlier collaboration-subagent
feasibility check. Through the verified installed OS1 native UI, one dedicated
test conversation was created and its next turn was explicitly sent to Codex.
The synthetic request required forwarding 1+1 to ordinary ChatGPT and returning
the new session/message-bound response; self-answer, API, Chrome, Work and
another Codex answer were explicitly excluded.

- Conversation: `CC771875-F0B9-4539-A2C6-19FE979241E0`.
- RCC task/submission: `806ee12b-3cc4-4f25-b610-d952be327ec6`.
- Native Codex session: `01a12d3c-e2c8-73e2-a584-46715691b711`.
- One native Codex provider call, selected `gpt-5.6-luna/high`, read-only.
- Native execution returned in 20,754ms; this excludes the earlier local
  planning/preparation interval and is not an end-to-end latency claim.
- Raw final output began `NO_RELAY_TOOLS`. No ordinary Chat request or answer
  was produced. OS1 displayed that failure in the originating conversation.
- The raw tool record, independently of model self-report, contains the exact
  rejection: `Computer Use is not allowed to use the app 'com.openai.codex' for
  safety reasons.` This is the combined native ChatGPT/Codex application.
- Runtime status is `returned_unverified`, task quality `execution_only`,
  parity unverified. A completed Codex turn is not completed GPT delivery.

Observed native usage was input_tokens198060, cache_read_tokens156416,
output_tokens1043, provider_calls1. These are the receipt's native usage
observations, not an invoice, exact quota debit or proof of minimum cost.
The executed high-effort profile is not a validated minimal-relay configuration.

Private raw extraction, screenshot and source pointers are preserved under
`/Users/LUA/.os1/recovery/os1-native-chat-publisher-probe-20261011/` in
`os1-native-codex-relay-actual-attempt.json` and
`os1-native-relay-failure.png`. The original native JSONL remains in its original
private location; encrypted/internal reasoning and authentication were not
exported into this source checkpoint.

Permission to create/resume appropriate diagnostic sessions is already supplied
by the user; user nomination is not required. The unresolved contract is a
legitimate ordinary-Chat creation/recipient control path and host-authorized
relay tools available to OS1's actual executor. The official codex-app-tools
plugin exists, but its host binding is not a transferable root process value.
Do not copy host pipes/caller metadata, invoke hidden transport, or switch UI
technology to circumvent the recorded safety restriction. Existing unrelated
jobs, auth and Handy are outside this diagnostic and remain untouched.

Installed OS1 was not rebuilt or replaced. One test conversation/native Codex
session was deliberately added. This attempt proves failure of the requested
roundtrip under the executed configuration, not universal architectural
impossibility and not product completion.

## Native composer opening and user-confirmed send — bounded follow-up

After the failed installed-OS1 attempt, the shipped native decoder supplied a
legitimate composer-opening path: `codex://new?mode=chat&prompt=...`. The root
issued that opening request at `2026-10-11T23:31:04.320Z`, with only the fixed
synthetic nonce `OS1_NATIVE_CHAT_DRAFT_20261011_B` and 1+1. Native draft metadata
verified the prefill. It did not expose an effective mode or server thread ID.
Published command docs establish that prefill links do not send automatically:
https://learn.chatgpt.com/docs/app/commands . Shipped-source support for the mode
parameter is distinct from published documentation and observed mode adoption.

The user then explicitly confirmed sending that prompt in ordinary Chat. This
supplied state must remain attributed to the user, not to automatic OS1 sending.
Two bounded public inventories, one temporally adjacent candidate read, and
own-nonce native metadata/log inspection did not identify the sent server
conversation or fresh assistant message. Unrelated chat content was not kept.
The public reader is not restricted to Work; no Work-origin filter was found.
No further prompt was sent and no synthetic callback answer was injected.

Remaining gate: identify the exact sent diagnostic and read its fresh answer.
A screenshot of that diagnostic response or actual conversation link was
requested solely to bridge this identification boundary. No new OAuth, key,
Tunnel, Chrome or inference-API setup was requested. Automatic ordinary submit,
same-task OS1 return and exact quota attribution remain unverified.

### User correction after the send confirmation

The user later reported that the window is not visible now, was visible earlier,
and may not have been sent. Supersede the previous confirmation: current send
state is UNVERIFIED. Preserve both statements chronologically; do not invent a
backend failure, sent turn or reply. The same nonce B was reopened through the
registered native URI, without another model call. Window visibility/effective
mode, actual submit, new reply, OS1 adoption and quota remain separate gates.

Fixture regression rerun: 102/102 PASS, process exit0. This is source-fixture
evidence only, not native delivery. No implementation/app build changed.

## Identified existing diagnostic / verified new public-host response

The supplied screenshots exactly matched four historical turns in
`6ac8d3d4-f684-83e8-9110-1cde1648a5a9` (`계산 요청`). Root sent one new fixed
request with nonce `OS1_NATIVE_CHAT_ROUNDTRIP_20261011_C` using the public native
send tool, with no host/model/thinking override. A later read retrieved NEW
completed turn `6a411993-d920-4983-9412-e70aedd6ed5a` and assistant message
`c6e155cf-62c0-4779-892b-12362a05da02`, exact output nonce C followed by `=2`.
Before/after identity and prompt/answer nonce checks passed. Immediate stale
history was not treated as failure requiring resend. No duplicate send occurred.

This proves root-host public send/read, not the independent OS1 executor's
official host provisioning, automatic fresh-chat creation, OS1-visible adoption,
or zero Codex debit. Native metadata exposed no mode/model/quota receipt. Those
remain separate completion gates. Nonce B remains UNVERIFIED; this new result
does not retroactively make its withdrawn manual confirmation true.

One follow-up tool-discovery request for the currently registered os1_probe_open
was sent under nonce D to the same diagnostic. It must not activate a new
operator run, use a substitute tool, or turn a locally computed 2 into a callback.

D reached a NEW completed turn with COMPONENT_REQUESTED. Actual native logs
independently tied the genuine connector and selected conversation to the
ChatGPT-hosted `ui://os1/native-chat-probe` HTML request, then cancelled it with
AbortError/code20. No later same-widget running/adoption was observed through
the bounded check. Cause remains unresolved. Old Worker stayed expired with
starts1/offers0/ACK0/returns0. No fresh operator run was activated.

Official plugin source still exposes no public provisioning contract giving an
independent OS1 child the ROOT native-host codex_app binding. Do not copy caller
identity, host pipes or use private IPC as a shortcut. The real public-host
send/read success and this cancelled resource fetch are distinct from OS1
product integration. Preserve receipts and the unresolved accounting boundary.

## Superseding Desktop relay checkpoint (2026-10-12)

Current objective: recover exact accepted owner turns and never call failed GPT
send successful. Allowed: staged source, isolated socket/state fixtures and
observation of F/G/H only. Forbidden: new live sends after H denial, installation
of an unverified GPT route, API/browser fallback, borrowed host identity, live
sessions/queues/auth changes. Success gate for this checkpoint: compiled code,
38 state fixtures, actual failed-tool/observation fixtures and live read-only H
reconciliation. Product success remains blocked by host authorization; checkpoint
is not product completion. Human approval was actually supplied, but rejected by
the delegated host's trust classification. Do not request repeated generic login.
