#!/usr/bin/env node
// End-to-end test of the OS-1 machine image in throwaway homes: build from a
// synthetic source Mac, publish into a local stand-in bucket, then download,
// verify and install with the real os1-machine-sync script on a different
// home (other user name, other fleet role, conflicting files), roll back, and
// check that the credential scan blocks a token. Touches no real home state.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'os1-machine-test-')));
const sha = data => createHash('sha256').update(data).digest('hex');
const write = (file, content, mode = 0o644) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); fs.chmodSync(file, mode); };
let checks = 0;
const check = (ok, message) => { assert(ok, message); checks++; };

function plist(home, role) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>OS1_CONFIG</key>
		<string>${home}/.local/bin/config.json</string>
	</dict>
	<key>Label</key>
	<string>com.os1.fleet-agent</string>
	<key>ProgramArguments</key>
	<array>
		<string>${home}/.local/bin/os1</string>
		<string>fleet-agent</string>
		<string>--role</string>
		<string>${role}</string>
	</array>
</dict>
</plist>
`;
}

function makeSource(home) {
  const app = path.join(home, 'Applications/OS-1 CLODEX.app/Contents');
  write(path.join(app, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleVersion</key><string>294</string><key>CFBundleShortVersionString</key><string>0.9.228</string></dict></plist>
`);
  write(path.join(app, 'MacOS/OS1App'), 'app-binary-294', 0o755);
  write(path.join(app, 'Resources/os1'), 'cli-binary-294', 0o755);
  write(path.join(app, 'Resources/config.json'), '{"api_url":"https://example.invalid"}\n');
  fs.copyFileSync(path.join(app, 'Resources/os1'), path.join(home, '.local/bin/os1'));
}

