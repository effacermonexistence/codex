#!/usr/bin/env node
// One explicitly pinned, read-only live backend turn in an empty test workspace.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const [runtime, workspace, context, output] = process.argv.slice(2);
assert(runtime && workspace && context && output, 'runtime empty-workspace handoff-json report');
assert.equal(readdirSync(workspace).length, 0);
const before = readFileSync(context);
const child = spawnSync(runtime, ['run', '--workspace', workspace, '--context-file', context,
  '--prompt', '이전 대화에서 확인한 테스트 자료의 marker, service state, unfinished gate를 원문 값 그대로 세 줄로 다시 적어주세요. 새로운 조회, 파일 변경, 배포는 하지 마세요.',
  '--provider', 'codex', '--read-only-reconciliation', '--desktop-reveal', 'never', '--output-format', 'json'],
  { encoding: 'utf8', timeout: 180000, maxBuffer: 2000000 });
const report = { timestamp: new Date().toISOString(), exitCode: child.status,
  result: child.stdout ? JSON.parse(child.stdout) : null, error: child.stderr,
  limitation: 'One synthetic cross-provider handoff; not all-task or failure-recovery proof.' };
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
assert.equal(child.status, 0);
assert.equal(report.result.status, 'complete');
assert.equal(report.result.steps.length, 1);
const step = report.result.steps[0];
assert.equal(step.provider, 'codex');
assert.equal(step.permission_profile, 'read_only');
assert.equal(step.native_record.persistence, 'verified');
assert.equal(step.native_record.desktop_visibility, 'not_revealed');
for (const expected of ['orchard-lantern-29', 'staging verified', 'production not deployed',
  'independent read-only production fingerprint check']) assert(step.output.includes(expected));
assert(readFileSync(context).equals(before));
assert.equal(readdirSync(workspace).length, 0);
console.log(JSON.stringify({status:'PASS',checks:13,backendExecutions:1,
  provider:step.provider,model:step.model,effort:step.effort,sessionID:step.session_id,
  durationMS:step.duration_ms,record:step.native_record.record_path,turn:step.native_record.turn_id}));
