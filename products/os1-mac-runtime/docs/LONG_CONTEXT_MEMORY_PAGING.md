# OS-1 long-context memory paging and input-budget governance

Implemented release target: build325 / 0.9.259. Verification and installed identity are recorded separately in `MEMORY_PAGING_VERIFICATION.md`; this design text is not a live execution receipt.

## A. Integration into existing architecture

The existing GUI `SessionStore` remains the conversation/queue authority. Its actual dispatch handoff now captures originals and sends a recent working window plus a hash-bound memory capability. Existing `TaskContext` retains objectives, constraints, adoption state and lineage. Existing `SourceContextStore` carries source/retrieval receipts. No conversation is replaced by a summary, and native/backend account settings are not migrated.

Runtime execution connects one read-only `os1_memory` MCP server to Codex app-server and Claude Code. Workflow stages, review and provider fan-out retain that capability. Evidence-project scope remains bound to the original conversation even when OS-1 resolves a different execution checkout. Route tickets, effort selection, source verification and permission gates remain authoritative.

## B. Changed code

- `Sources/OS1Context/EpisodicMemory.swift`: immutable content-addressed sources, typed queries, temporal corrections, exact pages, provenance and replay.
- `Sources/OS1Context/MemoryPaging.swift`: GUI/native/artifact capture, scoped execution capabilities, working state reconstruction, persistent exposure budget, provider MCP configuration.
- `Sources/OS1Context/ContextBudgetPolicy.swift`: configurable budgets, exact-model pricing registry, request-input usage parsers and bounded continuation/rotation/hold policy.
- `Sources/OS1Context/MemoryContextMeter.swift`: content-free usage/decision receipts and fresh-next-request marker.
- `Sources/OS1Context/SourceContext.swift`: backward-compatible optional memory capability in v3 handoff.
- `Sources/OS1/MemoryCommands.swift`, `Sources/OS1/main.swift`: real page-fault RPC and provider/workflow execution integration.
- `Sources/OS1App/MemoryContextView.swift`, `Sources/OS1App/OS1App.swift`: current conversation Context control, archive-before-dispatch and bounded handoff.
- `Tests/OS1ContextTests/{ContextBudgetFixture,EpisodicMemoryFixture,MemoryPagingIntegrationFixture}.swift` plus suite entry; real runtime/GUI self-test entry points.
- `scripts/test-memory-paging-wiring.py`, `scripts/build-release.sh`, `scripts/install-local-verified.mjs`: packaging gates, private four-root recovery and isolated drill.
- `Config/context-budget.example.json`; release identity files.

## C. Data structures and storage

Private OS-1 support root: `~/Library/Application Support/OS-1`.

- `episodic-memory`: immutable originals, typed metadata/index and retrieval receipts. Version IDs, original SHA-256 and exact byte counts bind records to sources.
- `source-snapshots`: existing verified source/capability/receipt storage.
- `memory-paging/executions`: private hash-bound manifests and persistent call/byte exposure ledgers, locked across MCP restarts.
- `memory-paging/context`: last native request input measurements, **not cumulative session spend**.
- `memory-paging/status` and `decisions`: UI meter and immutable content-free decision audits.
- `context-budget.json`: optional owner-editable configuration. Without it, checked defaults apply.

A raw record retains source session/message/artifact identity, timestamp or UNKNOWN, speaker, exact/derived class, entity/object/project scope, correction authority and source hashes. Full native JSONL is opaque private custody: hidden reasoning is not a retrieval source. Parsed text values are preserved exactly; structured tool-use values are explicitly labeled parsed JSON values, with original serialization retained in the opaque parent.

## D. Retrieval

The actual MCP tool is `mcp__os1_memory__memory_query`. Types: LATEST_STATE, EXACT_QUOTE, HISTORICAL_STATE, DECISION_HISTORY, CORRECTION_HISTORY, ARTIFACT, NUMERIC_RESULT, ENTITY_RELATION, THREAD, OPEN_QUESTION, REJECTED_PATH, CURRENT_OBJECT_STATE.

Candidate scope -> temporal restriction -> source and lineage verification -> explicit supersession -> conflict check -> exact bounded chunks -> private replay receipt -> quoted data returned to the execution model.

No vector service or model call is needed to search the stored evidence. Literal queries locate exact source pages. Latest/current queries require object identity and resolve authority before text matching. `conversation_id` means OS-1 conversation identity, not the native provider session ID. The capability permits only the current conversation and explicitly captured same-workspace peers; name coincidence cannot merge threads.

Typed relation/rejection/question queries may locate unclassified raw text only when an explicit literal query is supplied. Such hits stay historical/unclassified evidence; they do not establish the relation, rejection or current state by themselves. Binary artifacts are retained byte-for-byte with provenance; the text page server does not invent a text interpretation of them.

## E. Temporal corrections and cache reconstruction

Explicit correction edges retain the superseded original and its exact author/message identity. Historical queries apply an as-of boundary; current queries reject unresolved contradictory authorities instead of selecting the most similar old text. Damaged correction evidence must not resurrect its predecessor.

For literal user fields (`decision: field=A`, followed by `correction: field=B`), both the exact archive and derived hot view reconstruct B while A remains available historically. Existing explicit TaskContext supersession is also captured when supported by an actual preserved owner message. Unstructured corrections remain exact correction evidence but do not acquire invented targets or entity aliases. A missing target is UNKNOWN; the execution model can retrieve the original before resolving it.

Derived TaskContext/summary/cache records are never substituted for raw source evidence. Raw TaskContext itself is not overwritten during hot-state reconstruction.

