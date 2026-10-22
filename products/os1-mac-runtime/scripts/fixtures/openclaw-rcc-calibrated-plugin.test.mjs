import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, chmodSync, readdirSync, rmSync, realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {calibratedRuntimeOptions, adaptiveRuntimeOptions} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
import {writeCalibratedRouteFixture} from './calibrated-route-evidence.synthetic.mjs';

const fixture = action => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'os1-qualified-plugin-')));
  chmodSync(root, 0o700);
  try { action(root); } finally { rmSync(root, {recursive: true, force: true}); }
};

test('no host registration keeps current OFF/R0 options and makes no completion calls', () => {
  let calls = 0;
  assert.deepEqual(calibratedRuntimeOptions(), {});
  assert.deepEqual(adaptiveRuntimeOptions({pluginConfig: {}, complete: () => { calls++; }}),
    {adaptiveRoutingPolicy: {schema: 1, mode: 'off'}});
  assert.equal(calls, 0);
  fixture(stateDir => {
    const before = readdirSync(stateDir);
    assert.deepEqual(calibratedRuntimeOptions({stateDir}), {});
    assert.deepEqual(adaptiveRuntimeOptions({pluginConfig: {}, stateDir, complete: () => { calls++; }}),
      {adaptiveRoutingPolicy: {schema: 1, mode: 'off'}});
    assert.deepEqual(readdirSync(stateDir), before);
    assert.equal(calls, 0);
  });
});

test('caller/plugin JSON cannot register a calibrated predictor or choose an arbitrary registry', () => {
  for (const config of [{calibrated_route_evidence: {validated: true}},
    {calibrated_route_registration: '/tmp/untrusted.json'}, {calibratedRoutePredictor: () => {}}]) {
    assert.throws(() => adaptiveRuntimeOptions({pluginConfig: config}), {code: 'adaptive_plugin_config_invalid'});
  }
});

test('malformed, public, linked or nonregular fixed registration never grants an optional route', () => {
  for (const mode of ['malformed', 'public', 'symlink', 'hardlink', 'directory']) fixture(stateDir => {
    const path = join(stateDir, 'calibrated-route-registration.json');
    if (mode === 'directory') mkdirSync(path, {mode: 0o700});
    else if (mode === 'symlink') {
      const target = join(stateDir, 'other.json');
      writeFileSync(target, '{}', {mode: 0o600}); symlinkSync(target, path);
    } else {
      writeFileSync(path, mode === 'malformed' ? '{bad json' : '{}', {mode: 0o600});
      if (mode === 'public') chmodSync(path, 0o644);
      if (mode === 'hardlink') linkSync(path, join(stateDir, 'alias.json'));
    }
    const before = readdirSync(stateDir).sort();
    assert.deepEqual(calibratedRuntimeOptions({stateDir}), {}, mode);
    assert.deepEqual(readdirSync(stateDir).sort(), before, 'optional loading must not repair or overwrite evidence');
  });
});

test('untrusted accessor config is rejected before any getter or evidence read', () => {
  let reads = 0;
  const config = Object.defineProperty({}, 'adaptive_routing', {enumerable: true, get() { reads++; return {mode: 'off'}; }});
  assert.throws(() => adaptiveRuntimeOptions({pluginConfig: config}), {code: 'adaptive_plugin_config_invalid'});
  assert.equal(reads, 0);
});

// Complete protected evidence and all source/fit/P8/cost gates are genuinely
// valid for this synthetic origin; production still must not receive it.
test('fully verified protected synthetic evidence never wires production execution authority', () => {
  fixture(stateDir => {
    const f = writeCalibratedRouteFixture({stateDir});
    assert.equal(f.bundle.data_mode, 'synthetic_fixture');
    assert.deepEqual(calibratedRuntimeOptions({stateDir, now_ms: f.now_ms}), {});
    let calls = 0;
    assert.deepEqual(adaptiveRuntimeOptions({pluginConfig: {}, stateDir, complete: () => { calls++; }}),
      {adaptiveRoutingPolicy: {schema: 1, mode: 'off'}});
    assert.equal(calls, 0);
  });
});
