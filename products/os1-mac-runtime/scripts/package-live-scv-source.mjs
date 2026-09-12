#!/usr/bin/env node
// Source acquisition only. No deployment, customer state, reset or Gold change.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const [sourceArg, outputArg] = process.argv.slice(2);
assert(sourceArg && outputArg, 'source-directory new-private-output-directory');
const source = fs.realpathSync(sourceArg), output = path.resolve(outputArg);
assert(!fs.existsSync(output), 'use a new acquisition directory');
const readyURL = 'https://scv-dm-cloud-survival-production.up.railway.app/readyz';
const response = await fetch(readyURL, { signal: AbortSignal.timeout(15000) });
assert(response.ok);
const ready = await response.json(), release = ready.release;
assert(ready.ok && release?.ok && release.mode === 'production' && release.release_phase === 'active');
const hash = data => createHash('sha256').update(data).digest('hex');
const manifestBytes = fs.readFileSync(path.join(source, 'SCV_SINGLE_RELEASE.json'));
assert.equal(hash(manifestBytes), release.release_manifest_sha256, 'source manifest differs from live');
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.release_id, release.release_id);
assert.equal(manifest.content_fingerprint_sha256, release.content_fingerprint_sha256);
const members = ['SCV_SINGLE_RELEASE.json'];
for (const file of manifest.files) {
  assert(/^[A-Za-z0-9._/-]+$/.test(file.path) && !file.path.startsWith('/') && !file.path.startsWith('-'));
  assert(!file.path.split('/').some(s => !s || s === '.' || s === '..'));
  assert(!/(^|\/)(\.env(?:\.|$)|credentials?|tokens?|production_state|\.git|node_modules)(\/|$)/i.test(file.path));
  const full = path.join(source, file.path), stat = fs.lstatSync(full);
  assert(stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync(full) === full);
  const bytes = fs.readFileSync(full);
  assert.equal(bytes.length, file.bytes, file.path + ' size');
  assert.equal(hash(bytes), file.sha256, file.path + ' digest');
  members.push(file.path);
}
assert.equal(new Set(members).size, members.length);
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const inventory = path.join(output, 'source-members.txt');
fs.writeFileSync(inventory, members.join('\n') + '\n', { mode: 0o600 });
const archive = path.join(output, release.release_id + '-source.tar.gz');
execFileSync('/usr/bin/tar', ['--no-mac-metadata', '--no-xattrs', '-czf', archive, '-C', source, '-T', inventory],
  { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'pipe', timeout: 60000 });
fs.chmodSync(archive, 0o600);
const packed = fs.readFileSync(archive);
const result = { capturedAt: new Date().toISOString(), releaseID: release.release_id,
  manifestSHA256: hash(manifestBytes), fingerprint: release.content_fingerprint_sha256,
  fileCount: manifest.files.length, archive, archiveBytes: packed.length, archiveSHA256: hash(packed),
  liveReadiness: { ok: ready.ok, critical: ready.drift?.critical_alert_count, operational: ready.drift?.operational_alert_count },
  scope: 'manifest-listed runtime source only; no deployment, reset, state archive or credential transfer' };
fs.writeFileSync(path.join(output, 'source-acquisition.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(JSON.stringify(result));
