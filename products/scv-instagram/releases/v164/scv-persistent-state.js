// ============================================================
// SCV PERSISTENT STATE — survive deploys/restarts (Railway ephemeral fs fix).
//
// Root cause this exists for: Railway's /app filesystem is wiped on every deploy
// and restart. With no volume, every `railway up` destroyed the outbox (pending
// delayed replies -> silently never sent), thread-history (conversation memory,
// coalesce backlog, one-shot rule state), and thread-state. Confirmed live:
// christian.bolanos.35977's phone-number reply vanished this way.
//
// Fix: a Railway volume is mounted at PERSIST_ROOT (/data). At boot, each state
// dir under /app is replaced with a symlink into the volume (one-time migrating
// any existing files). Every module keeps using its /app paths unchanged.
// Local development may explicitly use plain directories. Railway staging and
// production fail closed before any worker starts if the volume cannot be bound.
// ============================================================
const fs = require('fs')
const path = require('path')

const {
  runtimeNamespaceFromEnv,
  safeRuntimeNamespace,
  namespacedPersistRoot,
  pathInside
} = require(path.join(__dirname, 'scv-runtime-namespace.js'))

const DEFAULT_PERSIST_ROOT = process.env.SCV_PERSIST_ROOT || '/data'
const MAX_PRIVATE_TREE_ENTRIES = 100000

function persistentRootAvailable(persistRoot = DEFAULT_PERSIST_ROOT) {
  try {
    return fs.existsSync(persistRoot) && fs.statSync(persistRoot).isDirectory()
  } catch {
    return false
  }
}

function persistentStateRequired(env = process.env) {
  const railway = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const release = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  return railway === 'production' || railway === 'staging' ||
    release === 'production' || release === 'staging'
}

function probePersistentRoot(persistRoot) {
  fs.mkdirSync(persistRoot, { recursive: true })
  const probe = path.join(persistRoot, `.scv-persist-probe-${process.pid}-${Date.now()}`)
  let fd
  try {
    fd = fs.openSync(probe, 'wx', 0o600)
    const value = `scv-persistent-probe:${process.pid}`
    fs.writeFileSync(fd, value)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    if (fs.readFileSync(probe, 'utf8') !== value) {
      throw new Error('persistent_write_probe_readback_mismatch')
    }
    return true
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
    try { fs.unlinkSync(probe) } catch {}
  }
}

function prepareNamespacedPersistRoot(persistRoot, effectivePersistRoot) {
  const rootStat = fs.lstatSync(persistRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('persistent_root_must_be_real_directory')
  }
  const namespaceParent = path.dirname(effectivePersistRoot)
  if (!fs.existsSync(namespaceParent)) fs.mkdirSync(namespaceParent, { mode: 0o700 })
  const parentStat = fs.lstatSync(namespaceParent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('persistent_namespace_parent_must_be_real_directory')
  }
  if (!fs.existsSync(effectivePersistRoot)) fs.mkdirSync(effectivePersistRoot, { mode: 0o700 })
  const effectiveStat = fs.lstatSync(effectivePersistRoot)
  if (!effectiveStat.isDirectory() || effectiveStat.isSymbolicLink()) {
    throw new Error('persistent_namespace_must_be_real_directory')
  }
  const realRoot = fs.realpathSync(persistRoot)
  const realEffectiveRoot = fs.realpathSync(effectivePersistRoot)
  if (!pathInside(realRoot, realEffectiveRoot)) {
    throw new Error('persistent_namespace_escapes_root')
  }
  return realEffectiveRoot
}

