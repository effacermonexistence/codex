#!/usr/bin/env node
// Resolve the owner-approved Gold, not an edited checkout's current runtime.
// Downloads only to a fresh private directory; NEVER deploys or resets live data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POINT, ROOTS, check, digest, reference, safeRelative, recover } from './recover-v151.mjs';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../recovery');
export function validateGold(pointer, gold) {
  check(pointer?.schema === 'scv-latest-approved-recovery-gold-pointer-v1', 'invalid_gold_pointer');
  check(gold?.schema === 'scv-approved-recovery-gold-v1' && gold.approved_by_owner === true, 'unapproved_gold');
  check(pointer.gold_id === gold.gold_id && /^scv-instagram-recovery-gold-\d{8}T\d{6}Z-v\d+$/.test(gold.gold_id), 'gold_id_mismatch');
  check(gold.recovery_point_id === POINT, 'unsupported_exact_gold_point');
  check(JSON.stringify(gold.manifests.map(reference)) === JSON.stringify(ROOTS), 'gold_manifest_pin_mismatch');
  check(gold.manychat_configuration_in_scope === false && gold.ordinary_edit_or_deploy_promotes_gold === false &&
    gold.timestamped_customer_state_restore_requires_explicit_request === true && gold.production_cutover_automatic === false,
    'gold_restore_scope_mismatch');
  check(gold.default_restore_mode === 'code-prompt-settings; preserve current customer state', 'gold_state_policy_mismatch');
  return gold;
}
export function loadGold(root = directory) {
  const pointerFile = path.join(root, 'LATEST_GOLD.json'); digest(pointerFile);
  const pointer = JSON.parse(fs.readFileSync(pointerFile));
  const relative = safeRelative(pointer.record?.path);
  check(/^gold\/\d{8}T\d{6}Z-v\d+\.json$/.test(relative), 'invalid_gold_record_path');
  const file = path.join(root, relative);
  check(Number.isSafeInteger(pointer.record.bytes) && pointer.record.bytes > 0 &&
    fs.lstatSync(file).size === pointer.record.bytes && digest(file) === pointer.record.sha256, 'gold_record_pin_mismatch');
  const gold = validateGold(pointer, JSON.parse(fs.readFileSync(file)));
  check(pointer.record.key === gold.r2_record_key && gold.bucket === 'omar-private-archive', 'gold_custody_mismatch');
  return { pointer, gold };
}
export async function recoverGold({ target, offlineRoot, progress }) {
  const { gold, pointer } = loadGold();
  const result = await recover({ point: gold.recovery_point_id, target, offlineRoot, progress });
  const receipt = { schema: 'scv-gold-acquisition-receipt-v1', at_utc: new Date().toISOString(),
    gold_id: gold.gold_id, snapshot_at_utc: gold.snapshot_at_utc,
    gold_record_sha256: pointer.record.sha256, recovery_point_id: result.recovery_point_id,
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
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--resolve') console.log(JSON.stringify(loadGold().gold, null, 2));
    else {
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        check(['--target', '--offline-root'].includes(args[i]) && args[i + 1] && !Object.hasOwn(options, args[i]), 'usage: --resolve OR --target NEW_PRIVATE_DIRECTORY [--offline-root MIRROR]');
        options[args[i]] = args[i + 1];
      }
      check(options['--target'], 'new_private_target_required');
      console.log(JSON.stringify(await recoverGold({ target: options['--target'], offlineRoot: options['--offline-root'], progress: p => process.stderr.write(JSON.stringify(p) + '\n') }), null, 2));
    }
  } catch (e) { console.error(JSON.stringify({ ok: false, reason: e.message, runtime_activated: false })); process.exitCode = 1; }
}
