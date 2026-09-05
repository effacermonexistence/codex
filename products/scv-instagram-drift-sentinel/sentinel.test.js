import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GOLD_LATEST_KEY,
  GOLD_MANIFEST_KEY,
  GOLD_MANIFEST_SHA256,
  GOLD_RELEASE_ID,
  GOLD_CONTENT_FINGERPRINT,
  checkGold,
  APRIL_GOLDEN_KEY,
  APRIL_GOLDEN_SHA256,
  CONTENT_FINGERPRINT,
  CURRENT_RECOVERY_POINT_ID,
  CURRENT_RECOVERY_POINT_KEY,
  CURRENT_RECOVERY_POINT_SHA256,
  EXPECTED_RECOVERY_COMPONENTS,
  GOLDEN_SNAPSHOT_ID,
  PRE_RESET_AUDIT_REMAINING_COUNT,
  PREVIOUS_RECOVERY_POINT_ID,
  PREVIOUS_RECOVERY_POINT_KEY,
  PREVIOUS_RECOVERY_POINT_SHA256,
  RECOVERY_CATALOG_KEY,
  RECOVERY_CATALOG_SHA256,
  RECOVERY_LATEST_KEY,
  RELEASE_ID,
  RELEASE_MANIFEST,
  RECOVERY_POINT_RELEASE_ID,
  RECOVERY_POINT_CONTENT_FINGERPRINT,
  RECOVERY_POINT_RELEASE_MANIFEST,
  RESET_RECEIPT_SHA256,
  RESTORE_TOOL_KEY,
  RESTORE_TOOL_SHA256,
  VISIBLE_MODEL,
  checkRecoveryPoint,
  evaluateEndpoint,
  verifyPinnedObject
} from './src/index.js'

const target = { name: 'production', mode: 'production' }

function healthyBody() {
  return {
    ok: true,
    fail_close_active: false,
    preflight_verified: true,
    release: {
      ok: true,
      mode: 'production',
      release_phase: 'active',
      phase_ready: true,
      release_id: RELEASE_ID,
      content_fingerprint_sha256: CONTENT_FINGERPRINT,
      release_manifest_sha256: RELEASE_MANIFEST
    },
    drift: { critical_ok: true, critical_alert_count: 0, operational_alert_count: 1, age_ms: 30_000 },
    capability_canary: {
      required: true,
      ok: true,
      voice_ok: true,
      vision_ok: true,
      visible_model_ok: true,
      provider_model: VISIBLE_MODEL,
      age_ms: 60_000
    },
    model_identity: {
      visible_model: VISIBLE_MODEL,
      executor: 'openai_responses',
      api: 'responses_v1',
      enforced: true,
      contract_ok: true,
      cross_model_fallback_allowed: false
    },
    behavior_contract: { ok: true, failures: [] }
  }
}

test('accepts the exact healthy v152 release while preserving operational alerts', () => {
  const result = evaluateEndpoint(target, 200, healthyBody())
  assert.equal(result.ok, true)
  assert.equal(result.operational_alert_count, 1)
})

function recoveryFixture() {
  const latest = {
    bucket: 'omar-private-archive',
    golden_snapshot_id: GOLDEN_SNAPSHOT_ID,
    golden_preserved_separately: true,
    current_recovery_point_id: CURRENT_RECOVERY_POINT_ID,
    current_recovery_point: { key: CURRENT_RECOVERY_POINT_KEY, sha256: CURRENT_RECOVERY_POINT_SHA256 },
    previous_recovery_point_id: PREVIOUS_RECOVERY_POINT_ID,
    catalog: { key: RECOVERY_CATALOG_KEY, sha256: RECOVERY_CATALOG_SHA256 },
    restore_tool: { key: RESTORE_TOOL_KEY, sha256: RESTORE_TOOL_SHA256 },
    restore_requires_exact_recovery_point_id: true,
    production_cutover_automatic: false,
    private_r2_only: true
  }
  const catalog = {
    golden_reference: {
      snapshot_id: GOLDEN_SNAPSHOT_ID,
      key: APRIL_GOLDEN_KEY,
      sha256: APRIL_GOLDEN_SHA256,
      bytes: 40715,
      preserved_separately_from_current: true
    },
    recovery_points: [
      {
        recovery_point_id: PREVIOUS_RECOVERY_POINT_ID,
        key: PREVIOUS_RECOVERY_POINT_KEY,
        sha256: PREVIOUS_RECOVERY_POINT_SHA256,
        current: false,
        staged_restore_verified: true
      },
      {
        recovery_point_id: CURRENT_RECOVERY_POINT_ID,
        key: CURRENT_RECOVERY_POINT_KEY,
        sha256: CURRENT_RECOVERY_POINT_SHA256,
        current: true,
        staged_restore_verified: true,
        live_redteam_cases_passed: 18
      }
    ],
    current_recovery_point_id: CURRENT_RECOVERY_POINT_ID,
    restore_requires_exact_recovery_point_id: true,
    production_cutover_automatic: false
  }
  const point = {
    recovery_point_id: CURRENT_RECOVERY_POINT_ID,
    immutable: true,
    current_at_capture: true,
    release: {
      release_id: RECOVERY_POINT_RELEASE_ID,
      content_fingerprint_sha256: RECOVERY_POINT_CONTENT_FINGERPRINT,
      release_manifest_sha256: RECOVERY_POINT_RELEASE_MANIFEST
    },
    components: EXPECTED_RECOVERY_COMPONENTS.map((component) => ({ ...component })),
    secret_recovery: { values_in_manifest: false },
    capture_evidence: {
      full_local_test_exit_zero: true,
      staging_isolated_full_test_exit_zero: true,
      live_redteam_semantic_passed: 18,
      paused_worker_count: 10,
      post_reset_omar_system_residual_count: 0,
      r2_component_readback_byte_identical: true,
      final_production_ok: true,
      final_fail_close_active: false
    },
    restore_conditions: { r2_only_self_contained: false }
  }
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value))
  const object = (bytes) => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  const objects = new Map([
    [RECOVERY_LATEST_KEY, encode(latest)],
    [RECOVERY_CATALOG_KEY, encode(catalog)],
    [CURRENT_RECOVERY_POINT_KEY, encode(point)]
  ])
  return {
    latest,
    catalog,
    point,
    archive: { async get(key) { const bytes = objects.get(key); return bytes ? object(bytes) : null } },
    options: {
      hashImpl: async (bytes, key) => key === RECOVERY_CATALOG_KEY
        ? RECOVERY_CATALOG_SHA256
        : key === CURRENT_RECOVERY_POINT_KEY ? CURRENT_RECOVERY_POINT_SHA256 : 'unexpected',
      verifyObject: async (expected) => ({ ok: true, key: expected.key })
    }
  }
}

