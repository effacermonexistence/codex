#!/usr/bin/env node
// Read-only exact-turn accounting audit. No models, credentials or mutations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [runtime, record, turn, reportPath] = process.argv.slice(2);
assert(runtime && record && turn && reportPath, 'runtime native-jsonl turn-uuid report');
const data = readFileSync(record);
const rows = data.toString('utf8').trim().split('\n').map(JSON.parse);
const explicit = rows.filter(row => row.type === 'token_usage_record' &&
  row.payload?.turn_id === turn && row.payload.turn_token_usage);
assert(explicit.length, 'independent cumulative native usage evidence required');
const final = explicit.at(-1).payload.turn_token_usage;
const actual = JSON.parse(execFileSync(runtime, ['audit-codex-usage', record, turn],
  { encoding: 'utf8', timeout: 45000, maxBuffer: 200000 }));
assert.equal(actual.input_tokens, final.input_tokens);
assert.equal(actual.output_tokens, final.output_tokens);
assert.equal(actual.cache_tokens, final.cached_input_tokens + final.cache_write_input_tokens);
assert.equal(actual.resource.usage_record_count, 1, 'one final cumulative representation');
assert.equal(actual.resource.accounting_version, 2);
assert.equal(actual.resource.byte_count, data.length);
assert.equal(actual.resource.sha256, createHash('sha256').update(data).digest('hex'));
assert(readFileSync(record).equals(data), 'native record preserved');
const report = { timestamp: new Date().toISOString(), status: 'PASS', checks: 8,
  turn, measured: actual, modelCalls: 0,
  limitation: 'Exact native-token accounting, not billing currency or global route optimality.' };
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({status: report.status, checks: report.checks,
  input: actual.input_tokens, output: actual.output_tokens, cache: actual.cache_tokens, modelCalls: 0}));
