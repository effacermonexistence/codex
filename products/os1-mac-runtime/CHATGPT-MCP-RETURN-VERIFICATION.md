# Verification / handoff — 2026-10-11

## CURRENT OBJECTIVE
Deliver a native ordinary ChatGPT request and response from OS1/OpenClaw,
without paid inference API, Chrome, a Codex substitute or invented quota data.

## CURRENT BRANCH
`os1/chatgpt-mcp-return-20261011`, isolated source root
`/Users/LUA/Developer/OS1-chatgpt-mcp-return-20261011`, parent `4be12e1`.

## COMPLETED COMPONENT WORK
- New dependency-free Node24 transport mailbox, MCP tools/resource, MCP App UI,
  OS1-side client and deterministic negative tests.
- Installed that isolated package using the supported `codex plugin marketplace
  add` / `codex plugin add` commands. Installed cache bytes matched source manifest.
- Preserved existing OS1 binary, task/session stores, queue, paging and earlier
  dirty checkout. No Handy, browser, authentication cache or host pipe use.

## ACTUAL HOST PROBE — FAILED DISCOVERY
In the existing diagnostic ChatGPT conversation `계산 요청`, a single official
app-tool message asked ChatGPT to call `os1_chat_open` only if actually available.
The matching completed turn `5c8bf475-e6f1-493b-bb51-c2704d0592f3` returned exactly
`OS1_MCP_TOOL_UNAVAILABLE`. No bridge connection or autonomous task was created.
The call was made by the current Codex task's official app tool, **not by OS1**.
It is a discovery probe, not an OS1 routing success.

The existing conversation may not load a newly installed local plugin. This
result does not establish impossibility in a fresh, properly registered Chat.
It does establish that local package installation did not make this tested
conversation usable for the adapter.

## TEST RESULTS
- `node --test Resources/chatgpt-mcp-bridge/*.test.mjs`: **40/40 PASS**.
- `node --test Resources/openclaw-os1-bridge/*.test.mjs`: **23/23 PASS**.
- `node --check` on every new `.mjs`: PASS.
- `git diff --check`: PASS.
- No Swift source changed; no Swift build, package replacement or OS1 restart
  was performed for this candidate. These Node tests do not verify native Chat.

## QUOTA
Before/after the discovery probe, the exposed Codex weekly meter was 5% used
and credit balance was unchanged. Exact debit attribution is **NOT_VERIFIED**.
Rounded/delayed aggregate meters plus concurrent root work cannot prove zero
debit. No Codex agent was used as a substitute for the missing ChatGPT tool.

## IN PROGRESS / CURRENT BLOCKERS
Native ordinary Chat registration/discovery is not established. The documented
MCP route requires a real registered connection, reachable HTTPS or Secure MCP
Tunnel, appropriate transport authentication, and ChatGPT registration review.
Available management tools and inspected CLI commands do not expose creation
of that ChatGPT custom connection/ID. GUI automation of ChatGPT was previously
denied; alternate drivers, private APIs or forged caller identities are not used.

## NOT STARTED / NOT CLAIMED
- Real autonomous OS1 -> ChatGPT -> OS1 roundtrip.
- Exact host Chat mode/model/effort/quota observation.
- Live RCC catalog admission / UI result adoption for this adapter.
- Full production authentication, distribution or reliability qualification.
- Quality-parity comparisons, release build, installation or self-repair proof.

## FILES CHANGED
New only: this verification, `CHATGPT-MCP-RETURN-RUN-CARD.md`, and
`Resources/chatgpt-mcp-bridge/{store.mjs,server.mjs,client.mjs,app.html,
server.test.mjs,app.test.mjs,plugin.json,README.md}`.

## ARCHITECTURE / INTERFACES THAT MUST NOT CHANGE
One OpenClaw task owner; no second planner or autonomous retry service.
Adapters cannot choose fallback accounts/models. Keep source/policy/task hashes,
one-shot send semantics and independent result callback. Neither send ACK nor
model-generated metadata proves execution model, quota, parity or completion.
Current RCC exact-config and nonlocal quota gates stay intact. Do not fabricate
`remaining_fraction=1`, an effort, model ID or native JSONL to bypass them.

## NEXT TASKS AND DEPENDENCIES
1. Establish genuine native ordinary Chat plugin registration/discovery using
   supported installation and host approval; obtain a real registered ID if
   using the documented remote/tunnel path. No made-up `.app.json` mapping.
2. After 1, open its live MCP App and confirm transport identity. Authorize one
   exact synthetic request in private `activation.json`; deliver and inspect the
   actual callback. Do not use root app-tool send as the claimed OS1 sender.
3. After 2, validate actual host mode/account and observation availability.
   Decide an honest supported config/unknown-quota contract before RCC admission.
4. After 2–3, connect the existing native adapter/candidate catalog and expose
   the result in the original OS1 task. Test cancellation, closed widget,
   duplicate/late callbacks and absence of Codex/Chrome/API fallback.
5. Only after runtime acceptance, release/install with existing preservation
   gates and rerun actual UI proof. Quota proof remains separate from quality.

## SESSION-ONLY CONTEXT / PRIVATE RECEIPTS
- `/Users/LUA/.os1/recovery/os1-chatgpt-mcp-20261011/roundtrip-attempt.json`
  preserves exact probe response and before/after usage.
- A private Codex config snapshot was saved before the scoped plugin install;
  never print or publish it, and do not restore it over unrelated later edits.
- Marketplace: `os1-native-chat-test`. Plugin:
  `os1-chatgpt-return@os1-native-chat-test`. Its source snapshot is under
  `~/.os1/plugin-sources/native-chat-return-20261011`; default delivery is denied.
- Installed OS1 build371 remains the previous verified binary. This candidate
  has not replaced it. No public GitHub push or merge is authorized by this file.

## FINAL STATUS
**BLOCKED_NOT_COMPLETE.** Component implementation/tests and local package
installation are real; native ChatGPT connection and requested quota proof are not.