test('accepts the exact current v151 point while keeping v150 and April golden separate', async () => {
  const fixture = recoveryFixture()
  const result = await checkRecoveryPoint(fixture.archive, fixture.options)
  assert.equal(result.ok, true)
  assert.equal(result.pinned_object_count, EXPECTED_RECOVERY_COMPONENTS.length + 2)
  assert.deepEqual(result.reasons, [])
})

test('rejects a current recovery pointer that overlays the April golden identity', async () => {
  const fixture = recoveryFixture()
  fixture.latest.current_recovery_point_id = GOLDEN_SNAPSHOT_ID
  const bytes = new TextEncoder().encode(JSON.stringify(fixture.latest))
  fixture.archive.get = async (key) => {
    if (key === RECOVERY_LATEST_KEY) return { arrayBuffer: async () => bytes.buffer }
    return null
  }
  const result = await checkRecoveryPoint(fixture.archive, fixture.options)
  assert.equal(result.ok, false)
  assert.ok(result.reasons.includes('current_recovery_point_id'))
})

test('pinned object verification rejects same-key byte or hash drift', async () => {
  const bytes = new TextEncoder().encode('abc')
  const archive = { async get() { return { arrayBuffer: async () => bytes.buffer } } }
  const wrongBytes = await verifyPinnedObject(archive, { key: 'x', bytes: 4, sha256: 'expected' }, {
    hashImpl: async () => 'expected'
  })
  assert.equal(wrongBytes.ok, false)
  assert.equal(wrongBytes.reason, 'byte_count')
  const wrongHash = await verifyPinnedObject(archive, { key: 'x', bytes: 3, sha256: 'expected' }, {
    hashImpl: async () => 'other'
  })
  assert.equal(wrongHash.ok, false)
  assert.equal(wrongHash.reason, 'sha256')
})

test('rejects content fingerprint drift', () => {
  const body = healthyBody()
  body.release.content_fingerprint_sha256 = '0'.repeat(64)
  const result = evaluateEndpoint(target, 200, body)
  assert.equal(result.ok, false)
  assert.ok(result.reasons.includes('content_fingerprint'))
})

test('rejects stale or failed provider capabilities', () => {
  const body = healthyBody()
  body.capability_canary.voice_ok = false
  body.capability_canary.age_ms = 10_000_000
  const result = evaluateEndpoint(target, 200, body)
  assert.equal(result.ok, false)
  assert.ok(result.reasons.includes('voice_capability'))
  assert.ok(result.reasons.includes('capability_canary_stale'))
})

test('rejects critical drift but not an isolated operational quarantine alert', () => {
  const body = healthyBody()
  body.drift.critical_ok = false
  body.drift.critical_alert_count = 1
  const result = evaluateEndpoint(target, 200, body)
  assert.equal(result.ok, false)
  assert.ok(result.reasons.includes('critical_drift'))
  assert.ok(result.reasons.includes('critical_drift_alerts'))
})

test('accepts the pinned GOLD-3 manifest and rejects a drifted one', async () => {
  const manifestBytes = new TextEncoder().encode(JSON.stringify({ gold_name: 'GOLD-3', release: { release_id: GOLD_RELEASE_ID, content_fingerprint_sha256: GOLD_CONTENT_FINGERPRINT } }))
  const latest = { manifest: { key: GOLD_MANIFEST_KEY, sha256: GOLD_MANIFEST_SHA256 } }
  const object = (bytes) => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  const archive = { async get(key) { if (key === GOLD_LATEST_KEY) return object(new TextEncoder().encode(JSON.stringify(latest))); if (key === GOLD_MANIFEST_KEY) return object(manifestBytes); return null } }
  const good = await checkGold(archive, { hashImpl: async () => GOLD_MANIFEST_SHA256 })
  assert.equal(good.ok, true)
  assert.deepEqual(good.reasons, [])
  const drifted = await checkGold(archive, { hashImpl: async () => 'deadbeef' })
  assert.equal(drifted.ok, false)
  assert.ok(drifted.reasons.includes('gold_manifest_object_hash'))
  const wrongRelease = { async get(key) { if (key === GOLD_LATEST_KEY) return object(new TextEncoder().encode(JSON.stringify(latest))); if (key === GOLD_MANIFEST_KEY) return object(new TextEncoder().encode(JSON.stringify({ release: { release_id: 'other', content_fingerprint_sha256: 'x' } }))); return null } }
  const bad = await checkGold(wrongRelease, { hashImpl: async () => GOLD_MANIFEST_SHA256 })
  assert.equal(bad.ok, false)
  assert.ok(bad.reasons.includes('gold_manifest_release_fingerprint'))
})