function populateSource(home) {
  fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true });
  makeSource(home);
  const app = path.join(home, 'Applications/OS-1 CLODEX.app/Contents');
  fs.chmodSync(path.join(home, '.local/bin/os1'), 0o755);
  fs.copyFileSync(path.join(app, 'Resources/config.json'), path.join(home, '.local/bin/config.json'));
  write(path.join(home, '.local/bin/os1-exo-monitor-sync'), '#!/bin/bash\necho exo\n', 0o755);
  fs.copyFileSync(path.join(repoRoot, 'scripts/os1-machine-sync.sh'), path.join(home, '.local/bin/os1-machine-sync'));
  fs.chmodSync(path.join(home, '.local/bin/os1-machine-sync'), 0o755);
  write(path.join(home, 'Library/LaunchAgents/com.os1.fleet-agent.plist'), plist(home, 'air'));
  const support = path.join(home, 'Library/Application Support/OS-1');
  write(path.join(support, 'settings.json'), '{"interfaceLanguage":"ko"}');
  write(path.join(support, 'backend-instructions/codex-1.md'), 'lean instructions');
  write(path.join(support, 'drift-policy/rule.json'), '{"rule":1}');
  write(path.join(support, 'drift-policy/.ledger.lock'), '');
  write(path.join(support, 'private-core/os1_local_core.py'), 'core = 1\n');
  const source = path.join(root, 'scv-source');
  write(path.join(source, 'app.js'), 'console.log("scv")\n');
  write(path.join(support, 'registered-sources/scv-instagram/abc/source.tar.gz'), '');
  execFileSync('/usr/bin/tar', ['-czf', path.join(support, 'registered-sources/scv-instagram/abc/source.tar.gz'), '-C', source, '.']);
  write(path.join(support, 'project-materials/p1/LATEST.json'), '{"latest":true}');
  write(path.join(support, 'tools/npm-12.0.2/package.json'), '{"name":"npm"}');
  write(path.join(support, 'tools/wrangler-4.127.1/node_modules/wrangler/package.json'), '{"version":"4.127.1"}');
  fs.mkdirSync(path.join(support, 'tools/wrangler-4.127.1/node_modules/.bin'), { recursive: true });
  fs.symlinkSync('../wrangler/bin/wrangler.js', path.join(support, 'tools/wrangler-4.127.1/node_modules/.bin/wrangler'));
  const policyText = `RCC ENGINE v26 owner policy; original at ${home}/.os1/owner-policy\n`;
  const policySHA = sha(policyText);
  write(path.join(home, '.os1/owner-policy', `${policySHA}.txt`), policyText, 0o600);
  write(path.join(home, '.os1/owner-policy/active.json'), JSON.stringify({ schema: 1, sourceSHA256: policySHA, sourceFile: `${policySHA}.txt`,
    projectionSHA256: 'p', projection: 'proj', sourceID: 'x-coredata://AIR/ICNote/p1', sourceModified: '100', checkedAt: 1000.5, routing: 'r' }), 0o600);
  write(path.join(home, '.os1/owner-policy/sync.lock'), '');
  write(path.join(home, '.os1/owner-policy/.claude/.cc-writes/x'), 'runtime');
  write(path.join(home, '.claude/CLAUDE.md'), `# instructions\nengine at ${home}/.claude/OMAR_LUA_RCC_ENGINE_v26_CURRENT.txt\n`);
  write(path.join(home, '.claude/OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED.txt'), 'engine clean');
  write(path.join(home, '.claude/OMAR_LUA_RCC_ENGINE_v26_CURRENT.txt'), 'engine current');
  write(path.join(home, '.claude/omar-authority/RCC_ENGINE_v26.md'), 'authority');
  write(path.join(home, '.claude/settings.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: `'${home}/.local/bin/os1' exo-claude-hook` }] }] },
    permissions: { additionalDirectories: [home, `${home}/.codex`] } }, null, 2));
  write(path.join(home, '.claude/hooks/remote-backup-guard.mjs'), 'export {}\n', 0o755);
  write(path.join(home, '.claude/skills/os1-skill/SKILL.md'), '---\nname: os1-skill\n---\n');
  fs.mkdirSync(path.join(home, '.claude/commands'), { recursive: true });
  write(path.join(home, '.local/share/claude/versions/2.1.286'), 'claude-code-2.1.286', 0o755);
  fs.symlinkSync(path.join(home, '.local/share/claude/versions/2.1.286'), path.join(home, '.local/bin/claude'));
  write(path.join(home, '.codex/AGENTS.md'), 'codex agents');
  write(path.join(home, '.codex/OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED_TEXT2_7.txt'), 'codex engine');
  write(path.join(home, '.codex/workflows/evidence.md'), 'workflow');
  write(path.join(home, '.codex/config.toml'), `model = "gpt-6.1-sol"\nmodel_instructions_file = "${home}/.codex/OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED_TEXT2_7.txt"\n[projects."${home}"]\ntrust_level = "trusted"\n`, 0o600);
  write(path.join(home, '.codex/hooks.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: `'${home}/.local/bin/os1' exo-codex-hook` }] }] } }), 0o600);
  // The installer runs with the image's own Node.js: link the real binary.
  fs.mkdirSync(path.join(home, '.local/share/node-v24.20.0/bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, '.local/share/node-v24.20.0/bin/node'));
  write(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { 'cloudflare-api': { type: 'http', url: 'https://mcp.cloudflare.com/mcp' } }, oauthAccount: { emailAddress: 'never-copied' } }));
}

function populateTarget(home) {
  // An older OS-1 and a few conflicting files, as an out-of-date Mac would have.
  write(path.join(home, 'Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App'), 'app-binary-150', 0o755);
  write(path.join(home, 'Applications/OS-1 CLODEX.app/Contents/Resources/old-only'), 'old');
  write(path.join(home, '.local/bin/os1'), 'cli-binary-150', 0o755);
  write(path.join(home, 'Library/LaunchAgents/com.os1.fleet-agent.plist'), plist(home, 'pro').replace('fleet-agent', 'fleet-agent-old'));
  write(path.join(home, '.claude/settings.json'), '{"theme":"light"}');
  write(path.join(home, '.claude/skills/pro-only-skill/SKILL.md'), 'pro only');
  write(path.join(home, '.claude/skills/os1-skill'), 'a file where the image has a directory');
  write(path.join(home, '.codex/auth.json'), '{"never":"touched"}', 0o600);
  write(path.join(home, 'Library/Application Support/OS-1/sessions.json'), '{"sessions":[],"queued":[],"inFlight":[]}');
  write(path.join(home, 'Library/Application Support/OS-1/drift-policy/.ledger.lock'), 'pro-lock');
  const source = fs.readFileSync(path.join(srcHome, '.os1/owner-policy/active.json'), 'utf8');
  const policy = JSON.parse(source); policy.checkedAt = 2000.25; policy.sourceID = 'x-coredata://PRO/ICNote/p9';
  write(path.join(home, '.os1/owner-policy/active.json'), JSON.stringify(policy), 0o600);
  write(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'pro-account' }, numStartups: 3 }));
}

