#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')
const { spawnSync } = require('child_process')

const ROOT = __dirname
const release = require('./scv-single-release.js')
const behavior = require('./scv-runtime-behavior-contract.js')

const IDS = Object.freeze({
  project: '11111111-1111-4111-8111-111111111111',
  productionEnvironment: '22222222-2222-4222-8222-222222222222',
  productionService: '33333333-3333-4333-8333-333333333333',
  stagingEnvironment: '44444444-4444-4444-8444-444444444444',
  stagingService: '55555555-5555-4555-8555-555555555555',
  productionDeployment: '66666666-6666-4666-8666-666666666666',
  stagingDeployment: '77777777-7777-4777-8777-777777777777'
})

const PRODUCTION_NAMESPACE = 'single-release-production'
const STAGING_NAMESPACE = 'single-release-staging'

function copySealedInputs(source, target) {
  for (const input of release.collectRuntimeInputs(source)) {
    const from = path.join(source, input.path)
    const to = path.join(target, input.path)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-single-release-'))
  copySealedInputs(ROOT, root)
  const descriptor = release.buildSingleReleaseDescriptor({
    root,
    releaseId: 'scv-instagram-single-release-test-v1',
    projectId: IDS.project,
    productionEnvironmentId: IDS.productionEnvironment,
    productionServiceId: IDS.productionService,
    stagingEnvironmentId: IDS.stagingEnvironment,
    stagingServiceId: IDS.stagingService,
    productionNamespace: PRODUCTION_NAMESPACE,
    stagingNamespace: STAGING_NAMESPACE,
    createdAt: new Date('2026-08-25T00:00:00.000Z')
  })
  assert.deepStrictEqual(release.descriptorStructureFailures(descriptor), [])
  fs.writeFileSync(
    path.join(root, release.SCV_SINGLE_RELEASE_FILE),
    `${JSON.stringify(descriptor, null, 2)}\n`,
    { mode: 0o600 }
  )
  return { root, descriptor }
}

function runtimeEnv(mode) {
  const production = mode === 'production'
  const env = {
    ...behavior.MODEL_ENV_EXPECTED,
    ...behavior.COMMON_EXACT,
    ...behavior.MODE_EXACT[mode],
    RAILWAY_PROJECT_ID: IDS.project,
    RAILWAY_ENVIRONMENT_NAME: mode,
    RAILWAY_ENVIRONMENT_ID: production
      ? IDS.productionEnvironment
      : IDS.stagingEnvironment,
    RAILWAY_SERVICE_ID: production
      ? IDS.productionService
      : IDS.stagingService,
    RAILWAY_DEPLOYMENT_ID: production
      ? IDS.productionDeployment
      : IDS.stagingDeployment,
    SCV_RUNTIME_NAMESPACE: production
      ? PRODUCTION_NAMESPACE
      : STAGING_NAMESPACE,
    SCV_PAUSE_NON_TEST: production ? '0' : '1',
    SCV_RECOVERY_CUTOVER_AT: '2026-08-24T00:00:00.000Z',
    SCV_MANYCHAT_INGRESS_SECRET: 'i'.repeat(40),
    SCV_ADMIN_SHARED_SECRET: 'a'.repeat(40),
    OPENAI_API_KEY: 'local-fake-openai-key',
    MANYCHAT_API_KEY: 'local-fake-manychat-key'
  }
  if (production) {
    env.GMAIL_IMAP_USER = 'local-fixture@example.invalid'
    env.GMAIL_IMAP_APP_PASSWORD = 'local-fake-app-password'
    env.SCV_REACTION_IG_USERNAME = 'fixture-owner'
    env.SCV_RELEASE_EVIDENCE_HMAC_SECRET = 'h'.repeat(40)
  }
  return env
}

function durableProbe(descriptor, mode, env) {
  const expected = mode === 'production'
    ? descriptor.persistence.production_namespace
    : descriptor.persistence.staging_namespace
  assert.strictEqual(env.SCV_PERSIST_ROOT, '/data')
  assert.strictEqual(env.SCV_RUNTIME_NAMESPACE, expected)
  return {
    ok: true,
    root: '/data',
    namespace: expected,
    write_fsync_read_delete_verified: true
  }
}

function activateFixture(root, env) {
  const receipt = release.verifySingleRelease({
    root,
    env,
    persistenceProbe: durableProbe
  })
  assert.strictEqual(receipt.ok, true, JSON.stringify(receipt.failures))
  release.installSingleReleaseRuntimeIdentity(receipt, env)
  const proof = release.buildSingleReleasePreflightProof(receipt, env)
  env.SCV_PREFLIGHT_PROOF_B64 = Buffer.from(
    JSON.stringify(proof),
    'utf8'
  ).toString('base64url')
  env.SCV_ROOT = root
  return receipt
}

function expectFailure(receipt, expected) {
  assert.strictEqual(receipt.ok, false)
  assert(
    receipt.failures.some((failure) => String(failure).includes(expected)),
    `expected ${expected}: ${JSON.stringify(receipt.failures)}`
  )
}

function dockerContractAssertions(root, descriptor) {
  const patterns = new Set(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')))
  assert(patterns.has('!package-lock.json'))
  for (const file of [
    ...release.PROTECTED_LEGACY_FILES,
    ...release.MUTABLE_ROOT_FILES,
    ...release.NON_ARTIFACT_ROOT_FILES
  ]) {
    assert(patterns.has(file), `dockerignore_missing:${file}`)
    assert(!descriptor.files.some((entry) => entry.path === file))
    assert(!fs.existsSync(path.join(root, file)), `fixture_contains_excluded:${file}`)
  }
  for (const directory of release.MUTABLE_OR_NON_ARTIFACT_DIRS) {
    assert(
      patterns.has(directory) || patterns.has(`${directory}/`),
      `dockerignore_missing:${directory}`
    )
    assert(!descriptor.files.some((entry) =>
      entry.path === directory || entry.path.startsWith(`${directory}/`)))
  }
  assert(descriptor.files.some((entry) => entry.path === 'package-lock.json'))
  assert.strictEqual(descriptor.runtime.entrypoint, 'scv-single-release-entry.js')
  assert.strictEqual(
    fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8')
      .includes('CMD ["node", "scv-single-release-entry.js"]'),
    true
  )
}

function verifyCombinedCloudSafety(receipt, env) {
  const releasePath = require.resolve('./scv-single-release.js')
  const cloudPath = require.resolve('./scv-cloud-runtime-safety.js')
  const singleModule = require(releasePath)
  const original = singleModule.verifySingleRelease
  singleModule.verifySingleRelease = () => receipt
  delete require.cache[cloudPath]
  try {
    const cloud = require(cloudPath)
    const result = cloud.verifyCloudRuntimeSafety({ env })
    assert.strictEqual(result.ok, true, JSON.stringify(result.failures))
  } finally {
    singleModule.verifySingleRelease = original
    delete require.cache[cloudPath]
  }
}

function encoded(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function runChild(kind, root, env) {
  const result = spawnSync(
    process.execPath,
    [__filename, '--child', kind, root, encoded(env)],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }
  )
  assert.strictEqual(
    result.status,
    0,
    `${kind} child failed\nstdout=${result.stdout}\nstderr=${result.stderr}`
  )
  return result.stdout
}

function installProtectedLoadTrap() {
  const protectedNames = release.PROTECTED_LEGACY_FILES
  const originalLoad = Module._load
  Module._load = function protectedLoadTrap(request, parent, isMain) {
    if (protectedNames.has(path.basename(String(request)))) {
      throw new Error(`protected_legacy_load_attempt:${path.basename(String(request))}`)
    }
    return originalLoad.call(this, request, parent, isMain)
  }
}

function childActivate(root, env) {
  Object.assign(process.env, env, { SCV_ROOT: root })
  const single = require(path.join(root, 'scv-single-release.js'))
  const receipt = single.verifySingleRelease({
    root,
    env: process.env,
    persistenceProbe: durableProbe
  })
  assert.strictEqual(receipt.ok, true, JSON.stringify(receipt.failures))
  single.installSingleReleaseRuntimeIdentity(receipt, process.env)
  process.env.SCV_PREFLIGHT_PROOF_B64 = Buffer.from(JSON.stringify(
    single.buildSingleReleasePreflightProof(receipt, process.env)
  ), 'utf8').toString('base64url')
  return { single, receipt }
}

function childOutbound(root, env) {
  installProtectedLoadTrap()
  const { receipt } = childActivate(root, env)
  const outbound = require(path.join(root, 'outbound-scv2.js'))
  const accepted = outbound.finalReleaseIdentityVerdict(process.env)
  assert.strictEqual(accepted.ok, true, JSON.stringify(accepted.failures))
  process.env.SCV_RELEASE_RAILWAY_DEPLOYMENT_ID = IDS.stagingDeployment
  const rejected = outbound.finalReleaseIdentityVerdict(process.env)
  assert.strictEqual(rejected.ok, false)
  assert(rejected.failures.some((failure) =>
    failure.includes('SCV_RELEASE_RAILWAY_DEPLOYMENT_ID')))
  process.stdout.write(`${JSON.stringify({
    child: 'outbound',
    release_id: receipt.release_id,
    accepted: accepted.ok,
    inherited_identity_tamper_blocked: !rejected.ok
  })}\n`)
}

function runMain() {
  assert.strictEqual(process.version, 'v20.20.2', `wrong_node:${process.version}`)
  const fixture = createFixture()
  try {
    dockerContractAssertions(fixture.root, fixture.descriptor)

    const productionEnv = runtimeEnv('production')
    const productionReceipt = activateFixture(fixture.root, productionEnv)
    verifyCombinedCloudSafety(productionReceipt, productionEnv)

    const wrongRailway = {
      ...runtimeEnv('production'),
      RAILWAY_SERVICE_ID: IDS.stagingService
    }
    expectFailure(release.verifySingleRelease({
      root: fixture.root,
      env: wrongRailway,
      persistenceProbe: durableProbe
    }), 'single_release_railway_service_mismatch')

    const wrongModel = {
      ...runtimeEnv('production'),
      OPENAI_DM_MODEL: 'gpt-5.4-mini'
    }
    expectFailure(release.verifySingleRelease({
      root: fixture.root,
      env: wrongModel,
      persistenceProbe: durableProbe
    }), 'single_release_model_env_mismatch:OPENAI_DM_MODEL')

    const missingActualEnforcement = runtimeEnv('production')
    delete missingActualEnforcement.SCV_ENFORCE_OPENAI_MODEL_IDENTITY
    expectFailure(release.verifySingleRelease({
      root: fixture.root,
      env: missingActualEnforcement,
      persistenceProbe: durableProbe
    }), 'single_release_model_env_mismatch:SCV_ENFORCE_OPENAI_MODEL_IDENTITY')

    const wrongActualExecutor = {
      ...runtimeEnv('production'),
      SCV_DM_EXECUTOR: 'codex_exec'
    }
    expectFailure(release.verifySingleRelease({
      root: fixture.root,
      env: wrongActualExecutor,
      persistenceProbe: durableProbe
    }), 'single_release_model_env_mismatch:SCV_DM_EXECUTOR')

    const unsealedBehaviorOverride = {
      ...runtimeEnv('production'),
      SCV_REACTION_RATE: '0.99'
    }
    expectFailure(release.verifySingleRelease({
      root: fixture.root,
      env: unsealedBehaviorOverride,
      persistenceProbe: durableProbe
    }), 'runtime_behavior_env_mismatch:SCV_REACTION_RATE')

    const unexpected = path.join(fixture.root, 'unexpected-runtime-extra.bin')
    fs.writeFileSync(unexpected, 'not sealed')
    expectFailure(release.verifySingleRelease({
      root: fixture.root,
      env: runtimeEnv('production'),
      persistenceProbe: durableProbe
    }), 'single_release_inventory_mismatch')
    fs.unlinkSync(unexpected)

    const stagingEnv = runtimeEnv('staging')
    const stagingReceipt = activateFixture(fixture.root, stagingEnv)
    verifyCombinedCloudSafety(stagingReceipt, stagingEnv)
    assert.notStrictEqual(
      productionReceipt.persistence.namespace,
      stagingReceipt.persistence.namespace
    )

    const outbound = runChild('outbound', fixture.root, runtimeEnv('production'))
    assert(outbound.includes('inherited_identity_tamper_blocked'))

    const descriptorPath = path.join(
      fixture.root,
      release.SCV_SINGLE_RELEASE_FILE
    )
    const descriptorBytes = fs.readFileSync(descriptorPath)
    const activated = runtimeEnv('production')
    const beforeTamper = activateFixture(fixture.root, activated)
    const changed = JSON.parse(descriptorBytes.toString('utf8'))
    changed.release_id = 'scv-instagram-single-release-tampered-v1'
    fs.writeFileSync(descriptorPath, `${JSON.stringify(changed, null, 2)}\n`)
    const afterTamper = release.verifySingleRelease({
      root: fixture.root,
      env: activated,
      verifyPersistence: false
    })
    assert.strictEqual(afterTamper.ok, true, JSON.stringify(afterTamper.failures))
    const identityAfterTamper = release.singleReleaseRuntimeIdentityVerdict({
      receipt: afterTamper,
      env: activated
    })
    assert.strictEqual(identityAfterTamper.ok, false)
    assert(identityAfterTamper.failures.some((failure) =>
      failure.includes('preflight_release_id_mismatch') ||
      failure.includes('preflight_manifest_hash_mismatch')))
    assert.strictEqual(beforeTamper.release_id, productionReceipt.release_id)
    fs.writeFileSync(descriptorPath, descriptorBytes)

    process.stdout.write(`${JSON.stringify({
      ok: true,
      protocol: release.SCV_SINGLE_RELEASE_PROTOCOL,
      release_id: productionReceipt.release_id,
      production_verified: true,
      staging_isolated: true,
      source_tamper_blocked: true,
      descriptor_runtime_tamper_blocked: true,
      wrong_railway_blocked: true,
      wrong_model_blocked: true,
      missing_actual_model_enforcement_blocked: true,
      wrong_actual_executor_blocked: true,
      unsealed_behavior_override_blocked: true,
      final_sender_bound: true,
      protected_legacy_files_read: 0
    }, null, 2)}\n`)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
}

async function main() {
  if (process.argv[2] === '--child') {
    const kind = String(process.argv[3] || '')
    const root = path.resolve(String(process.argv[4] || ''))
    const env = JSON.parse(Buffer.from(
      String(process.argv[5] || ''),
      'base64url'
    ).toString('utf8'))
    if (kind === 'outbound') return childOutbound(root, env)
    throw new Error(`unknown_child:${kind}`)
  }
  runMain()
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: String(error?.stack || error)
  })}\n`)
  process.exit(1)
})
