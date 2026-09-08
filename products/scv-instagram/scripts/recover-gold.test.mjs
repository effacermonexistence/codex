import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGold, validateGold, recoverGold } from './recover-gold.mjs';

const V151_ID = 'scv-instagram-recovery-gold-20260905T054647Z-v151';
const latest = loadGold();
// The first Gold is the fixed reference for these tests whether or not it is still the pointer target.
const first = loadGold(undefined, V151_ID);
const v151RecordFile = new URL('../recovery/' + first.record_path, import.meta.url);
const v151Pointer = { ...latest.pointer, gold_id: V151_ID, record: { path: first.record_path, key: first.gold.r2_record_key,
  bytes: fs.statSync(v151RecordFile).size, sha256: first.record_sha256 } };
const baseline = { gold: first.gold, pointer: v151Pointer };
test('the first Gold resolves to the exact saved v151 point, not the current checkout', () => {
  assert.equal(first.gold.recovery_point_id, 'scv-instagram-20260904T222549Z-v151-clean-current');
  assert.equal(first.gold.snapshot_at_utc, '2026-09-04T22:25:49Z');
  assert.notEqual(first.gold.snapshot_at_utc, first.gold.promoted_at_utc);
  assert.equal(first.gold.manychat_configuration_in_scope, false);
  assert.equal(first.record_path, 'gold/20260905T054647Z-v151.json');
});
test('the latest approved Gold is a valid dated record with separate snapshot and promotion times', () => {
  assert.match(latest.gold.gold_id, /^scv-instagram-recovery-gold-\d{8}T\d{6}Z-v\d+$/);
  assert.equal(latest.selected_by, 'latest_pointer');
  assert.ok(Date.parse(latest.gold.promoted_at_utc) >= Date.parse(latest.gold.snapshot_at_utc));
  assert.equal(latest.gold.manychat_configuration_in_scope, false);
});
for (const [name, mutate] of [
  ['unapproved point', g => { g.approved_by_owner = false; }],
  ['different recovery point', g => { g.recovery_point_id = 'latest'; }],
  ['changed manifest pin', g => { g.manifests[0].bytes++; }],
  ['ManyChat scope expansion', g => { g.manychat_configuration_in_scope = true; }],
  ['automatic promotion after edits', g => { g.ordinary_edit_or_deploy_promotes_gold = true; }],
  ['destructive default data rollback', g => { g.default_restore_mode = 'overwrite all customer data'; }],
  ['automatic production cutover', g => { g.production_cutover_automatic = true; }]
]) test('reject ' + name, () => {
  const gold = structuredClone(baseline.gold); mutate(gold);
  assert.throws(() => validateGold(baseline.pointer, gold));
});
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scv-gold-test-')));
  t.after(() => fs.rmSync(root, { recursive: true }));
  fs.mkdirSync(path.join(root, 'gold'));
  fs.writeFileSync(path.join(root, 'LATEST_GOLD.json'), JSON.stringify(baseline.pointer));
  fs.copyFileSync(v151RecordFile, path.join(root, baseline.pointer.record.path));
  return root;
}
test('tampered dated record fails before acquisition', t => {
  const root = fixture(t), file = path.join(root, baseline.pointer.record.path);
  loadGold(root); fs.appendFileSync(file, ' ');
  assert.throws(() => loadGold(root), /gold_record_pin_mismatch/);
});
test('path traversal in a pointer is rejected', t => {
  const root = fixture(t), pointer = structuredClone(baseline.pointer);
  pointer.record.path = '../outside.json';
  fs.writeFileSync(path.join(root, 'LATEST_GOLD.json'), JSON.stringify(pointer));
  assert.throws(() => loadGold(root), /unsafe/);
});
test('linked Gold records cannot substitute for pinned files', t => {
  const root = fixture(t), file = path.join(root, baseline.pointer.record.path);
  const saved = file + '.preserved'; fs.renameSync(file, saved); fs.symlinkSync(saved, file);
  assert.throws(() => loadGold(root), /gold_record_pin_mismatch|linked/);
});
test('existing target is preserved, never treated as the operating server to replace', async t => {
  const root = fixture(t), file = path.join(root, 'preserved.txt'); fs.writeFileSync(file, 'preserve');
  await assert.rejects(recoverGold({ target: root }), /target_already_exists/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'preserve');
});

