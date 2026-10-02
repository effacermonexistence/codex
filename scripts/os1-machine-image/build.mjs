#!/usr/bin/env node
// Builds a byte-exact image of this Mac's OS-1 setup for another of the
// owner's Macs: the app (with its embedded CLI and config), the CLI, the fleet
// agent, owner policy and local policy state, the Codex/Claude instructions,
// settings and hooks OS-1 runs under, and the exact Claude Code, Node.js and
// tool versions. Logins, device and signing keys, conversations, logs and
// scheduled jobs are never captured (see EXCLUDED); a secret scan blocks the
// image if any credential-shaped value is found in what is captured.
//
//   build.mjs --out DIR --repository-commit SHA [--home DIR] [--release-id ID]
//             [--source-role air|pro] [--skip-vendor-probe]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const PRODUCT = 'os1-machine-image';
export const BUCKET = 'omar-private-archive';
export const REPOSITORY = 'effacermonexistence/codex';
const PART_BYTES = 200 * 1024 * 1024; // wrangler r2 object put accepts at most 300 MiB
const NODE_DIR = '.local/share/node-v24.20.0';
const SUPPORT = 'Library/Application Support/OS-1';
const FLEET_PLIST = 'Library/LaunchAgents/com.os1.fleet-agent.plist';
// Config and instruction files whose paths follow the home folder when the
// target's home differs. Everything else (content-addressed policy snapshots,
// engines, binaries) stays byte-identical.
export const HOME_ADJUSTED = [FLEET_PLIST, '.claude/settings.json', '.claude/settings.local.json', '.claude/CLAUDE.md',
  '.codex/config.toml', '.codex/hooks.json', '.codex/AGENTS.md'];
// Runtime-only names: never captured, and never moved aside on the target.
export const KEEP_NAMES = ['.DS_Store', '.claude', '.cc-writes', 'sync.lock', '.ledger.lock'];

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

const usage = 'build.mjs --out DIR --repository-commit SHA [--home DIR] [--release-id ID] [--source-role air|pro] [--skip-vendor-probe]';
function parseArgs(argv) {
  const options = { sourceRole: 'air', skipVendorProbe: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = () => { assert(i + 1 < argv.length, usage); return argv[++i]; };
    if (key === '--out') options.out = value();
    else if (key === '--repository-commit') options.commit = value();
    else if (key === '--home') options.home = value();
    else if (key === '--release-id') options.releaseID = value();
    else if (key === '--source-role') options.sourceRole = value();
    else if (key === '--skip-vendor-probe') options.skipVendorProbe = true;
    else throw new Error(usage);
  }
  assert(options.out && /^[0-9a-f]{40}$/.test(options.commit ?? ''), usage);
  assert(['air', 'pro'].includes(options.sourceRole), usage);
  return options;
}

export function sha256File(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1 << 20);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
const sha256 = data => createHash('sha256').update(data).digest('hex');
const mode = stat => (stat.mode & 0o7777).toString(8).padStart(4, '0');

// The fleet agent plist is the one intended per-Mac difference: its role.
export function fleetRoleVariant(bytes, fromRole, toRole) {
  const text = bytes.toString('utf8');
  const needle = `<string>--role</string>\n\t\t<string>${fromRole}</string>`;
  assert.equal(text.split(needle).length, 2, 'fleet agent plist must name its role exactly once');
  return Buffer.from(text.replace(needle, `<string>--role</string>\n\t\t<string>${toRole}</string>`), 'utf8');
}

function claudeCodeVersion(home) {
  const link = path.join(home, '.local/bin/claude');
  const target = fs.readlinkSync(link);
  const match = target.match(/\/\.local\/share\/claude\/versions\/([0-9][0-9A-Za-z.+-]*)$/);
  assert(match, `~/.local/bin/claude must point into ~/.local/share/claude/versions (got ${target})`);
  return match[1];
}

