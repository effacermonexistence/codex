#!/usr/bin/env node
// Installs an OS-1 machine image on this Mac, or reports how this Mac differs
// from it. Every file it replaces or moves aside is first preserved under
// ~/.os1/recovery/machine-sync-*/; a failure before activation restores it.
// The OS-1 app itself goes through the verified installer self-update uses
// (idle gate, signature check, self-tests, conversation preservation).
//
//   install.mjs --image DIR --role air|pro [--verify-only] [--change-role]
//   install.mjs --rollback RECOVERY_DIR
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fleetRoleVariant, vendorVersions, sha256File, KEEP_NAMES } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const usage = 'install.mjs --image DIR --role air|pro [--verify-only] [--change-role] | --rollback RECOVERY_DIR';
const testMode = process.env.OS1_MACHINE_TEST_MODE === '1';
const home = fs.realpathSync(os.homedir());
if (testMode) assert(home.includes('/os1-machine-test-'), 'test mode runs only in a test home');
const uid = process.getuid();
const service = `gui/${uid}/com.os1.fleet-agent`;
const APP = 'Applications/OS-1 CLODEX.app';
const FLEET_PLIST = 'Library/LaunchAgents/com.os1.fleet-agent.plist';
const store = path.join(home, 'Library/Application Support/OS-1/sessions.json');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const modeOf = stat => (stat.mode & 0o7777).toString(8).padStart(4, '0');
const lstat = file => { try { return fs.lstatSync(file); } catch { return null; } };
const run = (exe, args, options = {}) => spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });

function parseArgs(argv) {
  const options = { verifyOnly: false, changeRole: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = () => { assert(i + 1 < argv.length, usage); return argv[++i]; };
    if (key === '--image') options.image = value();
    else if (key === '--role') options.role = value();
    else if (key === '--verify-only') options.verifyOnly = true;
    else if (key === '--change-role') options.changeRole = true;
    else if (key === '--rollback') options.rollback = value();
    else throw new Error(usage);
  }
  if (options.rollback) return options;
  assert(options.image && ['air', 'pro'].includes(options.role), usage);
  return options;
}

// --- image ----------------------------------------------------------------
function loadImage(directory) {
  const image = JSON.parse(fs.readFileSync(path.join(directory, 'IMAGE.json'), 'utf8'));
  assert.equal(image.schema, 1, 'unsupported image schema');
  assert.equal(image.product, 'os1-machine-image');
  const payload = path.join(directory, 'payload');
  const expected = new Set();
  for (const entry of image.entries) {
    assert(!entry.path.startsWith('/') && !`/${entry.path}/`.includes('/../'), `unsafe path ${entry.path}`);
    expected.add(entry.path);
    for (let parent = path.posix.dirname(entry.path); parent !== '.'; parent = path.posix.dirname(parent)) expected.add(parent);
    const stat = lstat(path.join(payload, entry.path));
    assert(stat, `image is missing ${entry.path}`);
    if (entry.type === 'file') {
      assert(stat.isFile() && stat.size === entry.size && sha256File(path.join(payload, entry.path)) === entry.sha256,
        `image file does not match its manifest: ${entry.path}`);
    } else if (entry.type === 'symlink') {
      assert(stat.isSymbolicLink() && fs.readlinkSync(path.join(payload, entry.path)) === entry.link, `image link mismatch: ${entry.path}`);
    } else assert(stat.isDirectory(), `image directory mismatch: ${entry.path}`);
  }
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    for (const name of fs.readdirSync(path.join(payload, rel))) {
      const child = rel ? `${rel}/${name}` : name;
      assert(expected.has(child), `image holds an unlisted path: ${child}`);
      if (lstat(path.join(payload, child)).isDirectory()) stack.push(child);
    }
  }
  return { image, payload };
}

