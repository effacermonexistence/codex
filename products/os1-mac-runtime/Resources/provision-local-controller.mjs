#!/usr/bin/env node
// Stock-macOS first-run continuation after provision-local-controller.sh has
// installed a hash-pinned Node runtime. No Python, Xcode CLT, hosted model,
// login, browser session, or another application's state is required.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const contractOnly = args.includes('--verify-contract-only');
const ensure = args.includes('--ensure');
const flag = args.indexOf('--resources');
if ((!ensure && !contractOnly) || (ensure && contractOnly) || flag < 0 || args.length !== 3 || flag !== 1) {
  process.stderr.write('OS-1 local controller: expected --ensure|--verify-contract-only --resources PATH\n');
  process.exit(2);
}
const resources = fs.realpathSync(args[flag + 1]);
const root = path.join(os.homedir(), '.os1/local-router');
const tools = path.join(os.homedir(), 'Library/Application Support/OS-1/tools');
const model = 'qwen3.5:4b';
const endpoint = 'http://127.0.0.1:11434';
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const fileHash = (file, algorithm = 'sha256') => hash(fs.readFileSync(file), algorithm);
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const regular = file => fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
const exact = (truth, code) => { if (!truth) throw new Error(code); };
const atomic = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
};
const cleanEnv = (extra = {}) => ({
  HOME: path.join(root, 'runtime-home'), PATH: path.dirname(process.execPath) + ':/usr/bin:/bin:/usr/sbin:/sbin',
  LANG: 'en_US.UTF-8', OLLAMA_HOST: '127.0.0.1:11434', OLLAMA_MODELS: path.join(root, 'models'),
  OLLAMA_NO_CLOUD: '1', OPENCLAW_HOME: path.join(root, 'runtime-home'),
  OPENCLAW_STATE_DIR: path.join(root, 'state'), OPENCLAW_CONFIG_PATH: path.join(root, 'config.json'),
  OPENCLAW_LOAD_SHELL_ENV: '0', npm_config_userconfig: path.join(root, 'runtime-home/npm-user.npmrc'),
  npm_config_globalconfig: path.join(root, 'runtime-home/npm-global.npmrc'),
  npm_config_cache: path.join(root, 'runtime-home/npm-cache'), ...extra,
});
function run(file, argv, cwd, timeout = 120000) {
  const result = spawnSync(file, argv, { cwd, env: cleanEnv(), input: '', encoding: 'utf8',
    timeout, maxBuffer: 4_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
  // Never copy raw diagnostics into a visible receipt: tool output can include
  // unrelated user data or accidental credentials.
  exact(result.status === 0, 'runtime_command_failed');
  return (result.stdout || '').trim();
}
function contract() {
  const sources = readJSON(path.join(resources, 'local-controller-sources.json'));
  const pkg = readJSON(path.join(resources, 'local-controller-package.json'));
  const lock = readJSON(path.join(resources, 'local-controller-package-lock.json'));
  const template = readJSON(path.join(resources, 'local-router-config.template.json'));
  exact(sources.schema === 1 && sources.delivery === 'verified-first-run-fetch-not-offline-bundle', 'source_contract_invalid');
  exact(sources.controller.version === '2026.9.9' && sources.controller.name === 'openclaw', 'controller_identity_invalid');
  exact(sources.ollama.version === '0.35.1' && sources.model.name === model && /^[a-f0-9]{64}$/.test(sources.model.digest), 'model_identity_invalid');
  exact(sources.node.version === '24.20.0', 'node_identity_invalid');
  const tarball = sources.controller.url;
  exact(tarball === 'https://registry.npmjs.org/openclaw/-/openclaw-2026.9.9.tgz', 'controller_source_invalid');
  exact(pkg.private === true && pkg.name === lock.name && pkg.version === lock.version && pkg.dependencies?.openclaw === tarball, 'dependency_package_invalid');
  exact(lock.lockfileVersion === 3 && lock.packages?.['']?.name === pkg.name &&
    lock.packages?.['']?.version === pkg.version && lock.packages?.['']?.dependencies?.openclaw === tarball, 'dependency_lock_root_invalid');
  const entry = lock.packages['node_modules/openclaw'];
  exact(entry.version === '2026.9.9' && entry.resolved === tarball && entry.integrity === sources.controller.integrity, 'dependency_lock_controller_invalid');
  for (const [name, item] of Object.entries(lock.packages)) {
    if (!item.resolved) continue;
    exact(item.resolved.startsWith('https://registry.npmjs.org/') && item.integrity?.startsWith('sha512-'),
      'dependency_lock_unpinned_' + name.replace(/[^a-z0-9]/gi, '_').slice(0, 40));
  }
  exact(template.models?.mode === 'replace' && Object.keys(template.models.providers || {}).join() === 'ollama' &&
    template.models.providers.ollama.baseUrl === endpoint && template.browser?.enabled === false &&
    JSON.stringify(template.tools?.deny) === '["*"]', 'local_only_config_invalid');
  for (const arch of ['arm64', 'x86_64']) {
    exact(sources.node[arch].url.startsWith('https://nodejs.org/dist/v24.20.0/') &&
      /^[a-f0-9]{64}$/.test(sources.node[arch].sha256) &&
      /^[a-f0-9]{64}$/.test(sources.node[arch].binary_sha256), 'node_pin_invalid');
  }
  exact(sources.ollama.url === 'https://github.com/ollama/ollama/releases/download/v0.35.1/ollama-darwin.tgz' &&
    /^[a-f0-9]{64}$/.test(sources.ollama.sha256) && /^[a-f0-9]{64}$/.test(sources.ollama.binary_sha256), 'ollama_pin_invalid');
  return { sources, pkg, lock, template };
}
function mark(phase, reason = '', extra = {}) {
  atomic(path.join(root, 'provision-status.json'), JSON.stringify({ schema: 1, phase, reason,
    observed_at: new Date().toISOString(), source_contract_sha256: fileHash(path.join(resources, 'local-controller-sources.json')),
    delivery: 'verified-first-run-fetch-not-offline-bundle', ...extra }) + '\n');
}
async function download(url, target, expected, bound, algorithm = 'sha256') {
  if (fs.existsSync(target)) {
    exact(regular(target) && fileHash(target, algorithm) === expected, 'cached_archive_identity_mismatch');
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  exact(response.ok && new URL(response.url).protocol === 'https:', 'public_download_failed');
  const tmp = target + '.' + process.pid + '.tmp';
  const output = fs.openSync(tmp, 'wx', 0o600);
  let size = 0;
  try {
    for await (const chunk of response.body) {
      size += chunk.length;
      exact(size <= bound, 'public_download_exceeds_bound');
      fs.writeSync(output, chunk);
    }
    fs.closeSync(output);
    exact(fileHash(tmp, algorithm) === expected, 'public_download_digest_mismatch');
    fs.renameSync(tmp, target);
  } catch (error) {
    try { fs.closeSync(output); } catch {}
    throw error;
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
function extract(archive, destination, strip = 0) {
  const listing = run('/usr/bin/tar', ['-tzf', archive], root, 120000).split('\n');
  exact(listing.length <= 20000 && listing.every(name => name && !name.startsWith('/') &&
    !name.split('/').includes('..')), 'unsafe_archive_path');
  fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
  run('/usr/bin/tar', ['-xzf', archive, '-C', destination, ...(strip ? [`--strip-components=${strip}`] : [])], root, 180000);
}
async function localHTTP(pathname, timeout = 5000) {
  try {
    const response = await fetch(endpoint + pathname, { signal: AbortSignal.timeout(timeout) });
    if (!response.ok) return null;
    const body = await response.text();
    return body.length <= 128000 ? JSON.parse(body) : null;
  } catch { return null; }
}
const hasModel = (listing, sources) => listing?.models?.some(item => item.name === model && item.digest === sources.model.digest) === true;
async function ensureOllama(sources) {
  const live = await localHTTP('/api/version', 3000);
  if (live) {
    exact(live.version === sources.ollama.version && hasModel(await localHTTP('/api/tags'), sources),
      'occupied_ollama_port_is_not_pinned_sidecar');
    return 'compatible_existing_loopback';
  }
  const prefix = path.join(tools, 'ollama-v0.35.1');
  exact(!fs.existsSync(prefix) || !fs.lstatSync(prefix).isSymbolicLink(), 'ollama_prefix_symlink');
  const archive = path.join(root, 'recovery/ollama-darwin-v0.35.1.tgz');
  await download(sources.ollama.url, archive, sources.ollama.sha256, sources.ollama.size);
  const executable = path.join(prefix, 'ollama');
  // Never extract into the activated prefix. A crash during tar previously
  // left that prefix present but incomplete, so every later launch skipped
  // extraction and was permanently blocked. Preserve a bad old prefix for
  // diagnosis; stage and verify a fresh one before the atomic rename.
  if (fs.existsSync(prefix) && (!regular(executable) || fileHash(executable) !== sources.ollama.binary_sha256)) {
    const preserved = path.join(root, 'recovery', 'ollama-incomplete-' + Date.now() + '-' + process.pid);
    fs.renameSync(prefix, preserved);
  }
  if (!fs.existsSync(prefix)) {
    const stage = path.join(tools, '.ollama-v0.35.1.stage.' + process.pid + '.' + Date.now());
    try {
      extract(archive, stage);
      const stagedExecutable = path.join(stage, 'ollama');
      exact(regular(stagedExecutable) && fileHash(stagedExecutable) === sources.ollama.binary_sha256,
        'staged_ollama_binary_mismatch');
      fs.renameSync(stage, prefix);
    } catch (error) {
      // This stage contains only bytes unpacked from our immutable archive,
      // never an existing user state or model. It is safe to discard and retry.
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  }
  exact(regular(executable) && fileHash(executable) === sources.ollama.binary_sha256, 'installed_ollama_binary_mismatch');
  fs.mkdirSync(path.join(root, 'models'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(root, 'runtime-home'), { recursive: true, mode: 0o700 });
  const log = path.join(root, 'ollama-serve.log');
  const fd = fs.openSync(log, 'a', 0o600);
  try {
    const child = spawn(executable, ['serve'], { cwd: prefix, env: cleanEnv(), detached: true,
      stdio: ['ignore', fd, fd] });
    child.unref();
  } finally { fs.closeSync(fd); }
  let version = null;
  for (let i = 0; i < 60; i++) {
    version = await localHTTP('/api/version', 1000);
    if (version) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  exact(version?.version === sources.ollama.version, 'pinned_ollama_server_did_not_start');
  if (!hasModel(await localHTTP('/api/tags'), sources)) {
    const pulled = spawnSync(executable, ['pull', model], { cwd: prefix, env: cleanEnv(),
      timeout: 3600000, stdio: 'ignore' });
    exact(pulled.status === 0, 'public_model_download_failed');
  }
  exact(hasModel(await localHTTP('/api/tags'), sources), 'downloaded_model_digest_mismatch');
  return 'managed_local_sidecar';
}
function sbom(sources, lock) {
  const prefix = path.join(tools, 'openclaw-2026.9.9');
  const packages = [];
  for (const [relative, expected] of Object.entries(lock.packages).sort()) {
    if (!relative) continue;
    exact(relative.startsWith('node_modules/') && !relative.split('/').includes('..'), 'sbom_lock_path_invalid');
    const manifest = path.join(prefix, relative, 'package.json');
    if (!fs.existsSync(manifest)) {
      exact(expected.optional === true, 'required_dependency_missing');
      continue;
    }
    exact(regular(manifest) && fs.statSync(manifest).size <= 256000, 'dependency_manifest_invalid');
    const actual = readJSON(manifest);
    exact(typeof actual.name === 'string' && actual.version === expected.version, 'dependency_version_mismatch');
    const row = { name: actual.name, version: actual.version,
      license: typeof actual.license === 'string' && actual.license ? actual.license : 'UNKNOWN',
      package_json_sha256: fileHash(manifest), lock_integrity: expected.integrity || null };
    for (const notice of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE']) {
      const file = path.join(path.dirname(manifest), notice);
      if (regular(file) && fs.statSync(file).size <= 200000) {
        row.license_file = notice; row.license_file_sha256 = fileHash(file); break;
      }
    }
    packages.push(row);
  }
  exact(packages.some(p => p.name === 'openclaw' && p.version === '2026.9.9'), 'sbom_missing_openclaw');
  const receipt = path.join(root, 'recovery/installed-controller-sbom.json');
  atomic(receipt, JSON.stringify({ schema: 1, source: 'installed_private_npm_tree_after_integrity_locked_ci',
    openclaw: sources.controller.version, ollama: sources.ollama.version, node: sources.node.version,
    model, model_digest: sources.model.digest,
    undeclared_license_count: packages.filter(p => p.license === 'UNKNOWN').length, packages }, null, 2) + '\n');
  return { installed_package_count: packages.length, installed_sbom_sha256: fileHash(receipt) };
}
async function ensureOpenClaw(c) {
  const prefix = path.join(tools, 'openclaw-2026.9.9');
  exact(!fs.existsSync(prefix) || !fs.lstatSync(prefix).isSymbolicLink(), 'controller_prefix_symlink');
  const entry = path.join(prefix, 'node_modules/openclaw/openclaw.mjs');
  fs.mkdirSync(prefix, { recursive: true, mode: 0o700 });
  for (const [file, source] of [['package.json', 'local-controller-package.json'],
                                ['package-lock.json', 'local-controller-package-lock.json']]) {
    const target = path.join(prefix, file);
    const bytes = fs.readFileSync(path.join(resources, source));
    if (!fs.existsSync(target)) atomic(target, bytes);
    else exact(regular(target) && fileHash(target) === hash(bytes), 'installed_dependency_contract_changed');
  }
  const home = path.join(root, 'runtime-home');
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  for (const file of ['npm-user.npmrc', 'npm-global.npmrc']) {
    const target = path.join(home, file);
    if (!fs.existsSync(target)) atomic(target, '');
    else exact(regular(target) && fs.statSync(target).size === 0, 'private_npm_config_not_empty');
  }
  if (!regular(entry)) {
    const npm = path.join(path.dirname(process.execPath), 'npm');
    run(process.execPath, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], prefix, 1200000);
    exact(regular(entry), 'openclaw_entry_missing_after_ci');
    const lifecycle = [
      ['preinstall-package-manager-warning.mjs', '644fe3f8e80eba51b296ed406e546d65474d8f5d2bf2d34615ad6487881d4c9b'],
      ['postinstall-bundled-plugins.mjs', '46f51eda38ca5342ae2fdb0c902f0f42a2047abc785bbf8252c4fc42ff4b3e68']];
    for (const [name, digest] of lifecycle) {
      const script = path.join(prefix, 'node_modules/openclaw/scripts', name);
      exact(regular(script) && fileHash(script) === digest, 'reviewed_lifecycle_identity_mismatch');
      run(process.execPath, [script], path.dirname(entry), 120000);
    }
  }
  const manifest = readJSON(path.join(prefix, 'node_modules/openclaw/package.json'));
  exact(manifest.name === 'openclaw' && manifest.version === '2026.9.9' &&
    manifest.repository?.url === 'git+https://github.com/openclaw/openclaw.git', 'installed_openclaw_identity_mismatch');
  exact(!fs.existsSync(path.join(prefix, 'node_modules/openclaw/.openclaw-lifecycle-pending')), 'openclaw_lifecycle_pending');
  const config = path.join(root, 'config.json');
  const template = structuredClone(c.template);
  template.agents.defaults.workspace = path.join(root, 'workspace');
  fs.mkdirSync(template.agents.defaults.workspace, { recursive: true, mode: 0o700 });
  const bytes = JSON.stringify(template, null, 2) + '\n';
  if (!fs.existsSync(config)) atomic(config, bytes);
  else exact(regular(config) && fileHash(config) === hash(bytes), 'existing_local_router_config_changed');
  run(process.execPath, [entry, 'config', 'validate', '--json'], root, 60000);
  return { entry_sha256: fileHash(entry), config_sha256: fileHash(config),
    dependency_package_sha256: fileHash(path.join(prefix, 'package.json')),
    dependency_lock_sha256: fileHash(path.join(prefix, 'package-lock.json')) };
}
async function legacyReady(c) {
  const manifestFile = path.join(root, 'manifest.json');
  if (!regular(manifestFile)) return false;
  const manifest = readJSON(manifestFile);
  if (manifest.enabled !== true || manifest.model !== model ||
      manifest.provisioning_version !== undefined || manifest.openclaw_version !== '2026.9.9' ||
      manifest.model_digest !== c.sources.model.digest) return false;
  const entry = path.join(tools, 'openclaw-2026.9.9/node_modules/openclaw/openclaw.mjs');
  const config = path.join(root, 'config.json');
  if (!regular(entry) || !regular(config) || manifest.entry_sha256 !== fileHash(entry) ||
      manifest.config_sha256 !== fileHash(config)) return false;
  const settings = readJSON(config);
  if (settings.models?.mode !== 'replace' || Object.keys(settings.models?.providers || {}).join() !== 'ollama' ||
      settings.models.providers.ollama.baseUrl !== endpoint || settings.browser?.enabled !== false ||
      JSON.stringify(settings.tools?.deny) !== '["*"]') return false;
  const version = await localHTTP('/api/version', 3000);
  return version?.version === c.sources.ollama.version && hasModel(await localHTTP('/api/tags'), c.sources);
}
async function main() {
  const c = contract();
  if (contractOnly) {
    process.stdout.write(JSON.stringify({ status: 'PASS', delivery: c.sources.delivery,
      model, model_digest: c.sources.model.digest, model_calls: 0, network_calls: 0 }) + '\n');
    return;
  }
  exact(process.platform === 'darwin', 'macos_required');
  for (const owned of [path.join(os.homedir(), '.os1'), root,
    path.join(os.homedir(), 'Library/Application Support/OS-1'), tools,
    path.join(root, 'recovery'), path.join(root, 'models'), path.join(root, 'runtime-home')]) {
    exact(!fs.existsSync(owned) || !fs.lstatSync(owned).isSymbolicLink(), 'owned_path_symlink');
  }
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, '.provisioning');
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pidFile = path.join(lock, 'pid');
    const pid = regular(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8')) : 0;
    if (pid > 0) { try { process.kill(pid, 0); return; } catch {} }
    const preserved = lock + '.interrupted.' + Date.now();
    fs.renameSync(lock, preserved);
    fs.mkdirSync(lock, { mode: 0o700 });
  }
  fs.writeFileSync(path.join(lock, 'pid'), String(process.pid), { mode: 0o600 });
  try {
    mark('provisioning');
    if (await legacyReady(c)) {
      mark('ready', '', { model_digest: c.sources.model.digest, runtime_mode: 'legacy_verified_existing',
        controller_version: c.sources.controller.version, offline_bundle: false, hosted_provider_calls: 0 });
      return;
    }
    exact(fileHash(process.execPath) === c.sources.node[process.arch === 'x64' ? 'x86_64' : 'arm64'].binary_sha256,
      'managed_node_binary_mismatch');
    mark('provisioning', '', { step: 'local_model' });
    const runtimeMode = await ensureOllama(c.sources);
    mark('provisioning', '', { step: 'openclaw' });
    const installed = await ensureOpenClaw(c);
    const manifest = { enabled: true, openclaw_version: c.sources.controller.version,
      model, model_digest: c.sources.model.digest, entry_sha256: installed.entry_sha256,
      config_sha256: installed.config_sha256, provisioning_version: 1,
      node_sha256: fileHash(process.execPath), ollama_version: c.sources.ollama.version,
      dependency_package_sha256: installed.dependency_package_sha256,
      dependency_lock_sha256: installed.dependency_lock_sha256 };
    const inventory = sbom(c.sources, c.lock);
    const activation = path.join(root, 'manifest.json');
    if (!fs.existsSync(activation)) atomic(activation, JSON.stringify(manifest, null, 2) + '\n');
    else {
      exact(regular(activation), 'existing_controller_activation_changed');
      const existing = readJSON(activation);
      // JSON object key order is not architecture state. The optional Python
      // maintenance path writes the same verified v1 fields in another order.
      exact(Object.keys(existing).sort().join('|') === Object.keys(manifest).sort().join('|') &&
        Object.entries(manifest).every(([key, value]) => existing[key] === value),
        'existing_controller_activation_changed');
    }
    mark('ready', '', { model_digest: c.sources.model.digest, runtime_mode: runtimeMode,
      controller_version: c.sources.controller.version, offline_bundle: false,
      hosted_provider_calls: 0, ...inventory });
  } catch (error) {
    mark('blocked', String(error?.message || 'unknown').replace(/[^a-z0-9_]/gi, '_').slice(0, 100));
    process.exitCode = 1;
  } finally {
    fs.unlinkSync(path.join(lock, 'pid'));
    fs.rmdirSync(lock);
  }
}
main().catch(error => { process.stderr.write('OS-1 local controller contract rejected: ' +
  String(error?.message || 'unknown').replace(/[^a-z0-9_]/gi, '_').slice(0, 80) + '\n'); process.exitCode = 1; });