// Production state was historically created with 0755 directories and 0644
// files. Before any worker starts, preflight the complete namespaced data tree
// and then tighten it to owner-only permissions. The preflight is deliberately
// separate from mutation: a link or special file fails closed before a single
// mode bit is changed.
function hardenPrivateTreePermissions(root, options = {}) {
  const resolvedRoot = path.resolve(root)
  const maxEntries = Number(options.maxEntries || MAX_PRIVATE_TREE_ENTRIES)
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error('persistent_private_tree_entry_limit_invalid')
  }
  const rootStat = fs.lstatSync(resolvedRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('persistent_private_tree_root_must_be_real_directory')
  }
  const entries = [{ path: resolvedRoot, stat: rootStat, directory: true }]
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error(`persistent_private_tree_special_entry:${entry.name}`)
      }
      entries.push({ path: target, stat, directory: stat.isDirectory() })
      if (entries.length > maxEntries) {
        throw new Error('persistent_private_tree_entry_limit_exceeded')
      }
      if (stat.isDirectory()) walk(target)
    }
  }
  walk(resolvedRoot)

  for (const item of entries) {
    const flags = fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW || 0) |
      (item.directory ? (fs.constants.O_DIRECTORY || 0) : 0)
    let descriptor
    try {
      descriptor = fs.openSync(item.path, flags)
      const current = fs.fstatSync(descriptor)
      if (
        current.dev !== item.stat.dev || current.ino !== item.stat.ino ||
        current.isDirectory() !== item.directory ||
        (!item.directory && !current.isFile())
      ) throw new Error('persistent_private_tree_changed_during_hardening')
      fs.fchmodSync(descriptor, item.directory ? 0o700 : 0o600)
      const hardened = fs.fstatSync(descriptor)
      if ((hardened.mode & 0o077) !== 0) {
        throw new Error('persistent_private_tree_mode_verification_failed')
      }
    } catch (error) {
      if (['ELOOP', 'EMLINK'].includes(String(error?.code || ''))) {
        throw new Error('persistent_private_tree_changed_during_hardening')
      }
      throw error
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor)
    }
  }
  return {
    directories_hardened: entries.filter((item) => item.directory).length,
    files_hardened: entries.filter((item) => !item.directory).length,
    owner_only: true
  }
}

function moveFileSafe(from, to) {
  try {
    if (fs.existsSync(to)) return false
    // COPYFILE_EXCL avoids POSIX rename's overwrite behavior if another process
    // creates the destination after our preflight. Verify before unlinking the
    // only source copy; a crash leaves duplicates, never zero copies.
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
    if (!filesEqual(from, to)) return false
    fs.unlinkSync(from)
    return true
  } catch {
    return false
  }
}

function filesEqual(left, right) {
  try {
    const leftStat = fs.statSync(left)
    const rightStat = fs.statSync(right)
    if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false
    return fs.readFileSync(left).equals(fs.readFileSync(right))
  } catch {
    return false
  }
}

// Binding replaces the entire app directory with a symlink. Validate the whole
// migration before moving a single entry so nested/special entries or a
// conflicting persistent copy can never be discarded by the final removal.
function assertFlatMigrationSafe(appPath, dataPath) {
  const entries = fs.readdirSync(appPath, { withFileTypes: true })
  for (const entry of entries) {
    const source = path.join(appPath, entry.name)
    const target = path.join(dataPath, entry.name)
    if (!entry.isFile()) {
      throw new Error(`persistent_state_nested_or_special_entry:${entry.name}`)
    }
    if (fs.existsSync(target) && !filesEqual(source, target)) {
      throw new Error(`persistent_state_migration_collision:${entry.name}`)
    }
  }
  return entries
}

function assertTreeMigrationSafe(fromDir, toDir, relative = '') {
  if (!fs.existsSync(fromDir)) return
  const fromRootStat = fs.lstatSync(fromDir)
  if (!fromRootStat.isDirectory() || fromRootStat.isSymbolicLink()) {
    throw new Error('persistent_state_legacy_root_must_be_real_directory')
  }
  if (fs.existsSync(toDir)) {
    const toRootStat = fs.lstatSync(toDir)
    if (!toRootStat.isDirectory() || toRootStat.isSymbolicLink()) {
      throw new Error('persistent_state_namespace_root_must_be_real_directory')
    }
  }
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name)
    const to = path.join(toDir, entry.name)
    const label = path.join(relative, entry.name)
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new Error(`persistent_state_legacy_special_entry:${label}`)
    }
    if (entry.isFile()) {
      if (!fs.existsSync(to)) continue
      const targetStat = fs.lstatSync(to)
      if (targetStat.isSymbolicLink() || !targetStat.isFile() || !filesEqual(from, to)) {
        throw new Error(`persistent_state_legacy_collision:${label}`)
      }
      continue
    }
    if (fs.existsSync(to)) {
      const targetStat = fs.lstatSync(to)
      if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        throw new Error(`persistent_state_legacy_collision:${label}`)
      }
    }
    assertTreeMigrationSafe(from, to, label)
  }
}