function components(home) {
  const claude = claudeCodeVersion(home);
  return [
    { id: 'os1-app', install: 'os1-app', description: 'OS-1 CLODEX app, CLI and the config beside the CLI',
      roots: [['Applications/OS-1 CLODEX.app'], ['.local/bin/os1'], ['.local/bin/config.json']] },
    { id: 'os1-helpers', description: 'OS-1 R2 sync helpers',
      roots: [['.local/bin/os1-exo-monitor-sync'], ['.local/bin/os1-machine-sync']] },
    { id: 'os1-fleet-agent', description: 'Fleet agent LaunchAgent (role is set per Mac)',
      roots: [[FLEET_PLIST]], variant: 'fleet-role' },
    { id: 'os1-settings', description: 'OS-1 interface/output language settings', roots: [[`${SUPPORT}/settings.json`]] },
    { id: 'os1-owner-policy', description: 'Owner governance policy snapshots and the active projection',
      roots: [['.os1/owner-policy']] },
    { id: 'os1-policy-state', description: 'Backend instruction projections, learned drift rules, local private core',
      roots: [[`${SUPPORT}/backend-instructions`], [`${SUPPORT}/drift-policy`], [`${SUPPORT}/private-core`]] },
    { id: 'os1-project-sources', description: 'Registered project sources and project materials',
      roots: [[`${SUPPORT}/registered-sources`], [`${SUPPORT}/project-materials`]] },
    { id: 'os1-tools', vendor: true, description: 'OS-1 pinned npm and wrangler',
      roots: [[`${SUPPORT}/tools/npm-12.0.2`], [`${SUPPORT}/tools/wrangler-4.127.1`]] },
    { id: 'claude-instructions', description: 'Claude Code global instructions and RCC engine',
      roots: [['.claude/CLAUDE.md'], ['.claude/OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED.txt'],
        ['.claude/OMAR_LUA_RCC_ENGINE_v26_CURRENT.txt'], ['.claude/omar-authority']] },
    { id: 'claude-config', description: 'Claude Code settings, hooks, skills and commands',
      roots: [['.claude/settings.json'], ['.claude/settings.local.json', { optional: true }], ['.claude/hooks'],
        ['.claude/skills'], ['.claude/commands', { optional: true }]] },
    { id: 'claude-code', vendor: true, description: `Claude Code ${claude}`,
      roots: [[`.local/share/claude/versions/${claude}`], ['.local/bin/claude']] },
    { id: 'codex-instructions', description: 'Codex global instructions, RCC engine and workflows',
      roots: [['.codex/AGENTS.md'], ['.codex/OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED_TEXT2_7.txt'],
        ['.codex/workflows', { optional: true }]] },
    { id: 'codex-config', description: 'Codex configuration, hooks and keybindings',
      roots: [['.codex/config.toml'], ['.codex/hooks.json'], ['.codex/keybindings.json', { optional: true }]] },
    { id: 'node', vendor: true, description: 'Node.js 24.20.0 runtime used by OS-1 tools and hooks', roots: [[NODE_DIR]] },
  ].map(component => ({ ...component, roots: component.roots.map(([root, flags = {}]) => ({ path: root, ...flags })) }));
}

export const EXCLUDED = [
  ['Codex/Claude/GitHub/Cloudflare logins and OS-1 backend accounts (~/.codex/auth.json, Keychain, accounts/, auth-flows/)',
    'credentials are per Mac; sign in on each Mac'],
  ['OS-1 device identity (device/, Secure Enclave key) and ~/.claude/.claude.json machine ID', 'bound to this Mac'],
  ['Local code-signing identity (build-signing/)', 'private key never leaves the Mac that created it'],
  ['Conversations and history (sessions.json, run-journals, diagnostics, execution-outbox, governance-activity, completion-feedback, managed-native-turns, run-steering, task-events, receipts, source-snapshots)',
    'per-Mac history, not installation'],
  ['~/.os1 fleet, recovery, self-update, previews and verification state', 'per-Mac runtime state'],
  ['Codex/Claude sessions, history, logs, databases, ~/.claude/projects (incl. memory), ~/.claude.json except user MCP servers',
    'per-Mac history and login state'],
  ['Codex automations, Claude scheduled tasks and other LaunchAgents (mail gateway, bridges, previews, EXO)',
    'would run twice on two Macs; EXO has its own installer (os1-exo-monitor-sync)'],
  ['ChatGPT.app (Codex CLI), Claude.app, Codex runtimes/plugins/system skills, Claude plugin marketplace clones',
    'vendor-managed and auto-updated; versions are compared and reported'],
  ['EXO models', 'never transferred between devices'],
];

function walk(home, rel, out) {
  const abs = path.join(home, rel);
  const stat = fs.lstatSync(abs);
  if (stat.isSymbolicLink()) { out.push({ path: rel, type: 'symlink', link: fs.readlinkSync(abs) }); return; }
  if (stat.isDirectory()) {
    out.push({ path: rel, type: 'dir', mode: mode(stat) });
    for (const name of fs.readdirSync(abs).sort()) {
      if (!KEEP_NAMES.includes(name)) walk(home, path.posix.join(rel, name), out);
    }
    return;
  }
  assert(stat.isFile(), `unsupported file type: ${rel}`);
  out.push({ path: rel, type: 'file', mode: mode(stat), size: stat.size });
}