## F. Execution-time page fault

A fresh execution starts with the objective, constraints, current task state, recent turns and source locators—not all past messages or retained source payloads. The capability card tells the model to call memory_query if a required dependency is missing. RPC returns exact evidence plus provenance/coverage/conflict state. The same execution then continues. Missing/corrupt/out-of-scope/budget-exhausted retrieval returns UNKNOWN, not a generated reconstruction.

The actual RPC handler, compiled native configuration and GUI handoff have deterministic tests. No paid provider round trip is necessary for those checks. Actual provider choice to invoke the tool, intra-turn provider behavior and owner acceptance are separate live observations, not claimed by a fixture.

## G. Context budgets and pricing

Defaults are OS-1 working-footprint policy, not universal vendor limits:

- soft: 240,000
- hard: 272,000
- retrieval: 24,000
- essential active state: 8,000
- reserved overhead: 8,000
- minimum useful fresh-session saving: 8,000

Edit the four visible budgets using the conversation header **Context** control. Save affects subsequent requests only. **Fresh context on next request** preserves the OS-1 conversation and current run; its marker is consumed only after actual provider dispatch.

The optional JSON `provider_thresholds` list overrides exact model mappings (explicit provider/model, aliases, `maximum_input_tokens`, `pricing_threshold_tokens`, `comparison`, `disable_pricing_threshold`). Overrides are labeled owner configuration, not new official pricing evidence. Unknown model names do not inherit a known model's tariff.

Preflight counts the complete known text payload, policy/base instructions and reserved retrieval exposure using conservative UTF-8 bytes, explicitly labeled an estimate. It combines the last request input—not all historic tokens—with current estimated carry. Fresh-session rotation requires a preserved capability and a materially smaller fresh payload. An irreducible oversized request is held without truncation or repeated rotation. Existing native contexts with no trustworthy input measurement are moved to a fresh paged working context rather than silently treated as empty.

Codex receives `model_auto_compact_token_limit` with `model_auto_compact_token_limit_scope="total"`. Claude receives the supported integer `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, within its supported range. These are actual provider controls, not proof of exact future multimodal/tool tokenization. Read-back native input usage updates the meter. Intra-turn growth depends on provider compaction; OS-1 does not claim byte estimates are an exact API token count or billing guarantee.

### Official sources checked 2026-10-04

For the explicitly registered current OpenAI models, input **>272,000** has input/cached-input rate **2x**, output **1.5x**. Exactly272,000 does not cross the tariff boundary. GPT-5.3-Codex's272K is a maximum input limit, not the same surcharge rule. New session IDs do not save money if the full transcript is reloaded. API list prices are not a Pro/Max/ChatGPT subscription invoice.

- https://developers.openai.com/api/docs/models/gpt-6.1-sol
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/models/gpt-5.3-codex
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/conversation-state
- https://learn.chatgpt.com/docs/config-file/config-reference

Current first-party Claude models do not share a universal200K premium. The retired legacy Sonnet4/4.5 extended beta is not a current surcharge policy. Pricing requires the resolved model identity, not just an alias such as opus. Subscription `/usage` list-price estimates are not an actual bill.

- https://platform.claude.com/docs/en/about-claude/pricing#long-context-pricing
- https://platform.claude.com/docs/en/release-notes/overview
- https://code.claude.com/docs/en/env-vars
- https://code.claude.com/docs/en/statusline#context-window-fields

## H. Tests and acceptance evidence

See `MEMORY_PAGING_VERIFICATION.md` for actual completed runs, exact release identity and installation/recovery receipt. The suite covers all ten requested test shapes plus actual GUI -> handoff -> immutable source -> hot reconstruction -> scoped RPC/receipt, native protocol projections, configuration, restart budgeting and private recovery. Test specifications and executed test receipts are separate.

## I. Remaining bounded failure modes

- A model can fail to notice a missing dependency or fail to call the tool. This is not silently presented as independently verified recall.
- Exact lexical retrieval is not broad multilingual semantic search. Query variants/thread navigation may be needed; UNKNOWN is preserved when evidence cannot be located.
- Ambiguous natural-language correction targets cannot safely be auto-linked. Only supported explicit links/fields gain supersession authority.
- Capture is bounded to64MiB per original. Unavailable/sensitive/oversized attachment references produce explicit omission records; originals are not deleted. Empty values remain in raw envelopes. Old native files unavailable at capture remain at their original local location and are not claimed as recovered memory.
- Image/tool costs not exposed before execution remain estimated/unknown. Native compaction controls reduce growth but do not guarantee a precise future premium boundary or subscription charge.
- This private local recovery drill is not another-Mac activation or remote disaster recovery. R2 source backup and local private-data recovery evidence must be reported separately.
- No Handy paths, processes, settings, audio, IPC or recovery state are accessed by this implementation.

## J. Example

Earlier exact owner message: `decision: utility=92/128`.
Later exact correction: `correction: utility=60/128`.

User asks “지금 utility가 뭐야?” after a fresh-context handoff.

Execution calls LATEST_STATE with object_id `decision-field:utility`. It receives the exact later source message, its original message ID/time/hash and current status. To answer “원래 수치는?” it calls HISTORICAL_STATE with the appropriate as_of boundary;92/128 remains available. Neither value is replaced by “utility decreased”. A private receipt replays the exact returned byte ranges.

## Research mechanism

ReAct and intrinsic self-correction limitations were actually inspected. The implementation uses external stored evidence, deterministic transition checks and replay—not generated introspection as proof:
https://arxiv.org/html/2210.03629v3
https://arxiv.org/html/2310.01798v2
