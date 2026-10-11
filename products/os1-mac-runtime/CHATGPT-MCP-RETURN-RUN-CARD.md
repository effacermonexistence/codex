# Native ChatGPT return adapter — run card

Objective: OS1-owned task → registered native ordinary ChatGPT MCP App → actual
model-initiated result tool → the same OS1 task, without paid inference API,
Chrome, a Codex surrogate, or a false quota-zero claim.

Source: exact 4be12e1473ac264187ceadd4aa4fbbb4e1978071, separate worktree
`OS1-chatgpt-mcp-return-20261011`, branch `os1/chatgpt-mcp-return-20261011`.
Installed build371 is not this source candidate. Preserve its 256 sessions,
original queue, recovery records and paging data. Existing dirty handoff and
release symlink in the older tree are not touched.

Allowed: new `Resources/chatgpt-mcp-bridge/`, bounded adapter tests and this
receipt/documentation. Any existing-runtime admission change requires an
explicit observed host/config/quota contract, never invented values.
Forbidden: Handy; auth caches; current Codex host pipe/caller impersonation;
ChatGPT GUI automation through another driver; private endpoints; Chrome;
model API keys; unrelated products; automatic low-quality fallback; public
publication of private OS1/RCC source.

Executor: transport mailbox and official MCP/MCP Apps methods, no new planner,
scheduler, final judge, or retry owner. OpenClaw remains task owner.
Verifier: exact request/task/hash binding, one-shot send journal, independent
matching callback; invalid/duplicate/conflicting/cancelled/expired cases.
ACK != answer; callback != model/effort verification; answer != quality parity;
unchanged aggregate usage != exact zero Codex debit.

Activation gates: legitimate plugin registration, ordinary Chat tool discovery,
active initialized widget, authenticated transport, real callback, no Codex
fallback. Registration missing is not repaired with a fabricated app ID.
Keep unavailable surface held, not falsely available.

Stop condition: actual native roundtrip and accounting evidence, or a precise
external registration/approval/instrumentation boundary after safe alternatives.
Never label local tests as native ChatGPT success or entire product completion.

Research inspected: ReAct (arXiv:2210.03629) motivates external observations;
intrinsic self-correction study (arXiv:2310.01798) motivates separate executed
receipts rather than model self-report. These are design inputs, not proof.
