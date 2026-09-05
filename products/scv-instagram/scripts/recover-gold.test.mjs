import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGold, validateGold, recoverGold } from './recover-gold.mjs';

const baseline = loadGold();
test('Gold resolves to the exact saved v151 point, not the current checkout', () => {
  assert.equal(baseline.gold.recovery_point_id, 'scv-instagram-20260904T222549Z-v151-clean-current');
  assert.equal(baseline.gold.snapshot_at_utc, '2026-09-04T22:25:49Z');
  assert.notEqual(baseline.gold.snapshot_at_utc, baseline.gold.promoted_at_utc);
  assert.equal(baseline.gold.manychat_configuration_in_scope, false);
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
  const source = new URL('../recovery/' + baseline.pointer.record.path, import.meta.url);
  fs.copyFileSync(source, path.join(root, baseline.pointer.record.path));
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