function snapshot(home) {
  const out = {};
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop();
    for (const name of fs.readdirSync(path.join(home, rel))) {
      const child = rel ? `${rel}/${name}` : name;
      if (child === '.os1/recovery' || child === '.os1/machine-sync.lock') continue;
      const stat = fs.lstatSync(path.join(home, child));
      if (stat.isSymbolicLink()) out[child] = `link:${fs.readlinkSync(path.join(home, child))}`;
      else if (stat.isDirectory()) { out[child] = `dir:${(stat.mode & 0o777).toString(8)}`; stack.push(child); }
      else out[child] = `file:${(stat.mode & 0o777).toString(8)}:${sha(fs.readFileSync(path.join(home, child)))}`;
    }
  }
  return out;
}

const node = process.execPath;
const runNode = (args, env = {}) => spawnSync(node, args, { encoding: 'utf8', env: { ...process.env, ...env } });
const srcHome = path.join(root, 'os1-machine-test-air', 'LUA');
const dstHome = path.join(root, 'os1-machine-test-pro', 'lua2');
fs.mkdirSync(srcHome, { recursive: true }); fs.mkdirSync(dstHome, { recursive: true });
populateSource(srcHome);
populateTarget(dstHome);

const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const out = path.join(root, 'out');
let built = runNode([path.join(here, 'build.mjs'), '--out', out, '--repository-commit', commit, '--home', srcHome, '--skip-vendor-probe', '--release-id', 'build294-test'],
  { HOME: srcHome });
check(built.status === 0, `build failed: ${built.stderr}`);
const summary = JSON.parse(built.stdout.trim().split('\n').pop());
check(summary.os1_build === '294' && summary.parts === 1 && summary.scanned_archives === 1, `unexpected build summary ${built.stdout}`);
const image = JSON.parse(fs.readFileSync(path.join(out, 'os1-machine/IMAGE.json'), 'utf8'));
const paths = new Set(image.entries.map(e => e.path));
check(!paths.has('.os1/owner-policy/sync.lock') && !paths.has('.os1/owner-policy/.claude') && !paths.has('Library/Application Support/OS-1/drift-policy/.ledger.lock'), 'runtime-only files captured');
check(![...paths].some(p => p.includes('auth.json') || p === '.claude.json'), 'credentials or Claude state captured');
check(image.claude_user_mcp_servers['cloudflare-api'].url === 'https://mcp.cloudflare.com/mcp', 'user MCP server not captured');
check(image.entries.find(e => e.path === '.local/bin/claude').home_relative === true, 'claude link not marked home-relative');
check(image.entries.find(e => e.path === '.claude/settings.json').home_refs >= 2, 'home references not recorded');