function capture(home, payload, entry) {
  const source = path.join(home, entry.path);
  const target = path.join(payload, entry.path);
  if (entry.type === 'dir') { fs.mkdirSync(target, { recursive: true, mode: 0o700 }); return; }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  if (entry.type === 'symlink') { fs.symlinkSync(entry.link, target); return; }
  // A file being rewritten while it is captured must not enter the image torn.
  for (let attempt = 1; ; attempt++) {
    const before = sha256File(source);
    fs.rmSync(target, { force: true });
    fs.copyFileSync(source, target);
    const copied = sha256File(target), after = sha256File(source);
    if (before === copied && copied === after) {
      fs.chmodSync(target, parseInt(entry.mode, 8));
      entry.sha256 = copied;
      entry.size = fs.statSync(target).size;
      return;
    }
    assert(attempt < 4, `file kept changing while it was captured: ${entry.path}`);
  }
}

// --- credential scan -------------------------------------------------------
// [rule, pattern, applies to vendor packages too]
export const SECRET_PATTERNS = [
  ['private-key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----(?:\s|\\n)*[A-Za-z0-9+/=]{64,}/, true],
  ['provider-api-key', /\bsk-(?:ant-|proj-|live_|test_|svcacct-)?[A-Za-z0-9_-]{24,}/, false],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/, true],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/, true],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/, true],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/, true],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/, true],
  ['meta-access-token', /\bEAA[A-Za-z0-9]{80,}/, false],
  ['jwt', /\beyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, false],
  ['json-secret-field', /"(?:access_token|refresh_token|id_token|api_key|apiKey|client_secret|password|bearer_token|authorization)"[ \t]*:[ \t]*"([^"\s]{20,})"/i, false],
  ['secret-assignment', /\b[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*[ \t]*[=:][ \t]*['"]?([A-Za-z0-9_\-/+=.]{24,})/, false],
];
const SECRET_FILE_NAMES = /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|credentials(\.json)?|auth\.json|id_(rsa|ed25519|ecdsa)|.*\.p12|.*\.pfx|.*\.keychain(-db)?)$/i;
// Values that are environment references, variable names or self-declared
// placeholders, not credentials. The name test is case-sensitive on purpose:
// a case-insensitive [A-Z0-9_]+ would excuse most real keys.
const ENV_REFERENCE = /^(?:process\.env|os\.environ|env\.)/;
const ENV_NAME = /^[A-Z]+(?:_[A-Z0-9]+)+$/;
const PLACEHOLDER = /your|example|placeholder|not-a-real|not_real|dummy|fake|redacted|changeme|test-key|synthetic|xxxx/i;
export const notASecret = value => ENV_REFERENCE.test(value) || ENV_NAME.test(value) || PLACEHOLDER.test(value);
// Reviewed matches that are not credentials: [path, rule, sha256 of the match, reason].
const ALLOW = [
  ['.claude/omar-authority/OMARAGI_CURRENT_MASTER_LOGIC.txt', 'secret-assignment', '9e7e331af04334b4', 'Paddle client-side token: publishable by design (Paddle.js)'],
];
export const allowedSecrets = [];

function scanText(label, text, findings, vendor) {
  for (const [rule, pattern, forVendor] of SECRET_PATTERNS) {
    if (vendor && !forVendor) continue;
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    for (const match of text.matchAll(global)) {
      const value = match[1] ?? match[0];
      if (notASecret(value)) continue;
      const digest = sha256(match[0]).slice(0, 16);
      const allowed = ALLOW.find(([where, allowedRule, allowedDigest]) => where === label && allowedRule === rule && allowedDigest === digest);
      if (allowed) { allowedSecrets.push({ path: label, rule, reason: allowed[3] }); continue; }
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({ path: label, rule, line, preview: `${match[0].slice(0, 6)}…(${match[0].length} chars) sha ${digest}` });
    }
  }
}

function scanFile(abs, label, vendor, findings, stats) {
  const stat = fs.lstatSync(abs);
  if (!stat.isFile()) return;
  if (SECRET_FILE_NAMES.test(label) && !(vendor && /node_modules\//.test(label))) {
    findings.push({ path: label, rule: 'credential-file-name', line: 0, preview: path.basename(label) });
  }
  if (vendor && stat.size > 1024 * 1024) return; // vendor binaries: official builds, name checks only
  stats.files++;
  if (/\.(tar\.gz|tgz)$/.test(label) && !vendor) {
    const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'os1-machine-scan-'));
    try {
      execFileSync('/usr/bin/tar', ['-xzf', abs, '-C', unpacked], { stdio: 'ignore' });
      stats.archives++;
      scanPath(unpacked, `${label}!/`, false, findings, stats);
    } finally { fs.rmSync(unpacked, { recursive: true, force: true }); }
    return;
  }
  scanText(label, fs.readFileSync(abs).toString('latin1'), findings, vendor);
}