function migrateTreeEntriesLossless(fromDir, toDir) {
  let moved = 0
  fs.mkdirSync(toDir, { recursive: true })
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, entry.name)
    const to = path.join(toDir, entry.name)
    const sourceStat = fs.lstatSync(from)
    if (sourceStat.isSymbolicLink() || (!sourceStat.isFile() && !sourceStat.isDirectory())) {
      throw new Error(`persistent_state_legacy_special_entry:${entry.name}`)
    }
    if (sourceStat.isDirectory()) {
      if (!fs.existsSync(to)) fs.mkdirSync(to, { mode: 0o700 })
      const targetStat = fs.lstatSync(to)
      if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
        throw new Error(`persistent_state_legacy_collision:${entry.name}`)
      }
      moved += migrateTreeEntriesLossless(from, to)
      fs.rmdirSync(from)
      continue
    }
    if (fs.existsSync(to)) {
      const targetStat = fs.lstatSync(to)
      if (!targetStat.isFile() || targetStat.isSymbolicLink() || !filesEqual(from, to)) {
        throw new Error(`persistent_state_legacy_collision:${entry.name}`)
      }
      fs.unlinkSync(from)
      continue
    }
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
    if (!filesEqual(from, to)) {
      throw new Error(`persistent_state_legacy_copy_verification_failed:${entry.name}`)
    }
    fs.unlinkSync(from)
    moved++
  }
  return moved
}

// Replace <appRoot>/<dir> with a symlink to <persistRoot>/<dir>, migrating any
// existing files once. The complete legacy tree is validated before any move;
// collisions cannot be skipped and byte-identical duplicates are deduplicated.
function moveTreeEntriesSafe(fromDir, toDir) {
  if (!fs.existsSync(fromDir)) return 0
  assertTreeMigrationSafe(fromDir, toDir)
  return migrateTreeEntriesLossless(fromDir, toDir)
}

function migrateLegacyPersistDirToNamespace(legacyPersistRoot, effectivePersistRoot, dir) {
  if (path.resolve(legacyPersistRoot) === path.resolve(effectivePersistRoot)) return 0
  const legacyPath = path.join(legacyPersistRoot, dir)
  const namespacedPath = path.join(effectivePersistRoot, dir)
  return moveTreeEntriesSafe(legacyPath, namespacedPath)
}

function bindStateDirToPersistentRoot(appRoot, persistRoot, dir, legacyPersistRoot = persistRoot) {
  const appPath = path.join(appRoot, dir)
  const dataPath = path.join(persistRoot, dir)
  let st = null
  try { st = fs.lstatSync(appPath) } catch {}

  if (st && st.isSymbolicLink()) {
    const linkedTarget = path.resolve(path.dirname(appPath), fs.readlinkSync(appPath))
    if (linkedTarget !== path.resolve(dataPath)) {
      // A mismatched link can still contain the only surviving queue/history
      // state from an older namespace. Never sever it implicitly; an operator
      // must explicitly inspect and migrate the two persistent targets.
      throw new Error(`persistent_state_existing_symlink_target_mismatch:${dir}`)
    }
  }

  fs.mkdirSync(dataPath, { recursive: true })
  const dataStat = fs.lstatSync(dataPath)
  if (!dataStat.isDirectory() || dataStat.isSymbolicLink()) {
    throw new Error(`persistent_state_target_must_be_real_directory:${dir}`)
  }
  const migratedLegacy = migrateLegacyPersistDirToNamespace(legacyPersistRoot, persistRoot, dir)
  if (st && st.isSymbolicLink()) {
    return { dir, mode: 'already_linked', migrated: 0, migrated_legacy: migratedLegacy }
  }

  let migrated = 0
  if (st && st.isDirectory()) {
    const entries = assertFlatMigrationSafe(appPath, dataPath)
    for (const entry of entries) {
      const source = path.join(appPath, entry.name)
      const target = path.join(dataPath, entry.name)
      const sourceStat = fs.lstatSync(source)
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
        throw new Error(`persistent_state_source_changed_during_migration:${entry.name}`)
      }
      if (fs.existsSync(target)) {
        // The preflight above proved byte-for-byte equality, so retaining the
        // persistent copy and removing the duplicate source is lossless. Check
        // again at commit time so a concurrent replacement cannot win a race.
        const targetStat = fs.lstatSync(target)
        if (!targetStat.isFile() || targetStat.isSymbolicLink() || !filesEqual(source, target)) {
          throw new Error(`persistent_state_migration_collision:${entry.name}`)
        }
        fs.unlinkSync(source)
      } else if (moveFileSafe(source, target)) {
        migrated++
      } else {
        throw new Error(`persistent_state_migration_failed:${entry.name}`)
      }
    }
    fs.rmdirSync(appPath)
  }

  fs.symlinkSync(dataPath, appPath)
  return { dir, mode: 'linked', migrated, migrated_legacy: migratedLegacy }
}