// The target view of an entry: role-specific plist, paths under this home.
function makeExpect(image, payload, role) {
  const sourceHome = image.source.home;
  const adjust = home !== sourceHome;
  const adjustText = text => text.split(sourceHome + '/').join(home + '/').split(`"${sourceHome}"`).join(`"${home}"`);
  const cache = new Map();
  const bytesOf = entry => {
    if (!cache.has(entry.path)) {
      let bytes = fs.readFileSync(path.join(payload, entry.path));
      if (entry.variant === 'fleet-role') bytes = fleetRoleVariant(bytes, entry.role, role);
      if (adjust && entry.home_refs) bytes = Buffer.from(adjustText(bytes.toString('utf8')), 'utf8');
      cache.set(entry.path, bytes);
    }
    return cache.get(entry.path);
  };
  const transformed = entry => entry.variant === 'fleet-role' || (adjust && entry.home_refs);
  return {
    adjust,
    link: entry => adjust && entry.home_relative ? adjustText(entry.link) : entry.link,
    sha: entry => transformed(entry) ? sha256(bytesOf(entry)) : entry.sha256,
    size: entry => transformed(entry) ? bytesOf(entry).length : entry.size,
    bytes: entry => transformed(entry) ? bytesOf(entry) : fs.readFileSync(path.join(payload, entry.path)),
    write: (entry, file) => {
      if (transformed(entry)) fs.writeFileSync(file, bytesOf(entry), { flag: 'wx' });
      else fs.copyFileSync(path.join(payload, entry.path), file, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(file, parseInt(entry.mode, 8));
    },
  };
}

function rootsOf(image, component) { return component.roots; }

// active.json is re-certified hourly from Apple Notes on each Mac: checkedAt is
// when, sourceID/sourceModified are that Mac's Notes record. The policy itself
// (source digest, projection and routing) is what must match.
const POLICY_VOLATILE = ['checkedAt', 'sourceID', 'sourceModified'];
function samePolicy(file, expected) {
  try {
    const strip = text => { const value = JSON.parse(text); for (const key of POLICY_VOLATILE) delete value[key]; return JSON.stringify(Object.entries(value).sort()); };
    return strip(fs.readFileSync(file, 'utf8')) === strip(expected.toString('utf8'));
  } catch { return false; }
}
function entriesUnder(image, root) { return image.entries.filter(e => e.path === root || e.path.startsWith(root + '/')); }

// Differences between this Mac and the image for one root.
function planRoot(image, expect, root) {
  const entries = entriesUnder(image, root);
  const wanted = new Set(entries.map(e => e.path));
  const actions = [];
  const retyped = new Set();
  for (const entry of entries) {
    if ([...retyped].some(prefix => entry.path.startsWith(prefix + '/'))) { actions.push({ op: 'create', entry }); continue; }
    const abs = path.join(home, entry.path);
    const stat = lstat(abs);
    if (!stat) { actions.push({ op: 'create', entry }); continue; }
    if (entry.type === 'dir') {
      if (!stat.isDirectory()) { actions.push({ op: 'retype', entry }); retyped.add(entry.path); }
      else if (modeOf(stat) !== entry.mode) actions.push({ op: 'chmod', entry, old: modeOf(stat) });
    } else if (entry.type === 'symlink') {
      if (!stat.isSymbolicLink()) actions.push({ op: 'retype', entry });
      else if (fs.readlinkSync(abs) !== expect.link(entry)) actions.push({ op: 'replace', entry });
    } else if (!stat.isFile()) actions.push({ op: 'retype', entry });
    else if (entry.compare === 'owner-policy' && samePolicy(abs, expect.bytes(entry))) continue;
    else if (stat.size !== expect.size(entry) || sha256File(abs) !== expect.sha(entry)) actions.push({ op: 'replace', entry });
    else if (modeOf(stat) !== entry.mode) actions.push({ op: 'chmod', entry, old: modeOf(stat) });
  }
  const rootEntry = entries.find(e => e.path === root);
  const rootStat = lstat(path.join(home, root));
  if (rootEntry?.type === 'dir' && rootStat?.isDirectory() && !rootStat.isSymbolicLink()) {
    const stack = [root];
    while (stack.length) {
      const rel = stack.pop();
      const abs = path.join(home, rel);
      if (!lstat(abs)?.isDirectory()) continue;
      for (const name of fs.readdirSync(abs)) {
        if (KEEP_NAMES.includes(name)) continue;
        const child = `${rel}/${name}`;
        if (!wanted.has(child)) actions.push({ op: 'extra', path: child });
        else if (lstat(path.join(home, child))?.isDirectory()) stack.push(child);
      }
    }
  }
  return actions;
}

// --- journaled changes ----------------------------------------------------
class Journal {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'journal.jsonl');
    this.backup = path.join(directory, 'backup');
    this.counter = 0;
  }
  record(item) { fs.appendFileSync(this.file, JSON.stringify(item) + '\n', { mode: 0o600 }); }
  backupPath(rel) {
    const target = path.join(this.backup, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    assert(!lstat(target), `backup already holds ${rel}`);
    return target;
  }
  ensureParent(rel) {
    const missing = [];
    for (let parent = path.dirname(path.join(home, rel)); !lstat(parent); parent = path.dirname(parent)) missing.unshift(parent);
    for (const directory of missing) {
      const sensitive = directory.includes('/.os1') || directory.includes('/Application Support/OS-1');
      fs.mkdirSync(directory, { mode: sensitive ? 0o700 : 0o755 });
      this.record({ op: 'mkdir', path: path.relative(home, directory) });
    }
  }
  moveAside(rel) {
    const abs = path.join(home, rel), backup = this.backupPath(rel);
    fs.renameSync(abs, backup);
    this.record({ op: 'moved', path: rel, backup });
  }
  temp(rel) { return path.join(path.dirname(path.join(home, rel)), `.os1-machine-${process.pid}-${++this.counter}`); }
  putFile(entry, expect) {
    this.ensureParent(entry.path);
    const abs = path.join(home, entry.path), tmp = this.temp(entry.path);
    expect.write(entry, tmp);
    if (lstat(abs)) {
      const backup = this.backupPath(entry.path);
      try { fs.linkSync(abs, backup); } catch { fs.copyFileSync(abs, backup); }
      fs.renameSync(tmp, abs);
      this.record({ op: 'replaced', path: entry.path, backup });
    } else {
      fs.renameSync(tmp, abs);
      this.record({ op: 'created', path: entry.path });
    }
  }
  putLink(entry, expect) {
    this.ensureParent(entry.path);
    const abs = path.join(home, entry.path), tmp = this.temp(entry.path);
    fs.symlinkSync(expect.link(entry), tmp);
    if (lstat(abs)) {
      const backup = this.backupPath(entry.path);
      fs.symlinkSync(fs.readlinkSync(abs), backup);
      fs.renameSync(tmp, abs);
      this.record({ op: 'replaced', path: entry.path, backup });
    } else {
      fs.renameSync(tmp, abs);
      this.record({ op: 'created', path: entry.path });
    }
  }
  putDir(entry) {
    this.ensureParent(entry.path);
    fs.mkdirSync(path.join(home, entry.path), { mode: 0o700 });
    this.record({ op: 'created', path: entry.path, dir: true, mode: entry.mode });
  }
  chmod(rel, mode, old) {
    fs.chmodSync(path.join(home, rel), parseInt(mode, 8));
    this.record({ op: 'chmod', path: rel, old });
  }
}

