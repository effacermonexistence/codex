#!/usr/bin/env python3
"""Bounded source wiring regression. Does not inspect user state or call a model."""
from pathlib import Path
p=Path(__file__).resolve().parent.parent
main=(p/'Sources/OS1/main.swift').read_text()
app=(p/'Sources/OS1App/OS1App.swift').read_text()
paging=(p/'Sources/OS1Context/MemoryPaging.swift').read_text()
checks={
 'dispatch_uses_paged_handoff': 'pagingSessionHandoff(sessions[refreshed]' in app,
 'raw_batch_preserved': 'try MemoryPaging.recordBatch(captures' in app,
 'execution_page_fault': 'case "memory-mcp": memoryMCPCommand()' in main,
 'codex_native_memory_config': 'MemoryPaging.codexOverrides' in main,
 'claude_native_memory_config': 'MemoryPaging.claudeConfiguration' in main,
 'workflow_memory_lineage': 'memoryPaging: handoff.memoryPaging' in main,
 'review_memory_lineage': 'memoryPaging: (try? SessionHandoff.decode(context))?.memoryPaging' in main,
 'total_input_compaction': 'model_auto_compact_token_limit_scope=\\"total\\"' in main,
 'provider_usage_not_cumulative': 'ContextInputUsageParser.parseCodexJSONL(data, turnID: turn.turnID)' in main,
 'hash_bound_capability': 'receipt.allowedSessionIDs == reference.allowedSessionIDs' in paging,
 'execution_budget_lock': 'flock(lock, LOCK_EX)' in paging,
 'current_correction_reconstruction': 'activeDecisionLines = context.activeDecisions.filter' in paging,
 'hidden_reasoning_not_paged': '["text", "input_text", "output_text"]' in paging,
 'fixture_only_rpc': 'try memoryMCPSelfTest()' in main,
 'fixture_actual_gui_handoff': 'try memoryPagingHandoffSelfTest()' in app,
}
failed=[k for k,v in checks.items() if not v]
assert not failed, 'memory paging wiring mismatch: '+', '.join(failed)
print(f'OS1 memory paging source wiring: {len(checks)} checks OK; provider calls 0')