// Boot entry: bind every state dir into the volume when it exists; otherwise the
// old plain-mkdir behavior so local dev / harnesses are untouched.
function ensurePersistentStateDirs(
  appRoot,
  dirs,
  persistRoot = DEFAULT_PERSIST_ROOT,
  namespace = runtimeNamespaceFromEnv(process.env),
  options = {}
) {
  const safeNamespace = safeRuntimeNamespace(namespace)
  const required = options.required == null
    ? persistentStateRequired(options.env || process.env)
    : options.required === true
  if (!persistentRootAvailable(persistRoot)) {
    if (required) {
      throw new Error(`persistent_root_required_unavailable:${persistRoot}`)
    }
    for (const dir of dirs) fs.mkdirSync(path.join(appRoot, dir), { recursive: true })
    return { persistent: false, required, persist_root: persistRoot, namespace: safeNamespace, reason: 'persist_root_missing_plain_mkdir', bound: [] }
  }
  const effectivePersistRoot = namespacedPersistRoot(persistRoot, safeNamespace)
  prepareNamespacedPersistRoot(persistRoot, effectivePersistRoot)
  probePersistentRoot(effectivePersistRoot)
  const bound = []
  for (const dir of dirs) {
    try {
      bound.push(bindStateDirToPersistentRoot(appRoot, effectivePersistRoot, dir, persistRoot))
    } catch (err) {
      if (required) {
        throw new Error(`persistent_state_bind_failed:${dir}:${String(err?.message || err)}`)
      }
      try { fs.mkdirSync(path.join(appRoot, dir), { recursive: true }) } catch {}
      bound.push({ dir, mode: 'bind_failed_plain_mkdir', error: String(err?.message || err) })
    }
  }
  for (const dir of dirs) {
    const appPath = path.join(appRoot, dir)
    const expected = path.resolve(effectivePersistRoot, dir)
    let actual = ''
    try {
      if (!fs.lstatSync(appPath).isSymbolicLink()) throw new Error('not_symlink')
      actual = path.resolve(path.dirname(appPath), fs.readlinkSync(appPath))
    } catch (error) {
      if (required) throw new Error(`persistent_state_binding_invalid:${dir}:${String(error?.message || error)}`)
      continue
    }
    if (actual !== expected && required) {
      throw new Error(`persistent_state_binding_target_mismatch:${dir}:${actual}:${expected}`)
    }
  }
  const allBound = bound.length === dirs.length && bound.every((entry) =>
    entry.mode === 'linked' || entry.mode === 'already_linked'
  )
  if (required && !allBound) throw new Error('persistent_state_not_all_bound')
  const privatePermissions = hardenPrivateTreePermissions(effectivePersistRoot)
  return {
    persistent: allBound,
    required,
    write_probe: true,
    persist_root: persistRoot,
    effective_persist_root: effectivePersistRoot,
    namespace: safeNamespace,
    private_permissions: privatePermissions,
    bound
  }
}

module.exports = {
  DEFAULT_PERSIST_ROOT,
  persistentRootAvailable,
  persistentStateRequired,
  probePersistentRoot,
  prepareNamespacedPersistRoot,
  hardenPrivateTreePermissions,
  filesEqual,
  assertFlatMigrationSafe,
  migrateLegacyPersistDirToNamespace,
  bindStateDirToPersistentRoot,
  ensurePersistentStateDirs
}
