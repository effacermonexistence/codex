# Memory paging verification — build325

Date:2026-10-05. Product:0.9.259/build325. Proof mode: deterministic integration/runtime observation, not a model-quality or token-savings benchmark.

## Executed checks

- ContextBudgetPolicy focused fixtures:40PASS.
- EpisodicMemory focused fixtures:71PASS, including all ten requested regression shapes and full ancestor-lineage quarantine/replay.
- MemoryPaging integration fixtures:57PASS, including original evidence project vs healed execution checkout and moved-project hot-state isolation.
- Actual runtime MCP handler:6 focused checksPASS; initialize/list/page-in/UNKNOWN/scope/receipt.
- Actual GUI handoff:4 focused checksPASS; full originals preserved, old turns evicted from working context, hot correction reconstructed, exact old page restored.
- Source wiring:15PASS.
- Checked-in private paging recovery fixtures:19PASS. Additional independent temporary installer review:23checksPASS.
- Native Codex config/read:soft limit240000, total scope, memory server registration all read back successfully. Zero provider-model calls.
- Existing full OS1ContextTests, runtime self-test and GUI self-test:PASS.
- arm64 and x86_64 release builds:PASS. Universal signed local development app/package, payload confidentiality scan26files/no findings, legitimate helper identity/adversarial mutation gates:PASS.

## Installation and observed runtime

Rollback-capable local installer completed with13checksPASS. Installed app and bundled/stable CLI report0.9.259/build325 and matching staged executable hashes. Existing conversations, messages, native bindings, queue, drafts/pins and old paging/source state were preserved.

Current session JSON was compared to the install snapshot as structured data. All material fields matched. A later serialization changed JSON byte ordering only; this was not mislabeled as raw-file byte equality. Original install bytes remain preserved privately.

Installed `memory-mcp` stdio initializes and advertises exactly one read-only `memory_query` tool. Native UI observation found the Context popover with soft240000, hard272000, retrieval24000, active8000, Save and Fresh-context-next-request controls. No request or paid model test was sent from the UI.

Private installer receipt and source snapshot/drill are under:
`~/.os1/recovery/long-context-memory-paging-build325-20261005T070216Z/`

The staged recovery is a distinct0400/0500 read-only reconstruction, not live activation. Existing files verified before worker resume and after restart. Binary rollback never replays the old conversation or memory snapshot over newer work.

## Package identity

OS-1-0.9.259.pkg:37,371,006bytes.
SHA-256:`b319c8791fcba37f6b3d14b4cdc597e7e0d79b0e5d02e53bc08dcd91228bc932`.
Mode:development/local signer, no claim of Apple public distribution notarization.

## Failure repaired during this task

Integration caught scope/correction/provenance defects before release: stale A in hot state despite retrieved B, native input_text/output_text and nested tool results omitted, workflow/source healing breaking evidence scope, and parent lineage not reverified during replay. Corresponding gates and tests were added.

An initial packaging run also failed after the running shell script was edited while it was being consumed. Syntax/source inspection and both completed architecture builds were checked; packaging was rerun from the frozen script with those exact built binaries and all package checks passed. Future edits must occur before launching the release script, not during its execution.

## Explicit unverified boundaries

No paid provider round trip was executed. These checks do not claim a frontier model has successfully invoked memory_query in a real owner task, nor guarantee exact future multimodal/tool tokenization, subscription billing, quality uplift or measured token savings. The first owner request supplies that live observation. Original capture/retrieval limits and natural-language correction ambiguity are documented in LONG_CONTEXT_MEMORY_PAGING.md.

Private user state was not committed into Git. A local private recovery drill is not an offsite data restore or new-Mac activation.