// Several dated Golds coexist. The pointer names the latest owner-approved one; an earlier Gold
// stays restorable by its exact id and is never overwritten. Dates are never mixed across Golds.
import { listGolds } from './recover-gold.mjs';
function secondGold(t) {
  const root = fixture(t);
  const v167 = {
    ...structuredClone(baseline.gold),
    gold_id: 'scv-instagram-recovery-gold-20260908T220000Z-v167',
    promoted_at_utc: '2026-09-08T22:00:00Z',
    snapshot_at_utc: '2026-09-08T21:30:00Z',
    snapshot_at_america_los_angeles: '2026-09-08T14:30:00-07:00',
    r2_record_key: 'scv-instagram-automation/recovery-gold/20260908T220000Z/GOLD.json',
    recovery_point_id: 'scv-instagram-20260908T213000Z-v167-clean-current',
    release_id: 'scv-instagram-single-20260908-v167',
    manifests: [{ key: 'scv-instagram-automation/recovery-points/20260908T213000Z/SCV_RECOVERY_POINT.json', bytes: 6000, sha256: 'a'.repeat(64) }]
  };
  const file = path.join(root, 'gold/20260908T220000Z-v167.json');
  fs.writeFileSync(file, JSON.stringify(v167, null, 2) + '\n');
  const bytes = fs.statSync(file).size, sha256 = digestOf(file);
  fs.writeFileSync(path.join(root, 'LATEST_GOLD.json'), JSON.stringify({
    ...baseline.pointer, gold_id: v167.gold_id,
    record: { path: 'gold/20260908T220000Z-v167.json', key: v167.r2_record_key, bytes, sha256 }
  }));
  return { root, v167 };
}
import crypto from 'node:crypto';
function digestOf(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
test('a newer dated Gold becomes the pointer target while the first Gold stays resolvable by id', t => {
  const { root, v167 } = secondGold(t);
  const latest = loadGold(root);
  assert.equal(latest.gold.gold_id, v167.gold_id);
  assert.equal(latest.gold.recovery_point_id, 'scv-instagram-20260908T213000Z-v167-clean-current');
  assert.equal(latest.selected_by, 'latest_pointer');
  const first = loadGold(root, baseline.gold.gold_id);
  assert.equal(first.gold.recovery_point_id, 'scv-instagram-20260904T222549Z-v151-clean-current');
  assert.equal(first.selected_by, 'gold_id');
  assert.equal(first.is_latest, false);
  assert.deepEqual(listGolds(root).map(g => g.gold_id), [baseline.gold.gold_id, v167.gold_id]);
  assert.throws(() => loadGold(root, 'scv-instagram-recovery-gold-20260101T000000Z-v999'), /gold_id_not_found/);
  assert.throws(() => loadGold(root, 'latest'), /gold_id_mismatch/);
});
test('the first Gold keeps its exact v151 manifest pin even when it is no longer the pointer target', t => {
  const { root } = secondGold(t);
  const file = path.join(root, baseline.pointer.record.path), gold = JSON.parse(fs.readFileSync(file));
  gold.manifests[0].bytes += 1; fs.writeFileSync(file, JSON.stringify(gold));
  assert.throws(() => loadGold(root, baseline.gold.gold_id), /gold_manifest_pin_mismatch/);
});
test('a Gold whose point timestamp does not match its manifest timestamp is rejected', t => {
  const { v167 } = secondGold(t);
  const mixed = structuredClone(v167); mixed.recovery_point_id = 'scv-instagram-20260905T054647Z-v167-clean-current';
  assert.throws(() => validateGold(null, mixed), /gold_point_date_mismatch/);
  const wrongVersion = structuredClone(v167); wrongVersion.recovery_point_id = 'scv-instagram-20260908T213000Z-v151-clean-current';
  assert.throws(() => validateGold(null, wrongVersion), /unsupported_exact_gold_point/);
  const promotedBeforeSnapshot = structuredClone(v167); promotedBeforeSnapshot.promoted_at_utc = '2026-09-08T00:00:00Z';
  assert.throws(() => validateGold(null, promotedBeforeSnapshot), /gold_dates_invalid/);
  const foreignBucket = structuredClone(v167); foreignBucket.bucket = 'other-bucket';
  assert.throws(() => validateGold(null, foreignBucket), /gold_custody_mismatch/);
});
test('a dated record file must carry the gold id it names', t => {
  const { root, v167 } = secondGold(t);
  const wrong = path.join(root, 'gold/20260908T220000Z-v168.json');
  fs.writeFileSync(wrong, JSON.stringify(v167));
  assert.throws(() => loadGold(root, v167.gold_id), /gold_id_not_found|gold_record_name_mismatch/);
});
