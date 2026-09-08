#!/usr/bin/env node
// Resolve an owner-approved dated Gold, not an edited checkout's current runtime.
// Downloads only to a fresh private directory; NEVER deploys or resets live data.
//
// Several dated Golds coexist, each with its own record under recovery/gold/ and its own
// timestamped R2 keys. `LATEST_GOLD.json` names the latest owner-approved one; an earlier Gold
// stays restorable by its exact gold_id (`--gold`). Records are never overwritten or repurposed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POINT, ROOTS, check, digest, reference, safeRelative, recover } from './recover-v151.mjs';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../recovery');
const GOLD_ID = /^scv-instagram-recovery-gold-(\d{8}T\d{6}Z)-v(\d+)$/;
const POINT_ID = /^scv-instagram-(\d{8}T\d{6}Z)-v(\d+)-[a-z0-9-]+$/;
const RECORD_PATH = /^gold\/(\d{8}T\d{6}Z)-v(\d+)\.json$/;
const POINT_MANIFEST_KEY = /^scv-instagram-automation\/recovery-points\/(\d{8}T\d{6}Z)\/SCV_RECOVERY_POINT\.json$/;

export function validateGold(pointer, gold) {
  if (pointer) check(pointer?.schema === 'scv-latest-approved-recovery-gold-pointer-v1', 'invalid_gold_pointer');
  check(gold?.schema === 'scv-approved-recovery-gold-v1' && gold.approved_by_owner === true, 'unapproved_gold');
  const goldId = GOLD_ID.exec(String(gold.gold_id || ''));
  check(goldId, 'gold_id_mismatch');
  if (pointer) check(pointer.gold_id === gold.gold_id, 'gold_id_mismatch');
  const pointId = POINT_ID.exec(String(gold.recovery_point_id || ''));
  check(pointId && pointId[2] === goldId[2], 'unsupported_exact_gold_point');
  check(Array.isArray(gold.manifests) && gold.manifests.length >= 1, 'gold_manifests_missing');
  const manifests = gold.manifests.map(reference);
  const pointKey = POINT_MANIFEST_KEY.exec(manifests[0].key);
  // The point manifest lives under the point's own timestamp: dates are never mixed across Golds.
  check(pointKey && pointKey[1] === pointId[1], 'gold_point_date_mismatch');
  check(typeof gold.snapshot_at_utc === 'string' && typeof gold.promoted_at_utc === 'string' &&
    !Number.isNaN(Date.parse(gold.snapshot_at_utc)) && !Number.isNaN(Date.parse(gold.promoted_at_utc)) &&
    Date.parse(gold.promoted_at_utc) >= Date.parse(gold.snapshot_at_utc), 'gold_dates_invalid');
  // The first Gold keeps its original hard pin: exactly the v151 point and its three manifests.
  if (gold.recovery_point_id === POINT) check(JSON.stringify(manifests) === JSON.stringify(ROOTS), 'gold_manifest_pin_mismatch');
  check(gold.manychat_configuration_in_scope === false && gold.ordinary_edit_or_deploy_promotes_gold === false &&
    gold.timestamped_customer_state_restore_requires_explicit_request === true && gold.production_cutover_automatic === false,
    'gold_restore_scope_mismatch');
  check(gold.default_restore_mode === 'code-prompt-settings; preserve current customer state', 'gold_state_policy_mismatch');
  check(gold.bucket === 'omar-private-archive', 'gold_custody_mismatch');
  return gold;
}
export function listGolds(root = directory) {
  const dir = path.join(root, 'gold');
  return fs.readdirSync(dir).filter(name => RECORD_PATH.test('gold/' + name)).sort().map(name => {
    const relative = 'gold/' + name, file = path.join(dir, name);
    const gold = JSON.parse(fs.readFileSync(file));
    return { record_path: relative, gold_id: String(gold.gold_id || ''), recovery_point_id: String(gold.recovery_point_id || ''),
      release_id: String(gold.release_id || ''), snapshot_at_utc: String(gold.snapshot_at_utc || ''), promoted_at_utc: String(gold.promoted_at_utc || ''),
      bytes: fs.lstatSync(file).size, sha256: digest(file) };
  });
}
export function loadGold(root = directory, goldId = '') {
  const pointerFile = path.join(root, 'LATEST_GOLD.json'); digest(pointerFile);
  const pointer = JSON.parse(fs.readFileSync(pointerFile));
  check(pointer?.schema === 'scv-latest-approved-recovery-gold-pointer-v1', 'invalid_gold_pointer');
  let relative;
  if (goldId) {
    check(GOLD_ID.test(goldId), 'gold_id_mismatch');
    const matches = listGolds(root).filter(entry => entry.gold_id === goldId);
    check(matches.length === 1, 'gold_id_not_found');
    relative = matches[0].record_path;
  } else relative = safeRelative(pointer.record?.path);
  check(RECORD_PATH.test(relative), 'invalid_gold_record_path');
  const file = path.join(root, relative);
  const selectedByPointer = !goldId || relative === pointer.record?.path;
  if (selectedByPointer) {
    check(Number.isSafeInteger(pointer.record.bytes) && pointer.record.bytes > 0 &&
      fs.lstatSync(file).size === pointer.record.bytes && digest(file) === pointer.record.sha256, 'gold_record_pin_mismatch');
  } else digest(file);
  const gold = validateGold(selectedByPointer ? pointer : null, JSON.parse(fs.readFileSync(file)));
  if (selectedByPointer) check(pointer.record.key === gold.r2_record_key, 'gold_custody_mismatch');
  check(RECORD_PATH.exec(relative)[1] === GOLD_ID.exec(gold.gold_id)[1] && RECORD_PATH.exec(relative)[2] === GOLD_ID.exec(gold.gold_id)[2], 'gold_record_name_mismatch');
  return { pointer, gold, record_path: relative, record_sha256: digest(file), selected_by: goldId ? 'gold_id' : 'latest_pointer', is_latest: selectedByPointer };
}
export async function recoverGold({ target, offlineRoot, progress, goldId }) {
  const { gold, pointer, selected_by, is_latest, record_path } = loadGold(directory, goldId);
  const recordSha = digest(path.join(directory, record_path));
  const result = await recover({ point: gold.recovery_point_id, roots: gold.manifests, target, offlineRoot, progress });
  const receipt = { schema: 'scv-gold-acquisition-receipt-v2', at_utc: new Date().toISOString(),
    gold_id: gold.gold_id, selected_by, is_latest_approved_gold: is_latest, latest_gold_id: pointer.gold_id,
    snapshot_at_utc: gold.snapshot_at_utc, promoted_at_utc: gold.promoted_at_utc,
    gold_record_sha256: recordSha, recovery_point_id: result.recovery_point_id, manifest_chain: result.manifest_chain,
    artifacts_verified: result.artifacts, canonical_files: result.canonical_files, state: result.state,
    final_artifacts_reverified: result.final_artifacts_reverified_before_receipt,
    manychat_configuration_in_scope: false, production_mutated: false,
    runtime_activated: false, customer_state_applied: false,
    next: 'Follow GOLD-RESTORE.md. Do not report an active-system rollback from this acquisition receipt.' };
  fs.writeFileSync(path.join(result.target, 'GOLD-ACQUISITION-RECEIPT.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { ...receipt, target: result.target };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  try {
    const args = process.argv.slice(2), options = {};
    const flags = new Set(['--resolve', '--list']);
    for (let i = 0; i < args.length; i += 1) {
      if (flags.has(args[i])) { check(!Object.hasOwn(options, args[i]), 'duplicate_flag'); options[args[i]] = true; continue; }
      check(['--target', '--offline-root', '--gold'].includes(args[i]) && args[i + 1] && !Object.hasOwn(options, args[i]),
        'usage: --list | --resolve [--gold GOLD_ID] | --target NEW_PRIVATE_DIRECTORY [--gold GOLD_ID] [--offline-root MIRROR]');
      options[args[i]] = args[i + 1]; i += 1;
    }
    if (options['--list']) console.log(JSON.stringify({ latest_gold_id: loadGold().gold.gold_id, golds: listGolds() }, null, 2));
    else if (options['--resolve']) console.log(JSON.stringify(loadGold(directory, options['--gold'] || '').gold, null, 2));
    else {
      check(options['--target'], 'new_private_target_required');
      console.log(JSON.stringify(await recoverGold({ target: options['--target'], offlineRoot: options['--offline-root'], goldId: options['--gold'] || '',
        progress: p => process.stderr.write(JSON.stringify(p) + '\n') }), null, 2));
    }
  } catch (e) { console.error(JSON.stringify({ ok: false, reason: e.message, runtime_activated: false })); process.exitCode = 1; }
}