function scanPath(abs, label, vendor, findings, stats) {
  const stat = fs.lstatSync(abs);
  if (stat.isFile()) { scanFile(abs, label, vendor, findings, stats); return; }
  if (!stat.isDirectory()) return;
  const prefix = label.endsWith('/') ? label : label + '/';
  for (const name of fs.readdirSync(abs)) scanPath(path.join(abs, name), prefix + name, vendor, findings, stats);
}

// --- vendor parity probes (reported on the target, never installed) --------
function plistValue(file, key) {
  const result = spawnSync('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', file], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}
export function vendorVersions(home) {
  const chatgpt = '/Applications/ChatGPT.app/Contents/Info.plist';
  const claudeApp = '/Applications/Claude.app/Contents/Info.plist';
  const codexCandidates = [path.join(home, '.local/bin/codex'), '/opt/homebrew/bin/codex', '/usr/local/bin/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/Applications/ChatGPT.app/Contents/Resources/codex'];
  const codex = codexCandidates.find(candidate => { try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; } });
  let codexVersion = null;
  if (codex) {
    const result = spawnSync(codex, ['--version'], { encoding: 'utf8', timeout: 30000 });
    codexVersion = result.status === 0 ? result.stdout.trim() : null;
  }
  return {
    chatgpt_app: fs.existsSync(chatgpt) ? { version: plistValue(chatgpt, 'CFBundleShortVersionString'), build: plistValue(chatgpt, 'CFBundleVersion') } : null,
    codex_cli: codex ? { path: codex, version: codexVersion } : null,
    claude_app: fs.existsSync(claudeApp) ? { version: plistValue(claudeApp, 'CFBundleShortVersionString') } : null,
  };
}

function homeRefs(buffer, home) { return buffer.toString('utf8').split(home + '/').length - 1 + (buffer.toString('utf8').includes(`"${home}"`) ? 1 : 0); }

