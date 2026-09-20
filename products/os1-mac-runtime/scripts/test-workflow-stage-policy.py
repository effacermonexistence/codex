#!/usr/bin/env python3
"""Verify exported Swift phase objectives against an explicitly supplied policy.
No provider calls, secrets, or assumed historical policy state.
"""
import importlib, json, re, sys
from pathlib import Path
if len(sys.argv) != 2:
    raise SystemExit('usage: test-workflow-stage-policy.py PRIVATE_POLICY_SOURCE_DIRECTORY')
sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
policy = importlib.import_module('os1_local_core')
policy._private_log = lambda *args: None
source = (Path(__file__).resolve().parents[1] / 'Sources/OS1Context/TaskWorkflow.swift').read_text()
section = source.split('public var routingTask: String')[1].split('public var')[0]
phases = dict(re.findall(r'case \.(\w+):\s*return "([^"]+)"', section))
assert set(phases) == {'architecture', 'implementation', 'verification'}
profiles = {}
for phase, prompt in phases.items():
    route = policy.route(dict(prompt=prompt, provider_preference='auto', codex_capacity=100, claude_capacity=0, attempt=1))
    profiles[phase] = route['verification_profile']
    assert (profiles[phase] == 'executed_change') == (phase == 'implementation'), (phase, profiles)
# Positive control: writing remains writing; no broad weakening of the gate.
for prompt in [phases['implementation'], 'app.py를 변경하고 테스트해']:
    assert policy.route(dict(prompt=prompt, provider_preference='auto', codex_capacity=100, claude_capacity=0, attempt=1))['verification_profile'] == 'executed_change'
# No-change review is valid; identical evidence cannot certify requested edits.
output = "Reviewed Sources/OS1Context/TaskWorkflow.swift and its tests. Architecture contract: retain workspace authority; evaluate each phase by its own deliverable. Acceptance requires a recorded final verdict and rollback boundaries."
for phase, prompt in phases.items():
    verdict = policy.verify(dict(prompt=prompt, output=output, verification_profile=profiles[phase], native_persistence='verified', exit_code=0, attempt=1, provider='codex', before_workspace_hash='same', after_workspace_hash='same'))
    assert (verdict['outcome'] == 'pass') == (phase != 'implementation'), (phase, verdict['outcome'])
print(json.dumps(dict(status='PASS', checks=8, profiles=profiles)))
