# Build 360: local surface selection and ordinary ChatGPT boundary

## Scope and status

This change connects the pinned local OpenClaw/Ollama candidate selector to actual
native route preferences. It preserves the signed model/effort/executor contract.
A separate ordinary ChatGPT public-UI adapter is packaged, disabled until an
explicit owner Connect action and Chrome's own existing-session approval.

It is not a claim of four working automatic surfaces, free/unlimited ChatGPT,
zero semantic drift, minimum cost, or parity with a latest maximum-effort model.
Those claims require their own observations and held-out evaluation.

## Producing path

Request → existing exact fast paths / explicit fan-out → current native
catalog + selected-account auth/billing/quota → host candidate inventory →
local OpenClaw preference → deterministic admission → existing signed RCC core
selects model/effort → actual native execution → REVAS + source-bound receipts.
Local model failure retains the valid host floor inside verified subscription
candidates. No valid subscription candidate means hold, not invented availability.

The local model cannot invent accounts, providers, quota, prices, permission,
quality certification or transports. Unknown costs are labeled a bounded
preference, not measured minimum usage. API/cloud overrides cannot be classified
as an included subscription. An omitted Codex model_provider can use its official
OpenAI default only with a valid native account and effective config response.

## Four product surfaces are not four independent allowances

Ordinary ChatGPT is distinct from Codex app-server. The existing gpt-chat lane
still consumes Codex usage. Same-account subscription Claude chat and Claude Code
share the Anthropic allowance; features/context/reasoning can consume different
amounts. Account identity, transport and actual billing mode bind the pool.

Current ordinary ChatGPT capability is public browser conversation only. It
cannot perform filesystem/shell execution. It does not import authentication
caches, use hidden consumer API endpoints, or fall back to Codex/SIWC.

## Browser boundary and recovery

The OS-1 Settings/Accounts screen offers Connect ChatGPT, Refresh and Disconnect.
Only an explicitly confirmed owner Connect action can start the pinned official
Chrome DevTools existing-session component, also used by OpenClaw. Chrome Remote
Debugging and Allow remain separate security-sensitive approvals. App launch,
normal routing, status and run do not start attachment or login windows.

The helper keeps a dedicated private socket and serializes its own browser turns.
It uses only helper-created ordinary chatgpt.com pages, fixed read-only DOM
inspection, and public input/click controls. It does not inspect cookie/storage,
network headers or private React/API state. Failure after dispatch is recorded as
outcome_unverified and never silently replayed. Disconnect retires only this
helper connection, leaving Chrome and sign-in intact.

Every returned answer requires a private request/response/projection hash receipt,
ordinary Chat mode proof, a supported conversation URL and observed completion.
The App and fan-out parent recheck receipt custody. Browser records are separate
from native JSONL and carry execution_only, not quality parity. Schema 3 adds
optional browser evidence while preserving schema 1/2 native/legacy semantics.

The consumer UI cannot install a privileged provider system prompt. Its RCC
projection is explicitly user-level guidance, recorded as such. Full engine text
or a bounded projection does not by itself establish measured uplift.

## Evidence and remaining gates

Deterministic local surface, native auth, browser protocol and fan-out fixtures
exercise closed input, request binding, capability, account/pool and receipt
boundaries with no hosted model calls. Source compilation is separate from
packaging, installation, live routing and recovery readback.

The ordinary ChatGPT operator diagnostic succeeded through an already authorized
Codex browser tool. That is not proof that OS-1's separate transport is authorized
or operational. The new product transport remains approval-blocked until its own
connection is established. No authentication or browser control grant was made
while the owner was absent.

Quality qualification of the 4B local interpreter and latest/max output parity
remain unproven. Native pool observation does not certify output quality. Existing
unrelated CI failures are retained, not renamed as passes. No main merge is
allowed without green CI and authoritative OhMyBug review/attestation.

Official sources inspected for the applicable boundaries:
- https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
- https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work
- https://learn.chatgpt.com/docs/pricing
- https://developers.openai.com/siwc/quickstart
- https://docs.openclaw.ai/tools/browser/existing-session
- https://developer.chrome.com/docs/devtools/agents/get-started/configuration

Handy is excluded from this change and every execution/check described here.

Build359 was not installed: the release scan rejected two newly introduced
compiler-emitted public-source diagnostic paths. The raw failure is retained.
The correction does not weaken the scanner. Bare GPT now means ordinary
ChatGPT; only explicit gpt-chat/Codex chat names select the Codex bounded lane.
