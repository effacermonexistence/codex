#!/usr/bin/env node
/** Offline replay of recorded Auto arithmetic tasks against Core's zero-model
 * closed arithmetic (K7, os1-closed-arithmetic-v1). D1 only: never bundled,
 * never a release gate (it reads private task history).
 *
 *   node scripts/arithmetic-replay.mjs --snapshots <checkpointed rcc-runtime.sqlite copy> [--out <new file>]
 *
 * The routing ledger stores no request text, so the input is a checkpointed
 * copy of the Core store (no -wal/-shm beside it; opened immutable and
 * read-only through route-replay's readSnapshotsDB). For every recorded Auto
 * task whose request zeroModelArithmetic accepts:
 *  - a task Core already answered with its local-core child must hold exactly
 *    the same output (a widened grammar never changes an old answer);
 *  - a task a model answered must, after the legacy closed-task output
 *    normalisation (TaskQuality.closedArithmeticOutput: header, "answer:"
 *    and "입니다" wrappers, a final '.', ** or ` around it, or "EXPR = N"),
 *    equal the exact value; an output that is not a plain number is reported
 *    as unparsed, never guessed;
 *  - the stored task is resubmitted, unchanged, to a fresh Core in a new
 *    temporary state directory whose catalog, planner, intent resolver and
 *    executor throw: the
 *    exact R1 gate (conversation, sessions, attachments, provider words,
 *    explicit routes) decides whether Core would now answer it with no model.
 *    The input store is never written; no provider, model or network is called.
 * Output: JSON with sorted keys (task_id and request_sha256 only, never request
 * or output text) on stdout or into --out (a new file, O_EXCL, 0600).
 * Exit codes (shared with route-replay.mjs and quota-replay.py): 0 PASS,
 * 1 FAIL (a changed old answer or a model answer that differs), 2 NO_EVIDENCE
 * (no accepted arithmetic task), 64 usage or input error.
 */
import {closeSync, constants, openSync, realpathSync, writeSync} from 'node:fs';
import {chmod, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRCCRuntime, zeroModelArithmetic} from '../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {EXIT, canonicalJSON, readSnapshotsDB} from './route-replay.mjs';

const NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
/** A decimal string as an exact rational {n, d}. */
function rational(text) {
  const negative = text.startsWith('-'), body = text.replace(/^[+-]/, '');
  const [int, frac = ''] = body.split('.');
  const n = BigInt(int + frac);
  return {n: negative ? -n : n, d: 10n ** BigInt(frac.length)};
}
const same = (a, b) => { const x = rational(a), y = rational(b); return x.n * y.d === y.n * x.d; };
/** The legacy closed-task normalisation (TaskQuality.closedArithmeticOutput),
 * returning the number a model output states, or null. */
export function statedNumber(output) {
  if (typeof output !== 'string') return null;
  let text = output.trim();
  text = text.replace(/^Ben\.\s*\nLuaIsHere\s*:3\s*\n/i, '');
  text = text.replace(/^(?:the answer is|answer|result|답|정답)(?:은|는)?\s*[:：]?\s*/i, '');
  text = text.replace(/(?:입니다|이다|예요|야)[.!]?$/u, '').trim();
  if (text.endsWith('.')) text = text.slice(0, -1).trim();
  for (const wrapper of ['**', '`'])
    if (text.length >= wrapper.length * 2 && text.startsWith(wrapper) && text.endsWith(wrapper))
      text = text.slice(wrapper.length, -wrapper.length).trim();
  if (NUMBER.test(text)) return text;
  const equation = /^([^=;\n]+)\s*=\s*([+-]?\d+(?:\.\d+)?)$/.exec(text);
  return equation ? equation[2] : null;
}

/** The replay report over parsed snapshots, `gate(task)` resolving to true
 * when a fresh Core answers the stored task with no model. */