// Local stand-in bucket at the same keys as R2.
const bucket = path.join(root, 'bucket');
const pointer = JSON.parse(fs.readFileSync(path.join(out, 'latest.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(out, 'upload-plan.json'), 'utf8'));
for (const part of plan.parts) write(path.join(bucket, part.key), fs.readFileSync(path.join(out, part.file)));
write(path.join(bucket, plan.image_manifest.key), fs.readFileSync(path.join(out, plan.image_manifest.file)));
write(path.join(bucket, 'os1-machine/latest.json'), fs.readFileSync(path.join(out, 'latest.json')));
check(pointer.package.parts.length === 1 && pointer.image_manifest.sha256 === sha(fs.readFileSync(path.join(out, 'os1-machine/IMAGE.json'))), 'pointer does not bind the manifest');

const sync = (args, home = dstHome) => spawnSync('/bin/bash', [path.join(repoRoot, 'scripts/os1-machine-sync.sh'), ...args],
  { encoding: 'utf8', env: { ...process.env, HOME: home, TMPDIR: path.join(root, 'tmp'), OS1_MACHINE_TEST_MODE: '1', OS1_MACHINE_SYNC_TEST_BUCKET_DIR: bucket } });
fs.mkdirSync(path.join(root, 'tmp'));

// 1. Role guard: a Mac configured as pro is not silently turned into air.
let result = sync(['air']);
check(result.status === 1 && /configured as pro/.test(result.stderr), `role guard failed: ${result.stdout}${result.stderr}`);
const before = snapshot(dstHome);

// 2. verify-only reports differences and changes nothing.
result = sync(['pro', '--verify-only']);
check(result.status === 3 && /OS1_MACHINE_IMAGE_DIFFERENT/.test(result.stdout), `verify-only should report differences: ${result.stdout}${result.stderr}`);
check(JSON.stringify(snapshot(dstHome)) === JSON.stringify(before), 'verify-only changed the target');

// 3. Install, then the target equals the image.
result = sync(['pro']);
check(result.status === 0 && /OS1_MACHINE_IMAGE_INSTALLED/.test(result.stdout), `install failed: ${result.stdout}${result.stderr}`);
result = sync(['pro', '--verify-only']);
check(result.status === 0 && /OS1_MACHINE_IMAGE_IDENTICAL/.test(result.stdout), `not identical after install: ${result.stdout}${result.stderr}`);
const plistText = fs.readFileSync(path.join(dstHome, 'Library/LaunchAgents/com.os1.fleet-agent.plist'), 'utf8');
check(plistText.includes('<string>pro</string>') && !plistText.includes('<string>air</string>') && plistText.includes(`${dstHome}/.local/bin/os1`), 'fleet plist not pro/home-adjusted');
check(fs.readlinkSync(path.join(dstHome, '.local/bin/claude')) === path.join(dstHome, '.local/share/claude/versions/2.1.286'), 'claude link not home-adjusted');
check(fs.readFileSync(path.join(dstHome, '.claude/settings.json'), 'utf8').includes(`'${dstHome}/.local/bin/os1'`), 'settings not home-adjusted');
check(fs.readFileSync(path.join(dstHome, '.claude/CLAUDE.md'), 'utf8') === fs.readFileSync(path.join(srcHome, '.claude/CLAUDE.md'), 'utf8').split(srcHome + '/').join(dstHome + '/'), 'instruction paths not home-adjusted');
const policyFile = fs.readdirSync(path.join(srcHome, '.os1/owner-policy')).find(n => n.endsWith('.txt'));
check(fs.readFileSync(path.join(dstHome, '.os1/owner-policy', policyFile), 'utf8') === fs.readFileSync(path.join(srcHome, '.os1/owner-policy', policyFile), 'utf8'), 'content-addressed policy must stay byte-identical');
check(fs.readFileSync(path.join(dstHome, 'Applications/OS-1 CLODEX.app/Contents/MacOS/OS1App'), 'utf8') === 'app-binary-294', 'app not installed');
check(!fs.existsSync(path.join(dstHome, 'Applications/OS-1 CLODEX.app/Contents/Resources/old-only')), 'old app file survived');
check(fs.readFileSync(path.join(dstHome, '.codex/auth.json'), 'utf8') === '{"never":"touched"}', 'login file touched');
check(JSON.parse(fs.readFileSync(path.join(dstHome, '.os1/owner-policy/active.json'), 'utf8')).sourceID === 'x-coredata://PRO/ICNote/p9', 'equal owner policy was rewritten');
check(fs.readFileSync(path.join(dstHome, 'Library/Application Support/OS-1/drift-policy/.ledger.lock'), 'utf8') === 'pro-lock', 'runtime lock moved');
const claudeState = JSON.parse(fs.readFileSync(path.join(dstHome, '.claude.json'), 'utf8'));
check(claudeState.oauthAccount.emailAddress === 'pro-account' && claudeState.numStartups === 3 && claudeState.mcpServers['cloudflare-api'], 'Claude state not merged correctly');
const recovery = fs.readdirSync(path.join(dstHome, '.os1/recovery')).filter(n => n.startsWith('machine-sync-'));
check(recovery.length === 1, 'one recovery directory expected');
const recoveryDir = path.join(dstHome, '.os1/recovery', recovery[0]);
check(fs.readFileSync(path.join(recoveryDir, 'backup/.claude/skills/pro-only-skill/SKILL.md'), 'utf8') === 'pro only', 'extra skill not preserved');
check(JSON.parse(fs.readFileSync(path.join(recoveryDir, 'receipt.json'), 'utf8')).verification.differences.length === 0, 'receipt shows differences');

// 4. Second run changes nothing.
result = sync(['pro']);
check(result.status === 0 && /"changed": \{\}/.test(result.stdout), `second install was not a no-op: ${result.stdout}`);

// 5. Rollback restores the pre-install state exactly.
result = runNode([path.join(out, 'os1-machine/installer/install.mjs'), '--rollback', recoveryDir], { HOME: dstHome, OS1_MACHINE_TEST_MODE: '1' });
check(result.status === 0 && /OS1_MACHINE_IMAGE_ROLLED_BACK/.test(result.stdout), `rollback failed: ${result.stdout}${result.stderr}`);
const restored = snapshot(dstHome);
const changed = Object.keys({ ...before, ...restored }).filter(k => before[k] !== restored[k] && k !== '.claude.json');
check(changed.length === 0, `rollback left differences: ${changed.join(', ')}`);
check(!JSON.parse(fs.readFileSync(path.join(dstHome, '.claude.json'), 'utf8')).mcpServers?.['cloudflare-api'], 'MCP server not rolled back');

// 6. A failure part-way restores everything automatically.
fs.rmSync(path.join(dstHome, '.os1/recovery'), { recursive: true, force: true });
const blocker = path.join(dstHome, '.codex');
fs.chmodSync(blocker, 0o500); // codex components cannot be written
result = sync(['pro']);
fs.chmodSync(blocker, 0o755);
check(result.status === 1 && /OS1_MACHINE_IMAGE_FAILED/.test(result.stderr), `injected failure not reported: ${result.stdout}${result.stderr}`);
const afterFailure = snapshot(dstHome);
const leftovers = Object.keys({ ...before, ...afterFailure }).filter(k => before[k] !== afterFailure[k] && k !== '.claude.json');
check(leftovers.length === 0, `failed install was not rolled back: ${leftovers.join(', ')}`);

// 7. A tampered part is rejected before anything is extracted.
const partKey = pointer.package.parts[0].key;
const good = fs.readFileSync(path.join(bucket, partKey));
const bad = Buffer.from(good); bad[bad.length - 1] ^= 1;
fs.writeFileSync(path.join(bucket, partKey), bad);
result = sync(['pro', '--verify-only']);
fs.writeFileSync(path.join(bucket, partKey), good);
check(result.status === 1 && !/OS1_MACHINE_IMAGE_R2_VERIFIED/.test(result.stdout) && /part 0 failed its SHA-256 check/.test(result.stderr),
  `tampered part accepted: status=${result.status} ${result.stdout.slice(-400)} ${result.stderr.slice(-400)}`);
// The same under the bash every Mac ships (3.2), where set -e ignores [[ ]].
check(/^#!\/usr\/bin\/env bash/.test(fs.readFileSync(path.join(repoRoot, 'scripts/os1-machine-sync.sh'), 'utf8')), 'sync script shebang changed');

// 8. The credential scan blocks a token anywhere in the captured files.
const token = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
write(path.join(srcHome, '.claude/skills/os1-skill/notes.md'), `token = ${token}\n`);
built = runNode([path.join(here, 'build.mjs'), '--out', path.join(root, 'out-secret'), '--repository-commit', commit, '--home', srcHome, '--skip-vendor-probe'], { HOME: srcHome });
check(built.status === 1 && /SECRET_SCAN github-token \.claude\/skills\/os1-skill\/notes\.md:1/.test(built.stderr) && !built.stderr.includes(token), `secret scan did not block: ${built.stderr}`);
fs.rmSync(path.join(srcHome, '.claude/skills/os1-skill/notes.md'));
const archiveSecret = path.join(root, 'scv-secret');
write(path.join(archiveSecret, '.env'), 'X=1\n');
execFileSync('/usr/bin/tar', ['-czf', path.join(srcHome, 'Library/Application Support/OS-1/project-materials/p1/leak.tar.gz'), '-C', archiveSecret, '.']);
built = runNode([path.join(here, 'build.mjs'), '--out', path.join(root, 'out-secret2'), '--repository-commit', commit, '--home', srcHome, '--skip-vendor-probe'], { HOME: srcHome });
check(built.status === 1 && /credential-file-name .*leak\.tar\.gz!\/\.env/.test(built.stderr), `secret file inside archive not blocked: ${built.stderr}`);

fs.rmSync(root, { recursive: true, force: true });
console.log(`OS1_MACHINE_IMAGE_TEST_OK checks=${checks}`);
