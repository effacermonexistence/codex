#!/usr/bin/env node
// Self-tests must not depend on, or write into, the owner's live environment.
//
// Build 326 failed staging because every fixture SessionStore copied the
// owner's settings.json (`parallelRunLimit` 12 broke the parallel suite's
// "exactly four" admission) and accounts.json, and the staged suites wrote
// fixture activity into the owner's live run journal. This runs the app
// self-test suites against a temporary home whose settings carry a cap of
// 1, 12 or nothing, non-default surfaces, Codex switched off and an added
// active Claude account, while the process carries a live run's OS1_*
// variables pointing at sentinel files. Every suite must pass, every
// sentinel must stay byte-identical, the cancel marker must stay absent, and
// the temporary home's settings/accounts must be untouched.
//
// Isolation mechanism (no test-only code path in OS-1): OS1Settings.defaultURL
// and BackendAccounts.storeURL resolve FileManager.homeDirectoryForCurrentUser.
// On macOS that ignores $HOME but honours CoreFoundation's CFFIXED_USER_HOME
// (checked: a binary printing it reports the fake home only for the latter).
// The test sets both, HOME for git/python/node children. Production never
// sets CFFIXED_USER_HOME. Nothing here reads or writes the real home.
//
// Usage (from products/os1-mac-runtime, after `swift build`):
//   node scripts/test-self-test-isolation.mjs [--app .build/debug/OS1App]
//     [--suites --self-test,--self-test-parallel] [--caps 1,12,none]
//     [--parallel-repeats N] [--os1 .build/debug/os1 --runtime]
// `--runtime` also runs `os1 self-test` and `os1 fleet-self-test` in the
// isolated home (fleet with OS1_CONFIG = Config/production.json, the file the
// release installs as the bundle config).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const runtimeRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
function option(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
}
const app = path.resolve(option('--app', path.join(runtimeRoot, '.build/debug/OS1App')));
const os1 = path.resolve(option('--os1', path.join(runtimeRoot, '.build/debug/os1')));
const allSuites = ['--self-test', '--self-test-shell', '--self-test-composer', '--self-test-steering',
  '--self-test-sidebar-queue', '--self-test-queue-fork', '--self-test-parallel'];
const suites = option('--suites', allSuites.join(',')).split(',').filter(Boolean);
const caps = option('--caps', '1,12,none').split(',').filter(Boolean);
const parallelRepeats = Math.max(1, Number(option('--parallel-repeats', '1')));
const runRuntime = argv.includes('--runtime');
for (const binary of runRuntime ? [app, os1] : [app]) assert.ok(fs.existsSync(binary), `missing ${binary}; run swift build first`);

const sentinel = 'owner live-run state must survive fixture execution\n';
const results = [];

function makeHome(root, cap) {
  // realpath: CFFIXED_USER_HOME is used verbatim, and the account home check
  // compares paths as strings.
  const home = path.join(fs.realpathSync(root), 'home');
  const support = path.join(home, 'Library/Application Support/OS-1');
  fs.mkdirSync(support, { recursive: true, mode: 0o700 });
  const files = {};
  if (cap !== 'none') {
    const settings = { interfaceLanguage: 'en', outputLanguage: 'auto', showCodex: false,
      burnCodexBeforeReset: false, parallelRunLimit: Number(cap),
      openAISurface: 'chatgpt', anthropicSurface: 'claude-chat' };
    const added = crypto.randomUUID();
    const accounts = {
      accounts: [{ id: added, provider: 'claude', label: 'Isolation fixture', signedIn: false,
        homePath: path.join(support, 'accounts/claude', added) }],
      active: { claude: added },
    };
    files.settings = path.join(support, 'settings.json');
    files.accounts = path.join(support, 'accounts.json');
    fs.writeFileSync(files.settings, JSON.stringify(settings, null, 2), { mode: 0o600 });
    fs.writeFileSync(files.accounts, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  }
  return { home, files };
}

function snapshot(paths) {
  return Object.fromEntries(Object.entries(paths).map(([key, file]) => [key, fs.readFileSync(file)]));
}

function runOne(label, cap, executable, args, extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'os1-self-test-isolation-'));
  try {
    const { home, files } = makeHome(root, cap);
    const live = {
      OS1_ACTIVITY_FILE: path.join(root, 'live-activity.json'),
      OS1_EVENT_JOURNAL: path.join(root, 'live-journal.jsonl'),
      OS1_FAILURE_FILE: path.join(root, 'live-failure.json'),
    };
    for (const file of Object.values(live)) fs.writeFileSync(file, sentinel, { mode: 0o600 });
    const cancelMarker = path.join(root, 'live-cancel-marker');
    const before = snapshot(files);
    const env = { ...process.env, CFFIXED_USER_HOME: home, HOME: home, ...live,
      OS1_CANCEL_FILE: cancelMarker, OS1_SUBMISSION_ID: crypto.randomUUID().toUpperCase(),
      OS1_SUBMISSION_STARTED_AT: String(Date.now() / 1000), OS1_CONVERSATION_ID: crypto.randomUUID().toUpperCase(),
      ...extraEnv };
    for (const key of Object.keys(env)) if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key];
    const started = Date.now();
    const result = spawnSync(executable, args, { env, cwd: root, encoding: 'utf8', timeout: 900_000,
      maxBuffer: 32 * 1024 * 1024 });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const problems = [];
    if (result.error) problems.push(String(result.error));
    if (result.status !== 0) {
      const lines = (text) => (text ?? '').split('\n').filter((line) => line && !/hiservices|Connection invalid/.test(line));
      const reason = lines(result.stderr).slice(-2);
      problems.push(`exit ${result.status}: ${(reason.length ? reason : lines(result.stdout).slice(-2)).join(' | ')}`);
    }
    for (const [key, file] of Object.entries(live)) {
      if (fs.readFileSync(file, 'utf8') !== sentinel) problems.push(`${key} (live run) was written`);
    }
    if (fs.existsSync(cancelMarker)) problems.push('the live run cancel marker was created');
    const after = snapshot(files);
    for (const key of Object.keys(before)) {
      if (!before[key].equals(after[key])) problems.push(`the home's ${key} file was rewritten`);
    }
    results.push({ label, cap, seconds, problems });
    console.log(`${problems.length ? 'FAIL' : 'PASS'} ${label} [cap ${cap}] ${seconds}s${problems.length ? ' :: ' + problems.join('; ') : ''}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

for (const cap of caps) {
  for (const suite of suites) {
    const repeats = suite === '--self-test-parallel' ? parallelRepeats : 1;
    for (let attempt = 1; attempt <= repeats; attempt += 1) {
      runOne(`OS1App ${suite}${repeats > 1 ? ` #${attempt}` : ''}`, cap, app, [suite]);
    }
  }
  if (runRuntime) {
    runOne('os1 self-test', cap, os1, ['self-test']);
    runOne('os1 fleet-self-test', cap, os1, ['fleet-self-test'],
      { OS1_CONFIG: path.join(runtimeRoot, 'Config/production.json') });
  }
}
const failed = results.filter((entry) => entry.problems.length);
console.log(`${results.length - failed.length}/${results.length} isolated self-test runs passed`);
if (failed.length) process.exit(1);
console.log('PASS: self-tests ignore the home\'s settings/accounts and never write a live run\'s journal, activity, failure or cancel files');
