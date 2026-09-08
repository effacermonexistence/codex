#!/usr/bin/env node
// ============================================================
// SCV RUNTIME NAMESPACE LOCK — the "stones do not touch" layer.
//
// Ben law: Korea stone / SF stone / Paris stone must not share writable runtime
// state. Code may be one artifact; inbox/outbox/thread-history/form-ledger are
// separate namespaces under the persistent volume.
// ============================================================
const fs = require('fs')
const path = require('path')

const SCV_RUNTIME_NAMESPACE_LOCK_VERSION = 'scv-runtime-namespace-lock-2026-07-09-v1'
const DEFAULT_RUNTIME_NAMESPACE = 'prod'
const NAMESPACE_ROOT_DIR = 'scv-runtime-namespaces'

function safeRuntimeNamespace(raw = DEFAULT_RUNTIME_NAMESPACE) {
  let value = String(raw || '').trim().toLowerCase()
  value = value.replace(/[\\/]+/g, '-')
  value = value.replace(/\.\./g, '')
  value = value.replace(/[^a-z0-9._-]+/g, '-')
  value = value.replace(/-+/g, '-')
  value = value.replace(/^[._-]+|[._-]+$/g, '')
  return value || DEFAULT_RUNTIME_NAMESPACE
}

function runtimeNamespaceFromEnv(env = process.env) {
  return safeRuntimeNamespace(env.SCV_RUNTIME_NAMESPACE || DEFAULT_RUNTIME_NAMESPACE)
}

function namespacedPersistRoot(basePersistRoot, namespace = runtimeNamespaceFromEnv()) {
  return path.join(String(basePersistRoot || ''), NAMESPACE_ROOT_DIR, safeRuntimeNamespace(namespace))
}

function pathInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

function persistentNamespaceRequired(env = process.env) {
  const railway = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const release = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  return railway === 'production' || railway === 'staging' || release === 'production' || release === 'staging'
}

function runScvRuntimeNamespaceGuard({ appRoot = __dirname, dirs = [], persistRoot = process.env.SCV_PERSIST_ROOT || '/data', namespace = runtimeNamespaceFromEnv(), env = process.env, required = persistentNamespaceRequired(env) } = {}) {
  const ns = safeRuntimeNamespace(namespace)
  const expectedRoot = namespacedPersistRoot(persistRoot, ns)
  const checked = []

  if (!fs.existsSync(persistRoot)) {
    return {
      ok: !required,
      checked: 1,
      persistent: false,
      required,
      namespace: ns,
      reason: required ? 'persist_root_required_missing' : 'persist_root_missing_local_plain_dirs'
    }
  }

  for (const dir of dirs) {
    const appPath = path.join(appRoot, dir)
    let stat = null
    try { stat = fs.lstatSync(appPath) } catch (err) {
      throw new Error(`runtime_namespace_missing_app_path:${dir}:${String(err && err.message ? err.message : err)}`)
    }
    if (!stat.isSymbolicLink()) {
      throw new Error(`runtime_namespace_not_symlink:${dir}`)
    }
    const target = path.resolve(appRoot, fs.readlinkSync(appPath))
    const expectedDir = path.join(expectedRoot, dir)
    if (path.resolve(target) !== path.resolve(expectedDir)) {
      throw new Error(`runtime_namespace_wrong_target:${dir}:${target}`)
    }
    if (!pathInside(expectedRoot, target)) {
      throw new Error(`runtime_namespace_cross_namespace_target:${dir}:${target}`)
    }
    checked.push({ dir, target })
  }

  return {
    ok: true,
    checked: checked.length,
    persistent: true,
    required,
    namespace: ns,
    namespace_root: expectedRoot,
    dirs: checked
  }
}

module.exports = {
  SCV_RUNTIME_NAMESPACE_LOCK_VERSION,
  DEFAULT_RUNTIME_NAMESPACE,
  NAMESPACE_ROOT_DIR,
  safeRuntimeNamespace,
  runtimeNamespaceFromEnv,
  namespacedPersistRoot,
  pathInside,
  persistentNamespaceRequired,
  runScvRuntimeNamespaceGuard
}
