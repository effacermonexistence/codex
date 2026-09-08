#!/usr/bin/env node
// ============================================================
// SCV PERSISTENT STATE HARNESS — queued replies must survive a deploy.
//
// Simulates the Railway lifecycle: /app is wiped on deploy, /data (volume)
// survives. Asserts that state written before the "deploy" is still readable
// through the /app paths after re-binding on the next boot — the exact property
// whose absence silently killed queued replies (christian.bolanos.35977).
// ============================================================
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  ensurePersistentStateDirs,
  bindStateDirToPersistentRoot,
  hardenPrivateTreePermissions,
  persistentRootAvailable
} = require(path.join(__dirname, 'scv-persistent-state.js'))
const { namespacedPersistRoot, runScvRuntimeNamespaceGuard } = require(path.join(__dirname, 'scv-runtime-namespace.js'))

function assert(cond, label, detail = '') {
  if (!cond) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

function runScvPersistentStateHarness() {
  let checked = 0
  const ok = (cond, label, detail = '') => { assert(cond, label, detail); checked++ }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-persist-'))
  const appRoot = path.join(tmp, 'app')
  const dataRoot = path.join(tmp, 'data')
  fs.mkdirSync(appRoot, { recursive: true })
  const DIRS = ['outbox', 'thread-state', 'thread-history']
  // The harness owns its test namespace. Never inherit a Railway staging or
  // production namespace from the process running the regression.
  const harnessNamespace = 'harness-persistent-state'
  const nsRoot = namespacedPersistRoot(dataRoot, harnessNamespace)

  try {
    // 1. No volume -> plain mkdir (local dev / tests unchanged).
    const noVol = ensurePersistentStateDirs(
      appRoot,
      DIRS,
      path.join(tmp, 'missing'),
      harnessNamespace,
      { required: false }
    )
    ok(noVol.persistent === false, 'no_volume_plain_mkdir')
    ok(fs.statSync(path.join(appRoot, 'outbox')).isDirectory() && !fs.lstatSync(path.join(appRoot, 'outbox')).isSymbolicLink(), 'no_volume_real_dir')

    // Railway staging/production may never silently fall back to /app.
    let missingRequiredThrew = false
    try {
      ensurePersistentStateDirs(
        path.join(tmp, 'required-app'),
        DIRS,
        path.join(tmp, 'required-missing'),
        harnessNamespace,
        { required: true }
      )
    } catch (error) {
      missingRequiredThrew = /persistent_root_required_unavailable/.test(String(error?.message || error))
    }
    ok(missingRequiredThrew, 'required_volume_missing_fails_closed')
    const missingNamespaceGuard = runScvRuntimeNamespaceGuard({
      appRoot: path.join(tmp, 'required-app'),
      dirs: DIRS,
      persistRoot: path.join(tmp, 'required-missing'),
      namespace: harnessNamespace,
      required: true
    })
    ok(missingNamespaceGuard.ok === false && missingNamespaceGuard.persistent === false, 'required_namespace_guard_fails_closed')

    // 2. Volume appears; existing pre-volume files are migrated into it.
    fs.writeFileSync(path.join(appRoot, 'outbox', 'pending-reply.json'), '{"bubble":"hey"}')
    fs.mkdirSync(dataRoot, { recursive: true })
    ok(persistentRootAvailable(dataRoot) === true, 'volume_detected')
    const bound = ensurePersistentStateDirs(appRoot, DIRS, dataRoot, harnessNamespace)
    ok(bound.persistent === true && bound.bound.every((b) => b.mode === 'linked'), 'all_dirs_linked', JSON.stringify(bound.bound))
    ok(bound.write_probe === true, 'persistent_write_probe_passed')
    ok(fs.lstatSync(path.join(appRoot, 'outbox')).isSymbolicLink(), 'app_path_is_symlink')
    ok(fs.readFileSync(path.join(appRoot, 'outbox', 'pending-reply.json'), 'utf8').includes('hey'), 'existing_file_migrated_and_readable')
    ok(fs.existsSync(path.join(nsRoot, 'outbox', 'pending-reply.json')), 'migrated_file_lives_on_namespaced_volume')
    ok((fs.statSync(nsRoot).mode & 0o077) === 0, 'namespaced_root_hardened_private')
    ok(DIRS.every((dir) => (fs.statSync(path.join(nsRoot, dir)).mode & 0o077) === 0), 'state_directories_hardened_private')
    ok((fs.statSync(path.join(nsRoot, 'outbox', 'pending-reply.json')).mode & 0o077) === 0, 'migrated_state_file_hardened_private')

    // 3. Writes through the /app path land on the volume (modules unchanged).
    fs.writeFileSync(path.join(appRoot, 'thread-history', '1190493356.json'), '{"events":[]}')
    ok(fs.existsSync(path.join(nsRoot, 'thread-history', '1190493356.json')), 'app_write_lands_on_namespaced_volume')

    // 4. THE DEPLOY: /app is wiped entirely, volume survives. Next boot re-binds.
    fs.rmSync(appRoot, { recursive: true, force: true })
    fs.mkdirSync(appRoot, { recursive: true })
    const rebound = ensurePersistentStateDirs(appRoot, DIRS, dataRoot, harnessNamespace)
    ok(rebound.persistent === true, 'reboot_rebinds')
    ok(fs.readFileSync(path.join(appRoot, 'outbox', 'pending-reply.json'), 'utf8').includes('hey'), 'queued_reply_survives_deploy')
    ok(fs.readFileSync(path.join(appRoot, 'thread-history', '1190493356.json'), 'utf8').includes('events'), 'thread_history_survives_deploy')

    // 5. Idempotent: binding again on a warm container leaves links intact.
    fs.chmodSync(nsRoot, 0o755)
    fs.chmodSync(path.join(nsRoot, 'thread-history'), 0o755)
    fs.chmodSync(path.join(nsRoot, 'thread-history', '1190493356.json'), 0o644)
    const again = ensurePersistentStateDirs(appRoot, DIRS, dataRoot, harnessNamespace)
    ok(again.bound.every((b) => b.mode === 'already_linked'), 'rebind_idempotent', JSON.stringify(again.bound))
    ok(
      (fs.statSync(nsRoot).mode & 0o077) === 0 &&
      (fs.statSync(path.join(nsRoot, 'thread-history')).mode & 0o077) === 0 &&
      (fs.statSync(path.join(nsRoot, 'thread-history', '1190493356.json')).mode & 0o077) === 0,
      'warm_rebind_repairs_public_modes'
    )

    const permissionRoot = path.join(tmp, 'permission-tree')
    const permissionSubdir = path.join(permissionRoot, 'state')
    const permissionFile = path.join(permissionSubdir, 'one.json')
    fs.mkdirSync(permissionSubdir, { recursive: true, mode: 0o755 })
    fs.writeFileSync(permissionFile, '{}', { mode: 0o644 })
    fs.chmodSync(permissionRoot, 0o755)
    fs.chmodSync(permissionSubdir, 0o755)
    fs.chmodSync(permissionFile, 0o644)
    const hardened = hardenPrivateTreePermissions(permissionRoot)
    ok(
      hardened.owner_only === true && hardened.directories_hardened === 2 &&
      hardened.files_hardened === 1,
      'private_tree_hardening_counts'
    )
    ok(
      (fs.statSync(permissionRoot).mode & 0o077) === 0 &&
      (fs.statSync(permissionSubdir).mode & 0o077) === 0 &&
      (fs.statSync(permissionFile).mode & 0o077) === 0,
      'private_tree_hardening_modes'
    )
    const permissionOutside = path.join(tmp, 'permission-outside.json')
    const permissionLink = path.join(permissionSubdir, 'linked.json')
    fs.writeFileSync(permissionOutside, 'outside')
    fs.symlinkSync(permissionOutside, permissionLink)
    fs.chmodSync(permissionRoot, 0o755)
    let permissionLinkThrew = false
    try {
      hardenPrivateTreePermissions(permissionRoot)
    } catch (error) {
      permissionLinkThrew = /persistent_private_tree_special_entry/.test(String(error?.message || error))
    }
    ok(permissionLinkThrew, 'private_tree_symlink_fails_closed')
    ok(
      (fs.statSync(permissionRoot).mode & 0o777) === 0o755 &&
      fs.readFileSync(permissionOutside, 'utf8') === 'outside',
      'private_tree_preflight_prevents_partial_mutation'
    )

    // A single unbindable state path aborts required-mode startup.
    const blockedApp = path.join(tmp, 'blocked-app')
    const blockedData = path.join(tmp, 'blocked-data')
    fs.mkdirSync(blockedApp, { recursive: true })
    fs.mkdirSync(blockedData, { recursive: true })
    fs.writeFileSync(path.join(blockedApp, 'outbox'), 'not-a-directory')
    let bindFailureThrew = false
    try {
      ensurePersistentStateDirs(blockedApp, ['outbox'], blockedData, 'blocked', { required: true })
    } catch (error) {
      bindFailureThrew = /persistent_state_bind_failed/.test(String(error?.message || error))
    }
    ok(bindFailureThrew, 'required_single_bind_failure_aborts_boot')

    // Binding may not recursively delete state it does not understand. Nested
    // data fails closed and remains byte-for-byte available for manual repair.
    const nestedApp = path.join(tmp, 'nested-app')
    const nestedData = path.join(tmp, 'nested-data')
    const nestedFile = path.join(nestedApp, 'outbox', 'nested', 'pending.json')
    fs.mkdirSync(path.dirname(nestedFile), { recursive: true })
    fs.mkdirSync(nestedData, { recursive: true })
    fs.writeFileSync(nestedFile, '{"pending":true}')
    let nestedMigrationThrew = false
    try {
      ensurePersistentStateDirs(nestedApp, ['outbox'], nestedData, 'nested', { required: true })
    } catch (error) {
      nestedMigrationThrew = /persistent_state_nested_or_special_entry/.test(String(error?.message || error))
    }
    ok(nestedMigrationThrew, 'nested_state_migration_fails_closed')
    ok(fs.readFileSync(nestedFile, 'utf8') === '{"pending":true}', 'nested_state_preserved_after_failed_bind')

    // A same-name persistent file with different content must stop the bind
    // before either copy is removed.
    const collisionApp = path.join(tmp, 'collision-app')
    const collisionData = path.join(tmp, 'collision-data')
    const collisionSource = path.join(collisionApp, 'outbox', 'same.json')
    const collisionTarget = path.join(
      namespacedPersistRoot(collisionData, 'collision'),
      'outbox',
      'same.json'
    )
    fs.mkdirSync(path.dirname(collisionSource), { recursive: true })
    fs.mkdirSync(path.dirname(collisionTarget), { recursive: true })
    fs.writeFileSync(collisionSource, 'source-copy')
    fs.writeFileSync(collisionTarget, 'persistent-copy')
    let collisionThrew = false
    try {
      ensurePersistentStateDirs(collisionApp, ['outbox'], collisionData, 'collision', { required: true })
    } catch (error) {
      collisionThrew = /persistent_state_migration_collision/.test(String(error?.message || error))
    }
    ok(collisionThrew, 'conflicting_state_migration_fails_closed')
    ok(
      fs.readFileSync(collisionSource, 'utf8') === 'source-copy' &&
      fs.readFileSync(collisionTarget, 'utf8') === 'persistent-copy',
      'conflicting_state_copies_both_preserved'
    )

    // A link left by another/older namespace may contain unique live state.
    // Required boot must refuse it without unlinking either side.
    const mismatchApp = path.join(tmp, 'mismatch-app')
    const mismatchData = path.join(tmp, 'mismatch-data')
    const priorTarget = path.join(tmp, 'prior-persistent-outbox')
    const expectedTarget = path.join(
      namespacedPersistRoot(mismatchData, 'mismatch'),
      'outbox'
    )
    fs.mkdirSync(mismatchApp, { recursive: true })
    fs.mkdirSync(priorTarget, { recursive: true })
    fs.mkdirSync(expectedTarget, { recursive: true })
    fs.writeFileSync(path.join(priorTarget, 'unique.json'), '{"unique":true}')
    fs.writeFileSync(path.join(expectedTarget, 'expected.json'), '{"expected":true}')
    fs.symlinkSync(priorTarget, path.join(mismatchApp, 'outbox'))
    let mismatchThrew = false
    try {
      ensurePersistentStateDirs(mismatchApp, ['outbox'], mismatchData, 'mismatch', { required: true })
    } catch (error) {
      mismatchThrew = /persistent_state_existing_symlink_target_mismatch/.test(String(error?.message || error))
    }
    ok(mismatchThrew, 'mismatched_persistent_symlink_fails_closed')
    ok(
      fs.lstatSync(path.join(mismatchApp, 'outbox')).isSymbolicLink() &&
      fs.realpathSync(path.join(mismatchApp, 'outbox')) === fs.realpathSync(priorTarget),
      'mismatched_persistent_symlink_not_unlinked'
    )
    ok(
      fs.readFileSync(path.join(priorTarget, 'unique.json'), 'utf8') === '{"unique":true}' &&
      fs.readFileSync(path.join(expectedTarget, 'expected.json'), 'utf8') === '{"expected":true}',
      'mismatched_and_expected_persistent_targets_preserved'
    )

    // Legacy-to-namespace migration must not skip a destination collision. A
    // different copy aborts before either side is changed.
    const legacyCollisionApp = path.join(tmp, 'legacy-collision-app')
    const legacyCollisionData = path.join(tmp, 'legacy-collision-data')
    const legacyCollisionSource = path.join(legacyCollisionData, 'outbox', 'same.json')
    const legacyCollisionTarget = path.join(
      namespacedPersistRoot(legacyCollisionData, 'legacy-collision'),
      'outbox',
      'same.json'
    )
    fs.mkdirSync(path.join(legacyCollisionApp, 'outbox'), { recursive: true })
    fs.mkdirSync(path.dirname(legacyCollisionSource), { recursive: true })
    fs.mkdirSync(path.dirname(legacyCollisionTarget), { recursive: true })
    fs.writeFileSync(legacyCollisionSource, 'legacy-copy')
    fs.writeFileSync(legacyCollisionTarget, 'namespaced-copy')
    let legacyCollisionThrew = false
    try {
      ensurePersistentStateDirs(
        legacyCollisionApp,
        ['outbox'],
        legacyCollisionData,
        'legacy-collision',
        { required: true }
      )
    } catch (error) {
      legacyCollisionThrew = /persistent_state_legacy_collision/.test(String(error?.message || error))
    }
    ok(legacyCollisionThrew, 'legacy_namespace_collision_fails_closed')
    ok(
      fs.readFileSync(legacyCollisionSource, 'utf8') === 'legacy-copy' &&
      fs.readFileSync(legacyCollisionTarget, 'utf8') === 'namespaced-copy',
      'legacy_namespace_collision_preserves_both_copies'
    )

    // Byte-identical collision is the only safe deduplication case.
    const identicalApp = path.join(tmp, 'legacy-identical-app')
    const identicalData = path.join(tmp, 'legacy-identical-data')
    const identicalSource = path.join(identicalData, 'outbox', 'same.json')
    const identicalTarget = path.join(
      namespacedPersistRoot(identicalData, 'legacy-identical'),
      'outbox',
      'same.json'
    )
    fs.mkdirSync(path.join(identicalApp, 'outbox'), { recursive: true })
    fs.mkdirSync(path.dirname(identicalSource), { recursive: true })
    fs.mkdirSync(path.dirname(identicalTarget), { recursive: true })
    fs.writeFileSync(identicalSource, 'identical-copy')
    fs.writeFileSync(identicalTarget, 'identical-copy')
    const identicalBound = ensurePersistentStateDirs(
      identicalApp,
      ['outbox'],
      identicalData,
      'legacy-identical',
      { required: true }
    )
    ok(identicalBound.persistent === true, 'identical_legacy_collision_binds_safely')
    ok(!fs.existsSync(identicalSource), 'identical_legacy_duplicate_removed_after_verification')
    ok(fs.readFileSync(identicalTarget, 'utf8') === 'identical-copy', 'identical_namespaced_copy_preserved')

    // Symlinks/special files inside legacy state are never followed or silently
    // skipped during a production migration.
    const legacySpecialApp = path.join(tmp, 'legacy-special-app')
    const legacySpecialData = path.join(tmp, 'legacy-special-data')
    const legacySpecialOutside = path.join(tmp, 'legacy-special-outside.json')
    const legacySpecialLink = path.join(legacySpecialData, 'outbox', 'linked.json')
    fs.mkdirSync(path.join(legacySpecialApp, 'outbox'), { recursive: true })
    fs.mkdirSync(path.dirname(legacySpecialLink), { recursive: true })
    fs.writeFileSync(legacySpecialOutside, 'outside-copy')
    fs.symlinkSync(legacySpecialOutside, legacySpecialLink)
    let legacySpecialThrew = false
    try {
      ensurePersistentStateDirs(
        legacySpecialApp,
        ['outbox'],
        legacySpecialData,
        'legacy-special',
        { required: true }
      )
    } catch (error) {
      legacySpecialThrew = /persistent_state_legacy_special_entry/.test(String(error?.message || error))
    }
    ok(legacySpecialThrew, 'legacy_special_entry_fails_closed')
    ok(
      fs.lstatSync(legacySpecialLink).isSymbolicLink() &&
      fs.readFileSync(legacySpecialOutside, 'utf8') === 'outside-copy',
      'legacy_special_entry_and_target_preserved'
    )

    const escapeApp = path.join(tmp, 'namespace-escape-app')
    const escapeData = path.join(tmp, 'namespace-escape-data')
    const escapeOutside = path.join(tmp, 'namespace-escape-outside')
    fs.mkdirSync(escapeApp, { recursive: true })
    fs.mkdirSync(escapeData, { recursive: true })
    fs.mkdirSync(escapeOutside, { recursive: true })
    fs.writeFileSync(path.join(escapeOutside, 'sentinel.json'), '{"outside":true}')
    fs.symlinkSync(escapeOutside, path.join(escapeData, 'scv-runtime-namespaces'))
    let namespaceEscapeThrew = false
    try {
      ensurePersistentStateDirs(escapeApp, ['outbox'], escapeData, 'escape', { required: true })
    } catch (error) {
      namespaceEscapeThrew = /persistent_namespace_parent_must_be_real_directory/.test(String(error?.message || error))
    }
    ok(namespaceEscapeThrew, 'persistent_namespace_symlink_escape_fails_closed')
    ok(fs.readFileSync(path.join(escapeOutside, 'sentinel.json'), 'utf8') === '{"outside":true}', 'persistent_namespace_escape_target_untouched')

    // 6. cloud-start actually wires this at boot.
    const bootSrc = fs.readFileSync(path.join(__dirname, 'cloud-start.js'), 'utf8')
    ok(/ensurePersistentStateDirs\(\s*ROOT,\s*dirs,\s*process\.env\.SCV_PERSIST_ROOT/s.test(bootSrc), 'cloud_start_wired_namespaced')
    ok(/required:\s*persistentStateRequired\(process\.env\)/.test(bootSrc), 'cloud_start_requires_persistence_in_cloud')
    ok(/scv_persistent_state/.test(bootSrc), 'boot_receipt_logged')

    // 7. v122 persistence P1 (2026-08-30): the four worker-created runtime
    // surfaces that previously lived under ephemeral /app must be in every
    // persistence list — boot binding, readyz namespace guard, and external
    // attestation expectations — and their contents must survive a deploy.
    const P1_DIRS = [
      'accepted-unverified-boundary-pending',
      'accepted-unverified-delivery-publications',
      'inbox_quarantine_corrupt',
      'outbox_quarantine_corrupt_adoption'
    ]
    const guardSrc = fs.readFileSync(path.join(__dirname, 'inbound-scv.js'), 'utf8')
    const expectationsDoc = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'SCV_EXTERNAL_RUNTIME_EXPECTATIONS.json'), 'utf8'
    ))
    const expectationDirs = expectationsDoc.mutable_state.required_directories
    for (const dir of P1_DIRS) {
      ok(new RegExp(`'${dir}'`).test(bootSrc), `cloud_start_persists_${dir}`)
      ok(new RegExp(`'${dir}'`).test(guardSrc), `runtime_guard_covers_${dir}`)
      ok(expectationDirs.includes(dir), `attestation_expects_${dir}`)
    }
    const bootDirsMatch = bootSrc.match(/const dirs = \[([^\]]+)\]/s)
    const guardDirsMatch = guardSrc.match(/const RUNTIME_GUARD_DIRS = \[([^\]]+)\]/s)
    const listNames = (block) => (String(block || '').match(/'([^']+)'/g) || [])
      .map((item) => item.slice(1, -1)).sort()
    ok(bootDirsMatch && guardDirsMatch &&
      JSON.stringify(listNames(bootDirsMatch[1])) === JSON.stringify(listNames(guardDirsMatch[1])),
    'boot_and_guard_dir_lists_identical')
    ok(JSON.stringify(listNames(bootDirsMatch[1])) === JSON.stringify([...expectationDirs].sort()),
      'boot_and_attestation_dir_lists_identical')

    const p1App = path.join(tmp, 'p1-app')
    const p1Data = path.join(tmp, 'p1-data')
    fs.mkdirSync(p1App, { recursive: true })
    fs.mkdirSync(p1Data, { recursive: true })
    const p1Ns = 'harness-p1-restart'
    ensurePersistentStateDirs(p1App, P1_DIRS, p1Data, p1Ns, { required: true })
    for (const dir of P1_DIRS) {
      fs.writeFileSync(path.join(p1App, dir, 'survives.json'), JSON.stringify({ dir }))
    }
    // Simulated deploy: /app is wiped, /data survives, next boot rebinds.
    fs.rmSync(p1App, { recursive: true, force: true })
    fs.mkdirSync(p1App, { recursive: true })
    ensurePersistentStateDirs(p1App, P1_DIRS, p1Data, p1Ns, { required: true })
    for (const dir of P1_DIRS) {
      ok(fs.lstatSync(path.join(p1App, dir)).isSymbolicLink(), `p1_rebound_symlink_${dir}`)
      ok(JSON.parse(fs.readFileSync(path.join(p1App, dir, 'survives.json'), 'utf8')).dir === dir,
        `p1_contents_survive_restart_${dir}`)
    }

    return { ok: true, checked }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvPersistentStateHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  }
}

module.exports = { runScvPersistentStateHarness }
