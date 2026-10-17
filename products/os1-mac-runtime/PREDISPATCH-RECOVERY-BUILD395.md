# Build395 — distinguish authority failure from model incompatibility

## Actual failure and source boundary

The installed394 UI sent one request for two independent Codex arithmetic parts. The Core created two agent nodes, and the UI tree and separate first-child progress window were observed. The first selected `gpt-6-luna/low`, executed natively and returned `2`. The second failed before native dispatch, then was unnecessarily re-resolved to `gpt-6.1-sol/low`, which also failed before dispatch. The parent failed and its main result was empty despite preserving the successful child in storage. This is **not** a passed parallel or complete routing test.

New phase receipts localized the two failures to a combined credential/device/HTTP/ticket stage (16.111 and15.598 seconds). They did not retain the exact underlying error. A15-second local credential helper and the server's identity-service retry timing are both compatible hypotheses. A later opaque400 invalid-body diagnostic does not prove authentication succeeded: the same400 can represent an earlier auth denial. Current metadata health is not historical causation.

## Repair

- Split credential, device, HTTP and ticket-validation timing. Preserve only bounded failure stage/category and numeric status/code in the existing private attempt-bound diagnostic record. Never record credentials, exception descriptions, request/response bodies, account payloads or URLs there. Keep public execution-record shape and all signature/authorization gates.
- A successfully observed native catalog may establish that the exact selected tuple is unavailable. Only that explicit evidence produces `native_configuration_unavailable` and uses the existing bounded same-scope configuration re-resolution.
- Unknown inventory, credential, transport, HTTP, opaque authorization or ticket failures produce `native_pre_dispatch_failed`. Hold the same candidate without a model upgrade, candidate exclusion, new model call or an invented incompatibility claim. Legacy mixed configuration/auth and opaque authorization-refused records are also held conservatively.
- Preserve completed children as existing partial-result output when a parent is failed/held. Never invent the failed child's answer or upgrade partial execution evidence into full-task quality, parity or completion. Already-running siblings must settle and retain their results before terminal adoption. Leases, permissions, quotas and no-replay guarantees remain intact.

## Verification

Pure phase/classification/custody fixtures and the existing outcome compatibility suite; regression cases for lost partial output, canonical and legacy unknown failures, stale queued repairs, late sibling settlement and valid catalog-negative alternatives; all JS/native/release/package checks; then exact-source installation and actual UI/native observations. The earlier failed request, native records and setup-observer failures remain preserved, not rewritten as success.

The final product requires fresh installed-path evidence. Source tests, package creation, CI and R2 manifests alone are not routing completion. Quality comparisons use separately frozen synthetic tasks, a predeclared maximum-effort native reference, and final answer/artifact locks before scoring. No task-specific gold, paid API fallback, browser/ChatGPT relay, credential workaround, new coordinator or mandatory model judge is introduced.
