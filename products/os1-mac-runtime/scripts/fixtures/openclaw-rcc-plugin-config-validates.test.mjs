// Review of build 446 (DESIGN-5 §B): the RCC gateway's plugin config must be
// one the pinned OpenClaw accepts. The host writes
// plugins.entries.os1-bridge.config = {bounded_auto: true, local_model: <the
// machine's one local model>} (LocalRouterBridge.rccRuntimeConfiguration); a
// manifest configSchema without `local_model` made OpenClaw 2026.9.9 reject the
// whole config, so os1-bridge never loaded and every Auto request ended at
// rcc_transport_preserved. This runs OpenClaw's own `config validate` on that
// exact plugin config for every candidate model, in a throwaway HOME and state
// directory. No gateway, model, provider or network call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bridge = join(root, 'Resources', 'openclaw-os1-bridge');
const selection = readFileSync(join(root, 'Sources', 'OS1Context', 'LocalModelSelection.swift'), 'utf8');
const host = readFileSync(join(root, 'Sources', 'OS1', 'LocalRouterBridge.swift'), 'utf8');
const candidates = [...selection.matchAll(/\.init\(name: "([^"]+)", digest: "[a-f0-9]{64}"/g)].map(match => match[1]);
const sdk = join(homedir(), 'Library', 'Application Support', 'OS-1', 'tools', 'openclaw-2026.9.9', 'node_modules', 'openclaw');

test('the host writes exactly bounded_auto and the one local model name', () => {
  assert.deepEqual(candidates, ['qwen3.5:9b', 'qwen3.5:4b']);
  assert.match(selection, /public static let pluginConfigKey = "local_model"/);
  assert.match(host, /bridgeEntry\["config"\] = \["bounded_auto": true, LocalModelSelection\.pluginConfigKey: OpenClawAgentController\.model\]/);
  const schema = JSON.parse(readFileSync(join(bridge, 'openclaw.plugin.json'), 'utf8')).configSchema;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.bounded_auto.type, 'boolean');
  const pattern = new RegExp(schema.properties.local_model.pattern, 'u');
  for (const name of candidates) assert.ok(pattern.test(name), name);
  for (const bad of ['', 'Qwen3.5:9b', 'ollama/qwen3.5:9b', 'qwen3.5', 'qwen3.5:9b; rm -rf']) assert.ok(!pattern.test(bad), bad);
});

test('the pinned OpenClaw validates the RCC gateway config for every candidate model', t => {
  if (!existsSync(join(sdk, 'package.json'))) {
    t.skip('Pinned OpenClaw 2026.9.9 is absent; the gateway config is NOT validated on this machine.');
    return;
  }
  const canonical = realpathSync(sdk);
  assert.equal(JSON.parse(readFileSync(join(canonical, 'package.json'), 'utf8')).version, '2026.9.9');
  const work = mkdtempSync(join(tmpdir(), 'os1-plugin-config-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const plugin = join(work, 'plugin');
  for (const directory of ['home', 'state', 'workspace']) mkdirSync(join(work, directory));
  cpSync(bridge, plugin, {recursive: true, filter: source => !source.endsWith('.test.mjs')});
  const validate = (name, pluginConfig) => {
    const config = {
      agents: {defaults: {workspace: join(work, 'workspace'), model: {primary: 'ollama/' + name, fallbacks: []}}},
      models: {mode: 'replace', providers: {ollama: {api: 'ollama', apiKey: 'ollama-local', baseUrl: 'http://127.0.0.1:11434',
        models: [{id: name, name: 'OS-1 Local Controller', input: ['text'], contextWindow: 32768, maxTokens: 4096}]}}},
      plugins: {enabled: true, allow: ['os1-bridge'], deny: [], load: {paths: [plugin]},
        entries: {'os1-bridge': {enabled: true, config: pluginConfig}}},
      tools: {deny: ['*']}, browser: {enabled: false}};
    const path = join(work, 'config.json');
    writeFileSync(path, JSON.stringify(config));
    const run = spawnSync(process.execPath, [join(canonical, 'openclaw.mjs'), 'config', 'validate', '--json'], {
      encoding: 'utf8', timeout: 120_000,
      env: {PATH: '/usr/bin:/bin', HOME: join(work, 'home'), OPENCLAW_CONFIG_PATH: path, OPENCLAW_STATE_DIR: join(work, 'state')}});
    const text = run.stdout.slice(run.stdout.indexOf('{'));
    return JSON.parse(text);
  };
  for (const name of candidates) {
    const result = validate(name, {bounded_auto: true, local_model: name});
    assert.equal(result.valid, true, `${name}: ${JSON.stringify(result.issues ?? result.error)}`);
  }
  // The validator is the strict one the gateway applies: an unknown key fails.
  const strict = validate(candidates[0], {bounded_auto: true, local_model: candidates[0], unknown_key: true});
  assert.equal(strict.valid, false);
  assert.ok(JSON.stringify(strict.issues).includes('plugins.entries.os1-bridge.config'));
});
