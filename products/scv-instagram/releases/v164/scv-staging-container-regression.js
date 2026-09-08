#!/usr/bin/env node
// Run the complete candidate regression inside the deployed Node 20 container,
// but never against the live staging worker's mutable /app state. Only immutable
// release files are copied into a throwaway tree; node_modules is mounted
// read-only by symlink; credentials are removed; the tree is deleted afterward.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const childProcess = require('child_process')

const ROOT = __dirname
const MANIFEST_FILE = 'SCV_GOLDEN_PRODUCTION_RELEASE.json'
const SUPPORT_FILES = [
  MANIFEST_FILE,
  'SCV_GOLDEN_SNAPSHOT_MANIFEST.json',
  'SCV_IMMUTABLE_DRIFT_SEAL.json',
  'scv-immutable-drift-firewall.js'
]
const SAFE_PARENT_ENVIRONMENT_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TERM',
  'CI'
]

function assertMainTestIncludesStagingCapability(sourceRoot = ROOT) {
  const packageFile = path.join(sourceRoot, 'package.json')
  const parsed = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
  const mainTest = String(parsed?.scripts?.test || '')
  if (!mainTest.split('&&').map((value) => value.trim()).includes(
    'npm run test:staging-capability-boundary'
  )) {
    throw new Error('staging_regression_main_test_omits_staging_capability_boundary')
  }
  return true
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function safeRelative(relative) {
  return (
    typeof relative === 'string' &&
    relative.length > 0 &&
    !path.isAbsolute(relative) &&
    !relative.split(/[\\/]+/).includes('..')
  )
}

function copyExactFile(sourceRoot, targetRoot, relative, expectedHash = '') {
  if (!safeRelative(relative)) throw new Error(`staging_regression_bad_path:${relative}`)
  const source = path.join(sourceRoot, relative)
  const target = path.join(targetRoot, relative)
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`staging_regression_source_missing:${relative}`)
  }
  if (expectedHash && sha256File(source) !== expectedHash) {
    throw new Error(`staging_regression_source_hash_mismatch:${relative}`)
  }
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  fs.chmodSync(target, fs.statSync(source).mode)
  if (expectedHash && sha256File(target) !== expectedHash) {
    throw new Error(`staging_regression_copy_hash_mismatch:${relative}`)
  }
}

function prepareIsolatedTree(sourceRoot = ROOT) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(sourceRoot, MANIFEST_FILE), 'utf8')
  )
  const snapshot = JSON.parse(
    fs.readFileSync(
      path.join(sourceRoot, 'SCV_GOLDEN_SNAPSHOT_MANIFEST.json'),
      'utf8'
    )
  )
  const files = manifest?.artifact?.files || {}
  const criticalFiles = snapshot?.critical_file_sha256 || {}
  if (Object.keys(files).length < 100) {
    throw new Error('staging_regression_artifact_inventory_too_small')
  }
  if (Object.keys(criticalFiles).length < 100) {
    throw new Error('staging_regression_snapshot_inventory_too_small')
  }
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-stage-regression-'))
  const copied = new Set()
  try {
    for (const [relative, expectedHash] of Object.entries(files)) {
      copyExactFile(sourceRoot, targetRoot, relative, expectedHash)
      copied.add(relative)
    }
    // Some harnesses consume immutable source receipts that do not execute in
    // production and therefore are not release artifact files. They are still
    // hash-bound by the snapshot/seal chain and must be copied exactly.
    for (const [relative, expectedHash] of Object.entries(criticalFiles)) {
      if (copied.has(relative)) continue
      copyExactFile(sourceRoot, targetRoot, relative, expectedHash)
      copied.add(relative)
    }
    for (const relative of SUPPORT_FILES) {
      if (copied.has(relative)) continue
      copyExactFile(sourceRoot, targetRoot, relative)
      copied.add(relative)
    }
    const sourceModules = path.join(sourceRoot, 'node_modules')
    if (!fs.existsSync(sourceModules) || !fs.statSync(sourceModules).isDirectory()) {
      throw new Error('staging_regression_node_modules_missing')
    }
    fs.symlinkSync(sourceModules, path.join(targetRoot, 'node_modules'), 'dir')
    const persistRoot = path.join(targetRoot, '.persist')
    fs.mkdirSync(persistRoot, { recursive: true })
    return {
      manifest,
      snapshot,
      targetRoot,
      persistRoot,
      copiedFileCount: copied.size
    }
  } catch (error) {
    fs.rmSync(targetRoot, { recursive: true, force: true })
    throw error
  }
}

function regressionEnvironment(prepared) {
  const env = Object.fromEntries(
    SAFE_PARENT_ENVIRONMENT_KEYS
      .filter((key) => typeof process.env[key] === 'string')
      .map((key) => [key, process.env[key]])
  )
  Object.assign(env, {
    SCV_ROOT: prepared.targetRoot,
    SCV_PERSIST_ROOT: prepared.persistRoot,
    SCV_RUNTIME_NAMESPACE:
      `staging-regression-${prepared.manifest.content_fingerprint_sha256.slice(0, 12)}`,
    SCV_RELEASE_MODE: 'staging',
    SCV_PAUSE_ALL: '1',
    SCV_PAUSE_NON_TEST: '1',
    SCV_PURGE_TEST_ACCOUNT_ON_STARTUP: '0',
    TZ: 'America/Los_Angeles'
  })
  return env
}

function main() {
  assertMainTestIncludesStagingCapability(ROOT)
  const prepared = prepareIsolatedTree()
  try {
    const result = childProcess.spawnSync('npm', ['test'], {
      cwd: prepared.targetRoot,
      env: regressionEnvironment(prepared),
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024
    })
    process.stdout.write(String(result.stdout || ''))
    process.stderr.write(String(result.stderr || ''))
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`staging_isolated_regression_failed:${result.status}`)
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      version: 'scv-staging-container-regression-2026-07-25-v1',
      release_id: prepared.manifest.release_id,
      content_fingerprint_sha256:
        prepared.manifest.content_fingerprint_sha256,
      isolated_tree: true,
      source_artifact_files: Object.keys(prepared.manifest.artifact.files).length,
      source_snapshot_critical_files:
        Object.keys(prepared.snapshot.critical_file_sha256).length,
      copied_files: prepared.copiedFileCount,
      credentials_exposed_to_regression: false,
      production_mutation: false
    })}\n`)
  } finally {
    fs.rmSync(prepared.targetRoot, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`)
    process.exit(1)
  }
}

module.exports = {
  assertMainTestIncludesStagingCapability,
  copyExactFile,
  prepareIsolatedTree,
  regressionEnvironment,
  safeRelative,
  sha256File
}
