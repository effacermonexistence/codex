import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join} from 'node:path';
import test from 'node:test';
import {nativeOperation} from './rcc-plugin.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const commands = new Map([
  ['rcc-catalog', '--request-file'], ['rcc-adapter', '--ticket-file'],
  ['rcc-stage', '--ticket-file'], ['rcc-install-status', '--request-file'],
  ['rcc-install-cancel', '--request-file'],
]);

// Every subprocess here is a pinned, private fixture. No OS-1 installation,
// real provider, model, external account, or live application is invoked.
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'os1-rcc-stage-transport-'));
  await chmod(root, 0o700);
  const home = join(root, 'home');
  await mkdir(home, {mode: 0o700});
  const native = join(root, 'fake-os1-native');
  const script = `#!${process.execPath}
    const fs = require('node:fs');
    const path = process.argv[4];
    const input = JSON.parse(fs.readFileSync(path, 'utf8'));
    const record = {operation: process.argv[2], flag: process.argv[3], path, input,
      inputMode: fs.statSync(path).mode & 0o777,
      inputDirectoryMode: fs.statSync(require('node:path').dirname(path)).mode & 0o777,
      home: process.env.HOME, adapterChild: process.env.OS1_RCC_ADAPTER_CHILD,
      cancelFile: process.env.OS1_CANCEL_FILE ?? null,
      // Capture only key names, never ambient credential values.
      environmentKeys: Object.keys(process.env).sort()};
    fs.appendFileSync(process.env.HOME + '/calls.jsonl', JSON.stringify(record) + '\\n');
    process.stdout.write(JSON.stringify(record));
  `;
  await writeFile(native, script, {flag: 'wx', mode: 0o700});
  const keys = ['OS1_RCC_NATIVE_PATH', 'OS1_RCC_NATIVE_SHA256', 'OS1_RCC_STATE_ROOT',
    'OS1_RCC_NATIVE_HOME', 'OS1_CANCEL_FILE', 'OS1_RCC_PUBLIC_POLICY',
    'OPENCLAW_GATEWAY_TOKEN', 'OPENCLAW_CONFIG_PATH', 'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_AUTH_TOKEN'];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {OS1_RCC_NATIVE_PATH: native, OS1_RCC_NATIVE_SHA256: sha(script),
    OS1_RCC_STATE_ROOT: root, OS1_RCC_NATIVE_HOME: home});
  for (const key of keys.slice(4)) process.env[key] = 'synthetic-fixture-sentinel';
  t.after(async () => {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, {recursive: true, force: true});
  });
  return {root, home, native, script};
}

test('pinned native allowlist transports stage ticket and install requests with exact flags and private custody',
  {concurrency: false}, async t => {
    const {root, home} = await setup(t);
    for (const [command, flag] of commands) {
      const payload = command === 'rcc-stage' ? {ticket: {task_id: 'fixture-task'},
        parent_record_path: join(root, 'native-receipts', 'fixture.json'),
        parent_record_sha256: sha('fixture-parent')} : {schema: 1, task_id: 'fixture-task'};
      const record = await nativeOperation(command, payload);
      assert.equal(record.operation, command);
      assert.equal(record.flag, flag);
      assert.deepEqual(record.input, payload, 'transport must not rewrite ticket/request');
      assert.equal(dirname(record.path), join(root, 'native-inputs'));
      assert.match(basename(record.path), /^[a-f0-9-]{36}\.json$/);
      assert.equal(record.inputMode, 0o600);
      assert.equal(record.inputDirectoryMode, 0o700);
      assert.equal(record.home, home);
      assert.equal(record.adapterChild, '1');
      assert.equal(record.cancelFile,
        ['rcc-adapter', 'rcc-stage'].includes(command) ? record.path + '.cancel' : null,
        'only long-running adapter/stage receive their exact cancellation marker');
      for (const key of ['OS1_RCC_NATIVE_PATH', 'OS1_RCC_NATIVE_SHA256', 'OS1_RCC_STATE_ROOT',
        'OS1_RCC_NATIVE_HOME', 'OS1_RCC_PUBLIC_POLICY', 'OPENCLAW_GATEWAY_TOKEN',
        'OPENCLAW_CONFIG_PATH', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_AUTH_TOKEN']) {
        assert.equal(record.environmentKeys.includes(key), false, `${key} must not cross native boundary`);
      }
      await assert.rejects(stat(record.path), {code: 'ENOENT'});
      await assert.rejects(stat(record.path + '.cancel'), {code: 'ENOENT'});
    }
    const files = await readdir(join(root, 'native-inputs'));
    assert.equal(files.length, commands.size);
    assert(files.every(name => name.endsWith('.json.stderr')),
      'successful operations leave only private raw stderr, not executable requests');
    for (const file of files) assert.equal((await stat(join(root, 'native-inputs', file))).mode & 0o777, 0o600);
  });

test('unknown native operation is denied before spawn or input creation', {concurrency: false}, async t => {
  const {root, home} = await setup(t);
  for (const command of ['rcc-install', 'rcc-install-apply', 'rcc-stage; echo unsafe', 'status', '']) {
    await assert.rejects(nativeOperation(command, {}), /native_operation_denied/);
  }
  await assert.rejects(stat(join(home, 'calls.jsonl')), {code: 'ENOENT'});
  await assert.rejects(stat(join(root, 'native-inputs')), {code: 'ENOENT'});
});

test('stage/status/cancel require the unchanged pinned native hash; no path fallback or spawn',
  {concurrency: false}, async t => {
    const {root, home, native, script} = await setup(t);
    await writeFile(native, script + '\n// altered identity\n', {mode: 0o700});
    for (const command of ['rcc-stage', 'rcc-install-status', 'rcc-install-cancel']) {
      await assert.rejects(nativeOperation(command, {}), /native_identity_changed/);
    }
    await assert.rejects(stat(join(home, 'calls.jsonl')), {code: 'ENOENT'});
    await assert.rejects(stat(join(root, 'native-inputs')), {code: 'ENOENT'});
    process.env.OS1_RCC_NATIVE_PATH = 'fake-os1-native';
    await assert.rejects(nativeOperation('rcc-stage', {}), /native_identity_unavailable/);
    process.env.OS1_RCC_NATIVE_PATH = native;
    process.env.OS1_RCC_NATIVE_SHA256 = 'NOT_A_HASH';
    await assert.rejects(nativeOperation('rcc-install-status', {}), /native_identity_unavailable/);
  });

test('stage cannot execute a symlink substituted for its pinned native file',
  {concurrency: false}, async t => {
    const {root, home, native} = await setup(t);
    const linked = join(root, 'native-symlink');
    await symlink(native, linked);
    process.env.OS1_RCC_NATIVE_PATH = linked;
    await assert.rejects(nativeOperation('rcc-stage', {}), error => error.code === 'ELOOP');
    await assert.rejects(stat(join(home, 'calls.jsonl')), {code: 'ENOENT'});
  });