function applyRoot(journal, expect, actions) {
  for (const action of actions.filter(a => a.op === 'extra').sort((a, b) => b.path.length - a.path.length)) journal.moveAside(action.path);
  for (const action of actions.filter(a => a.op === 'retype')) journal.moveAside(action.entry.path);
  const dirModes = [];
  for (const action of actions.filter(a => a.op !== 'extra').sort((a, b) => a.entry.path < b.entry.path ? -1 : 1)) {
    const entry = action.entry;
    if (action.op === 'chmod') { journal.chmod(entry.path, entry.mode, action.old); continue; }
    if (entry.type === 'dir') { journal.putDir(entry); dirModes.push(entry); }
    else if (entry.type === 'symlink') journal.putLink(entry, expect);
    else journal.putFile(entry, expect);
  }
  for (const entry of dirModes.reverse()) fs.chmodSync(path.join(home, entry.path), parseInt(entry.mode, 8));
}

function rollback(directory) {
  const file = path.join(directory, 'journal.jsonl');
  if (!fs.existsSync(file)) return 0;
  const items = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).reverse();
  let undone = 0, restartFleet = false;
  for (const item of items) {
    const abs = item.path ? path.join(home, item.path) : null;
    if (item.op === 'created') {
      const stat = lstat(abs);
      if (stat?.isDirectory() && !stat.isSymbolicLink()) {
        if (item.tree) fs.rmSync(abs, { recursive: true, force: true }); else { try { fs.rmdirSync(abs); } catch {} }
      } else if (stat) fs.unlinkSync(abs);
    } else if (item.op === 'replaced' || item.op === 'moved') {
      const stat = lstat(abs);
      if (stat?.isDirectory() && !stat.isSymbolicLink()) fs.rmSync(abs, { recursive: true, force: true });
      else if (stat) fs.unlinkSync(abs);
      fs.renameSync(item.backup, abs);
    } else if (item.op === 'chmod') fs.chmodSync(abs, parseInt(item.old, 8));
    else if (item.op === 'mkdir') { try { fs.rmdirSync(abs); } catch {} }
    else if (item.op === 'fleet-bootout') restartFleet = true; // after the old plist is back
    else if (item.op === 'claude-mcp') restoreClaudeMCP(item);
    undone++;
  }
  if (restartFleet && !testMode) run('/bin/launchctl', ['bootstrap', `gui/${uid}`, path.join(home, FLEET_PLIST)]);
  fs.renameSync(file, path.join(directory, `journal.rolled-back-${Date.now()}.jsonl`));
  return undone;
}