export async function replayArithmetic(snapshots, gate) {
  const counts = {tasks: snapshots.length, unreadable: 0, auto: 0, accepted: 0,
    local_core: {identical: 0, different: 0}, model: {equal: 0, different: 0, unparsed: 0, undelivered: 0},
    gate: {zero_model: 0, routed: 0, rejected: 0}, would_turn_zero_model: 0};
  const findings = [];
  for (const row of snapshots) {
    let snapshot;
    try { snapshot = JSON.parse(row.snapshot); } catch { counts.unreadable++; continue; }
    const task = snapshot?.task;
    if (task?.mode !== 'auto' || typeof task.request !== 'string') { if (!task) counts.unreadable++; continue; }
    counts.auto++;
    const answer = zeroModelArithmetic(task.request);
    if (answer === null) continue;
    counts.accepted++;
    const id = {task_id: row.task_id, request_sha256: task.request_sha256 ?? null};
    const children = Array.isArray(snapshot.children) ? snapshot.children : [];
    const localCore = children.length === 1 && children[0]?.id === 'local-core';
    const output = snapshot.result?.output;
    if (localCore) {
      if (output === answer) counts.local_core.identical++;
      else { counts.local_core.different++; findings.push({...id, finding: 'local_core_answer_changed'}); }
    } else if (typeof output !== 'string') {
      counts.model.undelivered++;
    } else {
      const stated = statedNumber(output);
      if (stated === null) { counts.model.unparsed++; findings.push({...id, finding: 'model_output_unparsed'}); }
      else if (same(stated, answer)) counts.model.equal++;
      else { counts.model.different++; findings.push({...id, finding: 'model_answer_differs'}); }
    }
    let verdict;
    try { verdict = await gate(task) ? 'zero_model' : 'routed'; } catch { verdict = 'rejected'; }
    counts.gate[verdict]++;
    if (verdict === 'zero_model' && !localCore) counts.would_turn_zero_model++;
    if (verdict !== 'zero_model') findings.push({...id, finding: 'gate_' + verdict});
  }
  const failed = counts.local_core.different + counts.model.different > 0;
  const verdict = failed ? 'FAIL' : counts.accepted === 0 ? 'NO_EVIDENCE' : 'PASS';
  return {schema: 1, grammar: 'os1-closed-arithmetic-v1', verdict,
    exit_code: failed ? EXIT.fail : counts.accepted === 0 ? EXIT.no_evidence : EXIT.pass,
    counts, findings: findings.sort((a, b) => a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 :
      a.finding < b.finding ? -1 : a.finding > b.finding ? 1 : 0)};
}

/** A fresh Core in a temporary directory whose callbacks throw: whether the
 * stored task completes through the local-core zero-model child. */
export async function freshCoreGate() {
  const dir = await mkdtemp(join(tmpdir(), 'os1-arithmetic-replay-'));
  await chmod(dir, 0o700);
  const refuse = name => async () => { throw Error(`arithmetic replay: ${name} is never called`); };
  const runtime = await createRCCRuntime({stateDir: dir, catalog: refuse('catalog'), plan: refuse('plan'),
    execute: refuse('execute'), resolveIntent: refuse('resolveIntent')});
  const gate = async task => {
    await runtime.submit(structuredClone(task));
    const done = await runtime.wait({schema: 1, task_id: task.task_id}, {timeoutMs: 10_000});
    return done.state === 'completed' && done.children.length === 1 && done.children[0].id === 'local-core';
  };
  const close = async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); };
  return {gate, close};
}

function usage(message) { return Object.assign(new Error(message), {code: 'route_replay_input'}); }
export async function main(argv) {
  try {
    const options = {};
    for (let index = 0; index < argv.length; index += 2) {
      const [name, value] = [argv[index], argv[index + 1]];
      if (!['--snapshots', '--out'].includes(name)) throw usage('unknown argument: ' + name);
      if (value === undefined || value.startsWith('--')) throw usage(name + ' needs a value');
      if (Object.hasOwn(options, name)) throw usage(name + ' given twice');
      options[name] = value;
    }
    if (options['--snapshots'] === undefined)
      throw usage('usage: arithmetic-replay.mjs --snapshots <checkpointed rcc-runtime.sqlite copy> [--out <new file>]');
    const {rows, sha256} = await readSnapshotsDB(options['--snapshots']);
    const core = await freshCoreGate();
    let report;
    try { report = await replayArithmetic(rows, core.gate); } finally { await core.close(); }
    report.inputs = {snapshots: {path: options['--snapshots'], sha256}};
    const text = canonicalJSON(report) + '\n';
    if (options['--out'] === undefined) process.stdout.write(text);
    else {
      let fd;
      try {
        fd = openSync(resolve(options['--out']),
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      } catch (error) { throw usage(`cannot create --out ${options['--out']}: ${error.code ?? error.message}`); }
      try { writeSync(fd, text); } finally { closeSync(fd); }
    }
    process.stderr.write(`arithmetic-replay: ${report.verdict} (${report.counts.accepted} accepted, ` +
      `${report.counts.would_turn_zero_model} would turn zero-model)\n`);
    return report.exit_code;
  } catch (error) {
    process.stderr.write(`arithmetic-replay: ${error.code === 'route_replay_input' ? error.message :
      'internal error: ' + (error?.stack ?? error)}\n`);
    return EXIT.usage;
  }
}

const invoked = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invoked) process.exitCode = await main(process.argv.slice(2));
