#!/usr/bin/env node
import assert from 'node:assert/strict';
import { os1ProcessRows } from './install-local-verified.mjs';
let checks = 0;
const check = fn => { fn(); checks++; };
const inventory = (results, calls = []) => (exe, args) => {
  calls.push([exe, args]);
  assert(results.length, 'unexpected process invocation');
  return results.shift();
};
const calls = [];
const rows = os1ProcessRows(inventory([
  { status: 0, stdout: '41\n73\n41\n' },
  { status: 0, stdout: '41 /Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App\n73 /private/fixture/os1 memory-mcp\n' },
], calls));
check(() => assert.deepEqual(calls[0], ['/usr/bin/pgrep', ['-a', '-x', '(OS1App|os1)']]));
check(() => assert.deepEqual(calls[1], ['/bin/ps', ['-p', '41,73', '-o', 'pid=,args=']]));
check(() => assert.equal(rows.length, 2));
check(() => assert.deepEqual(os1ProcessRows(inventory([{ status: 1, stdout: '' }])), []));
check(() => assert.deepEqual(os1ProcessRows(inventory([
  { status: 0, stdout: '41\n' }, { status: 1, stdout: '' },
]), () => true), []));
check(() => assert.throws(() => os1ProcessRows(inventory([
  { status: 0, stdout: '41\n' }, { status: 1, stdout: '' },
]), () => false)));
check(() => assert.throws(() => os1ProcessRows(inventory([
  { status: 0, stdout: '41\n' }, { status: 1, stdout: '', stderr: 'fixture diagnostic' },
]), () => true)));
check(() => assert.throws(() => os1ProcessRows(inventory([
  { status: 1, stdout: '41\n' },
]))));
for (const result of [
  { status: 2, stdout: '' }, { status: null, error: new Error('fixture failure') },
  { status: 0, stdout: '41 all\n' }, { status: 0, stdout: '' },
]) check(() => assert.throws(() => os1ProcessRows(inventory([result]))));
check(() => assert.throws(() => os1ProcessRows(inventory([
  { status: 0, stdout: '41\n' }, { status: 2, stdout: '' },
]))));
check(() => assert.throws(() => os1ProcessRows(inventory([
  { status: 0, stdout: '41\n' }, { status: null, error: new Error('fixture failure') },
]))));
console.log(`OS1 local installer process scope: ${checks} checks PASS; mocks only, no live process or data access`);