function splitParts(file, directory, prefix) {
  const size = fs.statSync(file).size;
  const parts = [];
  const fd = fs.openSync(file, 'r');
  try {
    for (let offset = 0, index = 0; offset < size; offset += PART_BYTES, index++) {
      const length = Math.min(PART_BYTES, size - offset);
      const name = `${prefix}.part-${String(index).padStart(3, '0')}`;
      const out = path.join(directory, name);
      const buffer = Buffer.allocUnsafe(length);
      let read = 0;
      while (read < length) read += fs.readSync(fd, buffer, read, length - read, offset + read);
      fs.writeFileSync(out, buffer, { mode: 0o600, flag: 'wx' });
      parts.push({ name, sha256: sha256(buffer), bytes: length });
    }
  } finally { fs.closeSync(fd); }
  return parts;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const home = fs.realpathSync(path.resolve(options.home ?? os.homedir()));
  const out = path.resolve(options.out);
  assert(!fs.existsSync(out), `output directory must not exist: ${out}`);
  const imageRoot = path.join(out, 'os1-machine');
  const payload = path.join(imageRoot, 'payload');
  fs.mkdirSync(payload, { recursive: true, mode: 0o700 });

  const app = path.join(home, 'Applications/OS-1 CLODEX.app');
  const build = plistValue(path.join(app, 'Contents/Info.plist'), 'CFBundleVersion');
  const version = plistValue(path.join(app, 'Contents/Info.plist'), 'CFBundleShortVersionString');
  assert(/^\d+$/.test(build ?? ''), 'installed OS-1 app has no build number');
  const appMain = sha256File(path.join(app, 'Contents/MacOS/OS1App'));
  const embeddedCLI = sha256File(path.join(app, 'Contents/Resources/os1'));
  const embeddedConfig = sha256File(path.join(app, 'Contents/Resources/config.json'));
  assert.equal(sha256File(path.join(home, '.local/bin/os1')), embeddedCLI, 'installed CLI is not the app\'s CLI');
  assert.equal(sha256File(path.join(home, '.local/bin/config.json')), embeddedConfig, 'CLI config is not the app\'s config');
  let requirement = null;
  if (!options.skipVendorProbe) {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'ignore' });
    const shown = spawnSync('/usr/bin/codesign', ['-d', '-r-', app], { encoding: 'utf8' });
    requirement = (shown.stdout + shown.stderr).split('\n').find(line => line.startsWith('designated => ')) ?? null;
    assert(requirement, 'app has no designated requirement');
  }
  // The helper that installs this image is itself part of the image.
  const helper = path.join(home, '.local/bin/os1-machine-sync');
  assert(fs.existsSync(helper), 'install ~/.local/bin/os1-machine-sync on this Mac before building');
  assert.equal(sha256File(helper), sha256File(path.join(repoRoot, 'scripts/os1-machine-sync.sh')),
    '~/.local/bin/os1-machine-sync differs from scripts/os1-machine-sync.sh');

  const comps = components(home);
  const entries = [];
  const findings = [];
  const scanStats = { files: 0, archives: 0 };
  for (const component of comps) {
    component.present = [];
    for (const root of component.roots) {
      if (!fs.existsSync(path.join(home, root.path)) && !isSymlink(path.join(home, root.path))) {
        assert(root.optional, `required path is missing: ~/${root.path}`);
        continue;
      }
      component.present.push(root.path);
      const found = [];
      walk(home, root.path, found);
      for (const entry of found) {
        entry.component = component.id;
        capture(home, payload, entry);
        if (entry.type === 'symlink' && entry.link.startsWith(home + '/')) entry.home_relative = true;
        if (entry.path === '.os1/owner-policy/active.json') entry.compare = 'owner-policy';
        if (entry.type === 'file' && HOME_ADJUSTED.includes(entry.path)) {
          const refs = homeRefs(fs.readFileSync(path.join(payload, entry.path)), home);
          if (refs > 0) entry.home_refs = refs;
        }
        entries.push(entry);
      }
      scanPath(path.join(payload, root.path), root.path, !!component.vendor, findings, scanStats);
    }
  }
  // Directory modes last: a read-only directory must not block its children.
  for (const entry of entries.filter(e => e.type === 'dir').reverse()) fs.chmodSync(path.join(payload, entry.path), parseInt(entry.mode, 8));

  if (findings.length) {
    for (const finding of findings) console.error(`SECRET_SCAN ${finding.rule} ${finding.path}:${finding.line} ${finding.preview}`);
    throw new Error(`credential scan found ${findings.length} candidate secret(s); nothing was published`);
  }

  const plistEntry = entries.find(e => e.path === FLEET_PLIST);
  const plistBytes = fs.readFileSync(path.join(payload, FLEET_PLIST));
  plistEntry.variant = 'fleet-role';
  plistEntry.role = options.sourceRole;
  plistEntry.sha256_by_role = Object.fromEntries(['air', 'pro'].map(role =>
    [role, sha256(fleetRoleVariant(plistBytes, options.sourceRole, role))]));

  let mcpServers = {};
  const claudeState = path.join(home, '.claude.json');
  if (fs.existsSync(claudeState)) {
    for (const [name, server] of Object.entries(JSON.parse(fs.readFileSync(claudeState, 'utf8')).mcpServers ?? {})) {
      const keys = Object.keys(server).sort().join(',');
      assert(['type,url', 'args,command,type', 'command,type'].includes(keys),
        `user MCP server ${name} carries fields this image will not copy (${keys})`);
      mcpServers[name] = server;
    }
  }

  const releaseID = options.releaseID ?? `build${build}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}`;
  assert(/^[A-Za-z0-9._-]+$/.test(releaseID), 'invalid release id');
  const installerDir = path.join(imageRoot, 'installer');
  fs.mkdirSync(installerDir, { mode: 0o700 });
  for (const [from, name] of [
    [path.join(here, 'install.mjs'), 'install.mjs'],
    [path.join(here, 'build.mjs'), 'build.mjs'],
    [path.join(repoRoot, 'products/os1-mac-runtime/scripts/install-local-verified.mjs'), 'install-local-verified.mjs'],
    [path.join(repoRoot, 'scripts/os1-machine-sync.sh'), 'os1-machine-sync.sh'],
  ]) { fs.copyFileSync(from, path.join(installerDir, name)); fs.chmodSync(path.join(installerDir, name), 0o755); }

  const sw = name => spawnSync('/usr/bin/sw_vers', [name], { encoding: 'utf8' }).stdout.trim();
  const image = {
    schema: 1,
    product: PRODUCT,
    release_id: releaseID,
    created_at: new Date().toISOString(),
    repository: REPOSITORY,
    repository_commit: options.commit,
    source: { role: options.sourceRole, home, hostname: os.hostname(), macos: `${sw('-productVersion')} (${sw('-buildVersion')})`, arch: process.arch },
    os1: { build, version, app_main_sha256: appMain, cli_sha256: embeddedCLI, config_sha256: embeddedConfig, designated_requirement: requirement },
    claude_code: claudeCodeVersion(home),
    node_path: `payload/${NODE_DIR}/bin/node`,
    keep_names: KEEP_NAMES,
    components: comps.map(({ id, description, install = 'files', vendor = false, present }) => ({ id, description, install, vendor, roots: present })),
    entries: entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    claude_user_mcp_servers: mcpServers,
    vendor: options.skipVendorProbe ? null : vendorVersions(home),
    excluded: EXCLUDED.map(([what, reason]) => ({ what, reason })),
    secret_scan: { files_scanned: scanStats.files, archives_scanned: scanStats.archives, findings: 0,
      rules: SECRET_PATTERNS.map(([rule]) => rule).concat('credential-file-name'), allowed: allowedSecrets },
  };
  const imageJSON = Buffer.from(JSON.stringify(image, null, 2) + '\n');
  fs.writeFileSync(path.join(imageRoot, 'IMAGE.json'), imageJSON, { mode: 0o600 });

  // Package without extended attributes, ACLs or AppleDouble files: code
  // signatures live inside the bundle and quarantine must never travel.
  const packageFile = path.join(out, 'package.tar.gz');
  execFileSync('/usr/bin/tar', ['--no-xattrs', '--no-acls', '--no-fflags', '--no-mac-metadata', '-czf', packageFile, '-C', out, 'os1-machine'],
    { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
  const packageSHA = sha256File(packageFile), packageBytes = fs.statSync(packageFile).size;
  const partsDir = path.join(out, 'parts');
  fs.mkdirSync(partsDir, { mode: 0o700 });
  const prefix = `os1-machine/releases/${releaseID}/${packageSHA}`;
  const parts = splitParts(packageFile, partsDir, 'package.tar.gz').map(part => ({ key: `${prefix}/${part.name}`, sha256: part.sha256, bytes: part.bytes, file: `parts/${part.name}` }));
  const pointer = {
    schema: 1,
    product: PRODUCT,
    bucket: BUCKET,
    repository: REPOSITORY,
    repository_commit: options.commit,
    release_id: releaseID,
    created_at: image.created_at,
    source_role: options.sourceRole,
    os1_build: build,
    os1_version: version,
    image_manifest: { key: `${prefix}/IMAGE.json`, sha256: sha256(imageJSON), bytes: imageJSON.length },
    package: { sha256: packageSHA, bytes: packageBytes, parts: parts.map(({ key, sha256: digest, bytes }) => ({ key, sha256: digest, bytes })) },
    installer_path: 'os1-machine/installer/install.mjs',
    node_path: `os1-machine/payload/${NODE_DIR}/bin/node`,
    r2_installer_key: 'os1-machine/os1-machine-sync.sh',
  };
  fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(pointer, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(out, 'upload-plan.json'), JSON.stringify({ parts, image_manifest: { key: pointer.image_manifest.key, file: 'os1-machine/IMAGE.json' } }, null, 2) + '\n', { mode: 0o600 });
  const files = entries.filter(e => e.type === 'file');
  console.log(JSON.stringify({ release_id: releaseID, os1_build: build, entries: entries.length, files: files.length,
    payload_bytes: files.reduce((sum, e) => sum + e.size, 0), package_sha256: packageSHA, package_bytes: packageBytes,
    parts: parts.length, scanned_files: scanStats.files, scanned_archives: scanStats.archives }));
}

function isSymlink(file) { try { return fs.lstatSync(file).isSymbolicLink(); } catch { return false; } }

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`OS1_MACHINE_IMAGE_BUILD_FAILED: ${error.message}`); process.exit(1); }
}
