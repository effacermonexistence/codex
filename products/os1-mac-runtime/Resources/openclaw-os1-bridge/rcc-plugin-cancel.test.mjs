import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {nativeOperation} from './rcc-plugin.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'os1-rcc-cancel-fixture-'));
  await chmod(root, 0o700);
  const home = join(root, 'home');
  await mkdir(home, {mode: 0o700});
  const worker = join(home, 'worker.mjs');
  await writeFile(worker, `
    import {existsSync, writeFileSync} from 'node:fs';
    const marker = process.env.OS1_CANCEL_FILE;
    const done = process.env.HOME + '/worker.done';
    const tick = setInterval(() => {
      if (marker && existsSync(marker)) {
        writeFileSync(done, 'cancel observed'); clearInterval(tick); process.exit(0);
      }
    }, 10);
  `, {mode: 0o600});
  const native = join(root, 'fake-os1-native');
  const script = `#!${process.execPath}
    const fs = require('node:fs');
    const {spawn} = require('node:child_process');
    if (!['rcc-adapter', 'rcc-stage'].includes(process.argv[2]) ||
        process.argv[3] !== '--ticket-file') process.exit(79);
    const input = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
    if (!process.env.OS1_CANCEL_FILE) process.exit(80);
    const home = process.env.HOME;
    process.on('SIGTERM', () => {
      fs.writeFileSync(home + '/term.receipt', 'term received');
      if (input.mode !== 'ignore') process.exit(143);
    });
    if (input.mode === 'ignore') {
      fs.writeFileSync(home + '/ready.json', JSON.stringify({pid: process.pid}));
      setInterval(() => {}, 1000);
    } else {
      const worker = spawn(process.execPath, [home + '/worker.mjs'], {env: process.env, stdio:'ignore'});
      fs.writeFileSync(home + '/ready.json', JSON.stringify({pid: process.pid, workerPid: worker.pid}));
      worker.once('exit', code => {
        process.stdout.write(JSON.stringify({interrupted: code === 0, workerExit: code}));
        process.exit(code === 0 ? 0 : 81);
      });
    }
  `;
  await writeFile(native, script, {mode: 0o700});
  await chmod(native, 0o700);
  const prior = Object.fromEntries(['OS1_RCC_NATIVE_PATH', 'OS1_RCC_NATIVE_SHA256',
    'OS1_RCC_STATE_ROOT', 'OS1_RCC_NATIVE_HOME'].map(key => [key, process.env[key]]));
  process.env.OS1_RCC_NATIVE_PATH = native;
  process.env.OS1_RCC_NATIVE_SHA256 = sha(Buffer.from(script));
  process.env.OS1_RCC_STATE_ROOT = root;
  process.env.OS1_RCC_NATIVE_HOME = home;
  t.after(async () => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, {recursive: true, force: true});
  });
  async function ready() {
    for (let i = 0; i < 200; i++) {
      try { return JSON.parse(await readFile(join(home, 'ready.json'), 'utf8')); }
      catch { await pause(10); }
    }
    throw Error('fake_native_not_ready');
  }
  return {root, home, ready};
}

for (const command of ['rcc-adapter', 'rcc-stage']) {
test(`${command}: abort writes exact private marker before SIGTERM; fake descendant exits and one record returns`,
  {concurrency: false, timeout: 8_000}, async t => {
    const {root, home, ready} = await setup(t);
    const controller = new AbortController();
    const operation = nativeOperation(command, {mode: 'graceful'}, controller.signal,
      {cancelGraceMs: 500, cancelKillMs: 100});
    const {pid, workerPid} = await ready();
    controller.abort();
    const record = await operation;
    assert.deepEqual(record, {interrupted: true, workerExit: 0});
    assert.equal((await readFile(join(home, 'worker.done'), 'utf8')), 'cancel observed');
    await assert.rejects(stat(join(home, 'term.receipt')), {code: 'ENOENT'});
    const markers = (await readdir(join(root, 'native-inputs')))
      .filter(item => item.endsWith('.cancel'));
    assert.equal(markers.length, 1, 'cancel tombstone remains until external descendant reconciliation');
    assert.equal((await stat(join(root, 'native-inputs', markers[0]))).mode & 0o777, 0o600);
    for (const childPID of [pid, workerPid]) {
      assert.throws(() => process.kill(childPID, 0), {code: 'ESRCH'});
    }
  });

test(`${command}: noncooperative exact direct child receives bounded TERM/KILL; no success receipt invented`,
  {concurrency: false, timeout: 8_000}, async t => {
    const {home, ready} = await setup(t);
    const controller = new AbortController();
    const operation = nativeOperation(command, {mode: 'ignore'}, controller.signal,
      {cancelGraceMs: 100, cancelKillMs: 100});
    const {pid} = await ready();
    controller.abort();
    await assert.rejects(operation, /native_operation_failed/);
    assert.equal((await readFile(join(home, 'term.receipt'), 'utf8')), 'term received');
    assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
  });
}