// --- Claude Code user MCP servers (the only part of ~/.claude.json copied) --
const claudeState = path.join(home, '.claude.json');
function claudeServers() {
  try { return JSON.parse(fs.readFileSync(claudeState, 'utf8')).mcpServers ?? {}; } catch { return {}; }
}
function claudeCLI(args) {
  const result = run(path.join(home, '.local/bin/claude'), args, { timeout: 60000, cwd: home });
  assert.equal(result.status, 0, `claude ${args.slice(0, 2).join(' ')} failed: ${(result.stderr || result.stdout).trim().slice(-300)}`);
}
function setClaudeServer(name, server) {
  if (testMode) {
    const state = lstat(claudeState) ? JSON.parse(fs.readFileSync(claudeState, 'utf8')) : {};
    state.mcpServers = { ...(state.mcpServers ?? {}) };
    if (server) state.mcpServers[name] = server; else delete state.mcpServers[name];
    fs.writeFileSync(claudeState, JSON.stringify(state, null, 2));
    return;
  }
  if (claudeServers()[name]) claudeCLI(['mcp', 'remove', '--scope', 'user', name]);
  if (!server) return;
  if (server.type === 'http' || server.type === 'sse') claudeCLI(['mcp', 'add', '--scope', 'user', '--transport', server.type, name, server.url]);
  else claudeCLI(['mcp', 'add', '--scope', 'user', name, '--', server.command, ...(server.args ?? [])]);
}
function restoreClaudeMCP(item) { setClaudeServer(item.name, item.previous ?? null); }
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- OS-1 processes, fleet and app ---------------------------------------
function processes() {
  return run('/bin/ps', ['-axo', 'pid=,args=']).stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    return match ? [{ pid: Number(match[1]), args: match[2] }] : [];
  });
}
const appProcesses = () => processes().filter(p => p.args.endsWith('/Contents/MacOS/OS1App'));
const fleetLoaded = () => !testMode && run('/bin/launchctl', ['print', service]).status === 0;
function readStore() { try { return JSON.parse(fs.readFileSync(store, 'utf8')); } catch { return null; } }
function requirement(app) {
  const result = run('/usr/bin/codesign', ['-d', '-r-', app]);
  return (result.stdout + result.stderr).split('\n').find(line => line.startsWith('designated => ')) ?? null;
}
const SELF_TESTS = [
  ['runtime', '.local/bin/os1', ['self-test']], ['app', `${APP}/Contents/MacOS/OS1App`, ['--self-test']],
  ['queue', `${APP}/Contents/MacOS/OS1App`, ['--self-test-sidebar-queue']], ['parallel', `${APP}/Contents/MacOS/OS1App`, ['--self-test-parallel']],
  ['fleet', '.local/bin/os1', ['fleet-self-test']], ['queue-fork', `${APP}/Contents/MacOS/OS1App`, ['--self-test-queue-fork']],
  ['composer', `${APP}/Contents/MacOS/OS1App`, ['--self-test-composer']], ['steering', `${APP}/Contents/MacOS/OS1App`, ['--self-test-steering']],
];

