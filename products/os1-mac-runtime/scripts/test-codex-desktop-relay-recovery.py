#!/usr/bin/env python3
"""Deterministic failed-tool/observation wiring tests; no models or live state."""
from pathlib import Path
import subprocess, tempfile
root=Path(__file__).resolve().parents[1]
main=(root/'Sources/OS1/main.swift').read_text()
start=main.index('func desktopRelayFailedTools(')
end=main.index('\nfunc codexSessionTitle(',start)
function=main[start:end]
with tempfile.TemporaryDirectory(prefix='os1-relay-result-') as d:
 p=Path(d)/'main.swift'
 p.write_text('import Foundation\n'+function+"""
let failed: [String: Any] = ["type": "mcpToolCall", "server": "codex_app", "tool": "send_message_to_thread", "status": "failed"]
precondition(desktopRelayFailedTools([failed]) == ["send_message_to_thread"])
precondition(desktopRelayFailedTools([["type": "mcpToolCall", "server": "codex_app", "tool": "send_message_to_thread", "status": "completed", "error": NSNull()]]).isEmpty)
precondition(desktopRelayFailedTools([["type": "agentMessage", "text": "send_message_to_thread failed"]]).isEmpty)
precondition(desktopRelayFailedTools([["type": "mcpToolCall", "server": "codex_app", "tool": "read_thread", "status": "completed", "result": ["isError": true]]]) == ["read_thread"])
precondition(desktopRelayFailedTools([["type": "mcpToolCall", "server": "other", "tool": "send_message_to_thread", "status": "failed"]]).isEmpty)
precondition(desktopRelayFailedTools([["type": "mcpToolCall", "server": "codex_app", "tool": "send_message_to_thread", "status": "completed"]]).isEmpty)
precondition(desktopRelayFailedTools([["type": "mcpToolCall", "server": "codex_app", "tool": "read_thread", "error": ["message": "permission"]]]) == ["read_thread"])
print("PASS: 7 actual tool-state cases; prose cannot supply provenance")
""")
 subprocess.run(['swiftc',str(p),'-o',str(Path(d)/'test')],check=True)
 subprocess.run([str(Path(d)/'test')],check=True)
body=main.split('func runCodexDesktopTurn(',1)[1].split('struct CodexTurnOutput',1)[0]
assert 'if let observeTurnID {' in body
assert 'turnID = observeTurnID' in body
assert 'if observeTurnID == nil, let submission' in body
assert 'if interruptOnTimeout, observeTurnID == nil' in body
assert 'clientUserMessageID: clientUserMessageID' in body
probe=main.split('case "codex-desktop-probe":',1)[1].split('case "rcc-warmup":',1)[0]
assert 'store.createIntent(binding: binding)' in probe
assert 'store.acknowledge(binding: binding, turnID: id)' in probe
assert 'store.markPending(binding: binding' in probe
assert 'resume-checkpoint' in probe
assert 'no replay allowed' in probe
assert 'quota_zero_verified' in probe and 'false' in probe
assert 'native relay tool failed; no downstream adoption or replay' in probe
assert 'adoptResponse(' not in probe
print('PASS: observation-only, durable intent/ack, rejection and no fabricated GPT adoption wiring')
