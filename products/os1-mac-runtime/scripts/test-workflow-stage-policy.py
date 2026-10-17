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
# Regression: a truthful limitation in an architecture contract is not a failed executor.
limited = output + " 별도 app-server 기록만으로 Desktop에서 실행이 보인다고 보장할 수 없습니다. 동일 thread 연결을 구현해야 합니다."
for text in [output, limited]:
    assert not policy._executor_blocked(text), text
for text in ["현재 소스에 접근할 수 없습니다.", "요청한 작업을 실행할 수 없습니다.", "파일을 읽을 수 없습니다.", "자료를 가져올 수 없습니다."]:
    assert policy._executor_blocked(text), text
verdict = policy.verify(dict(prompt=phases['architecture'], output=limited, verification_profile=profiles['architecture'], native_persistence='verified', exit_code=0, attempt=1, provider='codex', before_workspace_hash='same', after_workspace_hash='same'))
assert verdict['outcome'] == 'pass', verdict['outcome']
# Review output length cannot substitute for an evidence contract, in any
# language. These are execution/delivery verdicts, not correctness grades.
review_checks = 0
for profile in ('executed_review', 'source_review'):
    for concise in ('Title: OS1 Native Desktop; Ready: present.', '제목: OS1 Native Desktop. Ready: 존재.', '存在', 'No matches.'):
        v = policy.verify(dict(prompt='Read the requested source and answer briefly.', output=concise, verification_profile=profile, native_persistence='verified', exit_code=0, attempt=1, provider='codex'))
        assert v['outcome'] == 'pass' and v['reason_code'] == 'REVIEW_EXECUTION_RECORDED', v
        review_checks += 1
    for output, persistence, exit_code in [('', 'verified', 0), ('Done', 'missing', 0), ('Done', 'verified', 1), ('파일을 읽을 수 없습니다.', 'verified', 0)]:
        v = policy.verify(dict(prompt='Read source.', output=output, verification_profile=profile, native_persistence=persistence, exit_code=exit_code, attempt=1, provider='codex'))
        assert v['outcome'] != 'pass', v
        review_checks += 1
print(json.dumps(dict(status='PASS', checks=15 + review_checks, profiles=profiles)))
# Executing a read/test command is not a requested workspace mutation.
# Keep provider execution separate from the artifact-change verifier.
read_requests = [
 'Codex로 실행해. 파일 수정·배포·네트워크 없이 /tmp/index.html 제목과 Ready 존재만 확인해. 먼저 진행 안내를 보내고 sleep 60 명령으로 60초 기다려. 이후 파일을 읽고 두 항목만 짧게 답해.',
 'Codex로 실행해. 파일 수정·배포 없이 index.html을 읽어.',
 'Run python3 --version and report the result. Do not modify files.',
 'Run the existing test suite without editing files.',
]
change_requests = [
 'Codex로 실행해. index.html을 수정하고 테스트해.',
 '파일 수정·배포·네트워크 없이 index.html을 확인해. 그 다음 report.txt를 작성해.',
 'Run `touch result.txt`.',
 'Do not deploy, but create app.py and test it.',
 'GitHub 연결해. R2 연결해.',
]
for text in read_requests + change_requests:
 r=policy.route(dict(prompt=text, provider_preference='codex', codex_capacity=100, claude_capacity=0, attempt=1))
 wants_change=text in change_requests
 assert (r['verification_profile']=='executed_change')==wants_change, (text,r['verification_profile'])
 v=policy.verify(dict(prompt=text,output='Title: OS1 Native Desktop; Ready: present.',verification_profile=r['verification_profile'],native_persistence='verified',exit_code=0,attempt=1,provider='codex',before_workspace_hash='same',after_workspace_hash='same'))
 assert (v['outcome']=='pass') != wants_change, (text,v['outcome'])
print(json.dumps(dict(status='PASS',effect_contract_cases=len(read_requests)+len(change_requests))))