function installApp({ image, payload, expect, journal, recovery, receipt, actions }) {
  const appSource = path.join(payload, APP);
  const appStat = lstat(path.join(home, APP));
  const cliStat = lstat(path.join(home, '.local/bin/os1'));
  const eligible = !testMode && appStat?.isDirectory() && !appStat.isSymbolicLink() && cliStat?.isFile() && fs.existsSync(store);
  if (eligible) {
    // Same verified path as OS-1's own self-update.
    const previous = requirement(path.join(home, APP));
    const rotation = previous !== image.os1.designated_requirement;
    const target = path.join(recovery, 'app-install');
    const args = [path.join(here, 'install-local-verified.mjs'), appSource, target, image.os1.build, '--preserve-queue'];
    if (rotation) args.push('--allow-local-signer-rotation');
    const result = run(process.execPath, args, { timeout: 20 * 60 * 1000, env: process.env });
    fs.writeFileSync(path.join(recovery, 'app-install.log'), `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
    assert.equal(result.status, 0, `OS-1 app installer stopped: ${(result.stderr || result.stdout).trim().split('\n').slice(-3).join(' | ')}`);
    let installerReceipt = null;
    try { installerReceipt = JSON.parse(result.stdout.trim().split('\n').pop()); } catch {} // the app is live; never roll back over it
    receipt.app = { method: 'verified-installer', signer_rotation: rotation, previous_requirement: previous,
      recovery: target, installer_receipt: installerReceipt };
    return { restartedFleet: true };
  }
  // First install on this Mac (or an incomplete one): nothing to preserve but files.
  if (!testMode) {
    assert.equal(appProcesses().length, 0, 'an OS-1 app is running; quit it (⌘Q) and run os1-machine-sync again');
    assert.equal((readStore()?.inFlight ?? []).length, 0, 'OS-1 has a task in progress; leave it to finish first');
    if (fleetLoaded()) { assert.equal(run('/bin/launchctl', ['bootout', service]).status, 0); journal.record({ op: 'fleet-bootout' }); }
    assert.equal(run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appSource]).status, 0, 'image app signature is invalid');
  }
  // The bundle moves as a whole: build it beside the target, then swap.
  const appActions = actions.filter(a => (a.entry?.path ?? a.path) === APP || (a.entry?.path ?? a.path).startsWith(APP + '/'));
  if (appActions.length) {
    journal.ensureParent(APP);
    const stage = path.join(home, 'Applications', `.os1-machine-${process.pid}.app`);
    if (testMode) fs.cpSync(appSource, stage, { recursive: true, verbatimSymlinks: true });
    else assert.equal(run('/usr/bin/ditto', ['--norsrc', '--noextattr', '--noacl', appSource, stage]).status, 0, 'app copy failed');
    if (lstat(path.join(home, APP))) journal.moveAside(APP);
    fs.renameSync(stage, path.join(home, APP));
    journal.record({ op: 'created', path: APP, tree: true });
  }
  applyRoot(journal, expect, actions.filter(a => !((a.entry?.path ?? a.path) === APP || (a.entry?.path ?? a.path).startsWith(APP + '/'))));
  receipt.app = { method: 'fresh-install', tests: [] };
  if (!testMode) {
    assert.equal(run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(home, APP)]).status, 0, 'installed app signature is invalid');
    for (const [label, exe, args] of SELF_TESTS) {
      const result = run(path.join(home, exe), args, { timeout: 10 * 60 * 1000 });
      fs.writeFileSync(path.join(recovery, `${label}-test.log`), `${result.stdout}\n${result.stderr}`, { mode: 0o600 });
      assert.equal(result.status, 0, `${label} self-test failed`);
      receipt.app.tests.push(`${label}: PASS`);
    }
  }
  return { restartedFleet: false };
}

function ensureFleet(plistChanged, restartedFleet, receipt) {
  if (testMode) return;
  const plist = path.join(home, FLEET_PLIST);
  const claims = ['main-agent-active.json', 'main-agent-claim.json'].some(name => fs.existsSync(path.join(home, '.os1/fleet', name)));
  if (fleetLoaded() && plistChanged && !restartedFleet) {
    if (claims) receipt.fleet_restart_deferred = 'a fleet job was running; the agent picks up the new configuration at its next start';
    else run('/bin/launchctl', ['bootout', service]);
  }
  if (!fleetLoaded()) assert.equal(run('/bin/launchctl', ['bootstrap', `gui/${uid}`, plist]).status, 0, 'fleet agent did not start');
  let state = '';
  for (let i = 0; i < 40 && !/state = running/.test(state); i++) {
    state = run('/bin/launchctl', ['print', service]).stdout;
    if (!/state = running/.test(state)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  receipt.fleet = { running: /state = running/.test(state), pid: Number(state.match(/\bpid = (\d+)/)?.[1]) || null };
}

// --- verification -----------------------------------------------------------
function compare(image, expect) {
  const differences = [];
  let checked = 0;
  for (const component of image.components) {
    for (const root of rootsOf(image, component)) {
      checked += entriesUnder(image, root).length;
      for (const action of planRoot(image, expect, root)) {
        differences.push({ component: component.id, op: action.op, path: action.entry?.path ?? action.path });
      }
    }
  }
  for (const [name, server] of Object.entries(image.claude_user_mcp_servers ?? {})) {
    checked++;
    if (!sameJSON(claudeServers()[name] ?? null, server)) differences.push({ component: 'claude-config', op: 'mcp-server', path: `~/.claude.json mcpServers.${name}` });
  }
  return { checked, differences };
}

function vendorParity(image) {
  if (!image.vendor) return null;
  const here = testMode ? { chatgpt_app: null, codex_cli: null, claude_app: null } : vendorVersions(home);
  const pick = (value, key) => value ? value[key] ?? null : null;
  return {
    chatgpt_app: { image: pick(image.vendor.chatgpt_app, 'version'), here: pick(here.chatgpt_app, 'version') },
    codex_cli: { image: pick(image.vendor.codex_cli, 'version'), here: pick(here.codex_cli, 'version') },
    claude_app: { image: pick(image.vendor.claude_app, 'version'), here: pick(here.claude_app, 'version') },
  };
}

function staleCopies() {
  if (testMode) return [];
  return ['/Applications/OS-1 CLODEX.app', '/usr/local/bin/os1', '/Library/Application Support/OS-1/config.json']
    .filter(file => lstat(file)).map(file => ({ path: file, note: 'older system-wide OS-1 copy; OS-1 uses the copies in your home folder' }));
}

function existingRole() {
  const plist = path.join(home, FLEET_PLIST);
  if (!lstat(plist)) return null;
  return fs.readFileSync(plist, 'utf8').match(/<string>--role<\/string>\s*<string>(air|pro)<\/string>/)?.[1] ?? null;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.rollback) {
    const directory = path.resolve(options.rollback);
    assert(directory.startsWith(path.join(home, '.os1/recovery/machine-sync-')), 'not a machine-sync recovery directory');
    console.log(`OS1_MACHINE_IMAGE_ROLLED_BACK undone=${rollback(directory)}`);
    if (fs.existsSync(path.join(directory, 'app-install'))) console.log(`App: see ${path.join(directory, 'app-install/RECOVERY.md')}`);
    return 0;
  }
  const { image, payload } = loadImage(path.resolve(options.image));
  const expect = makeExpect(image, payload, options.role);
  const header = { release_id: image.release_id, os1_build: image.os1.build, role: options.role, home_adjusted: expect.adjust };

  if (options.verifyOnly) {
    const { checked, differences } = compare(image, expect);
    const report = { ...header, checked, differences, vendor: vendorParity(image), stale_copies: staleCopies() };
    console.log(JSON.stringify(report, null, 2));
    console.log(differences.length ? `OS1_MACHINE_IMAGE_DIFFERENT ${differences.length}` : `OS1_MACHINE_IMAGE_IDENTICAL ${checked}/${checked}`);
    console.log(differences.length
      ? `이 맥은 이미지와 ${differences.length}곳이 다릅니다 (확인 ${checked}개).`
      : `이 맥의 OS-1 구성은 이미지(빌드 ${image.os1.build})와 100% 동일합니다 (${checked}/${checked}).`);
    return differences.length ? 3 : 0;
  }

  // Preflight: never interrupt work, never flip a Mac's fleet role by accident.
  const currentRole = existingRole();
  assert(!currentRole || currentRole === options.role || options.changeRole,
    `this Mac's fleet agent is configured as ${currentRole}; refusing to install as ${options.role} (use --change-role only if that is intended)`);
  if (!testMode) {
    assert.equal((readStore()?.inFlight ?? []).length, 0, 'OS-1 has a task in progress; run os1-machine-sync again when it finishes');
    for (const name of ['main-agent-active.json', 'main-agent-claim.json']) {
      assert(!fs.existsSync(path.join(home, '.os1/fleet', name)), 'a fleet job is running on this Mac; run os1-machine-sync again when it finishes');
    }
    const foreign = appProcesses().filter(p => p.args !== path.join(home, APP, 'Contents/MacOS/OS1App'));
    assert.equal(foreign.length, 0, `another OS-1 copy is running (${foreign.map(p => p.args).join(', ')}); quit it first`);
    if (appProcesses().length) assert.equal(run('/usr/bin/swift', ['--version']).status, 0, 'quit OS-1 (⌘Q) first: this Mac cannot ask it to quit');
  }
  const totalBytes = image.entries.reduce((sum, e) => sum + (e.size ?? 0), 0);
  const fsStat = fs.statfsSync(home);
  assert(fsStat.bavail * fsStat.bsize > 2 * totalBytes, 'not enough free disk space');

  const lock = path.join(home, '.os1/machine-sync.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch {
    const pid = Number(fs.readFileSync(lock, 'utf8').trim());
    let alive = false; try { process.kill(pid, 0); alive = true; } catch {}
    assert(!alive, 'another os1-machine-sync is running');
    fs.writeFileSync(lock, String(process.pid), { mode: 0o600 });
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const recovery = path.join(home, '.os1/recovery', `machine-sync-${image.release_id}-${stamp}-${process.pid}`);
  fs.mkdirSync(path.dirname(recovery), { recursive: true, mode: 0o700 });
  fs.mkdirSync(recovery, { mode: 0o700 });
  const journal = new Journal(recovery);
  const receipt = { ...header, started_at: new Date().toISOString(), recovery, changed: {}, previous_role: currentRole };
  let activated = false;
  try {
    // Phase A: everything except the app, journaled and reversible.
    let plistChanged = false;
    const appComponent = image.components.find(c => c.install === 'os1-app');
    for (const component of image.components) {
      if (component === appComponent) continue;
      for (const root of rootsOf(image, component)) {
        const actions = planRoot(image, expect, root);
        if (!actions.length) continue;
        applyRoot(journal, expect, actions);
        receipt.changed[root] = actions.length;
        if (root === FLEET_PLIST) plistChanged = true;
      }
    }
    const current = claudeServers();
    for (const [name, server] of Object.entries(image.claude_user_mcp_servers ?? {})) {
      if (sameJSON(current[name] ?? null, server)) continue;
      journal.record({ op: 'claude-mcp', name, previous: current[name] ?? null });
      setClaudeServer(name, server);
      receipt.changed[`~/.claude.json mcpServers.${name}`] = 1;
    }
    // Phase B: the app, CLI and CLI config.
    const appActions = appComponent.roots.flatMap(root => planRoot(image, expect, root));
    let restartedFleet = false;
    if (appActions.length) {
      ({ restartedFleet } = installApp({ image, payload, expect, journal, recovery, receipt, actions: appActions }));
      receipt.changed[APP] = appActions.length;
    } else receipt.app = { method: 'already-identical' };
    activated = true;
    // Phase C: fleet agent with this Mac's role.
    ensureFleet(plistChanged, restartedFleet, receipt);
  } catch (error) {
    receipt.error = String(error.message || error);
    if (!activated) { receipt.rolled_back_entries = rollback(recovery); receipt.rolled_back = true; }
    throw error;
  } finally {
    receipt.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(recovery, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    fs.writeFileSync(path.join(recovery, 'RECOVERY.md'), [
      '# OS-1 machine image installation', '',
      `Release ${image.release_id} (OS-1 build ${image.os1.build}), role ${options.role}.`,
      'Every file this installation replaced or moved aside is under backup/. To restore them:', '',
      `    ~/.local/share/node-v24.20.0/bin/node <image>/installer/install.mjs --rollback "${recovery}"`, '',
      'The OS-1 app was installed by the verified installer; its previous app and CLI are in app-install/ when present.',
      'Logins, device keys, conversations and logs were not copied or changed.', ''].join('\n'), { mode: 0o600 });
    try { if (fs.readFileSync(lock, 'utf8').trim() === String(process.pid)) fs.unlinkSync(lock); } catch {}
  }

  // Phase D: prove the result.
  const { checked, differences } = compare(image, expect);
  receipt.verification = { checked, differences, vendor: vendorParity(image), stale_copies: staleCopies() };
  if (!testMode) {
    const version = run(path.join(home, '.local/bin/os1'), ['version']);
    receipt.verification.os1_version = version.stdout.trim();
    assert(version.stdout.includes(`build${image.os1.build}`), 'installed CLI does not report the image build');
    receipt.verification.signature_ok = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', path.join(home, APP)]).status === 0;
  }
  fs.writeFileSync(path.join(recovery, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...header, recovery, changed: receipt.changed, app: receipt.app?.method,
    fleet: receipt.fleet ?? null, verification: { checked, differences: differences.length },
    vendor: receipt.verification.vendor, stale_copies: receipt.verification.stale_copies }, null, 2));
  assert.equal(differences.length, 0, `installed state still differs from the image: ${JSON.stringify(differences.slice(0, 5))}`);
  console.log(`OS1_MACHINE_IMAGE_INSTALLED ${checked}/${checked}`);
  console.log(`OS-1 머신 이미지 설치 완료: 빌드 ${image.os1.build}, 역할 ${options.role}, ${checked}/${checked} 항목이 이미지와 동일합니다.`);
  for (const [name, versions] of Object.entries(receipt.verification.vendor ?? {})) {
    if (versions.image && versions.here !== versions.image) console.log(`참고: ${name} 버전이 다릅니다 (이 맥 ${versions.here ?? '없음'}, 원본 ${versions.image}). 해당 앱을 업데이트하면 맞춰집니다.`);
  }
  for (const stale of receipt.verification.stale_copies) console.log(`참고: 예전 OS-1 사본 ${stale.path} 가 남아 있습니다. Finder에서 휴지통으로 옮겨 주세요.`);
  console.log('로그인(Codex·Claude·GitHub·Wrangler)과 대화 기록은 이 맥 것을 그대로 썼습니다. OS-1이 메모(Notes) 접근을 물으면 허용해야 거버넌스 정책이 갱신됩니다.');
  return 0;
}

try { process.exitCode = main(); }
catch (error) { console.error(`OS1_MACHINE_IMAGE_FAILED: ${error.message}`); process.exitCode = 1; }
