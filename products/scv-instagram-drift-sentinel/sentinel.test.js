import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTENT_FINGERPRINT,
  CURRENT_SNAPSHOT_ID,
  GOLDEN_SNAPSHOT_ID,
  POST_RESTORE_RECEIPT_SHA256,
  PRE_RESET_SNAPSHOT_ID,
  PRE_RESTORE_RECEIPT_SHA256,
  RELEASE_ID,
  RELEASE_MANIFEST,
  RESET_RECEIPT_SHA256,
  SNAPSHOT_CATALOG_SHA256,
  SNAPSHOT_CONTROL_VERSION,
  SNAPSHOT_COUNT,
  VISIBLE_MODEL,
  checkSnapshotControl,
  evaluateEndpoint
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

test('accepts the exact healthy v134 release while preserving operational alerts', () => {
  const result = evaluateEndpoint(target, 200, healthyBody())
  assert.equal(result.ok, true)
  assert.equal(result.operational_alert_count, 1)
})

test('accepts the exact separated golden and post-reset v134 snapshot control', async () => {
  const catalog = {
    snapshot_count: SNAPSHOT_COUNT,
    named_pointers: {
      golden: GOLDEN_SNAPSHOT_ID,
      current: CURRENT_SNAPSHOT_ID
    },
    snapshots: [
      {
        snapshot_id: PRE_RESET_SNAPSHOT_ID,
        release_id: RELEASE_ID,
        omar_system_audit_remaining_count: 7
      },
      {
        snapshot_id: CURRENT_SNAPSHOT_ID,
        release_id: RELEASE_ID,
        previous_snapshot_id: PRE_RESET_SNAPSHOT_ID,
        current_reference: true,
        omar_system_audit_remaining_count: 0,
        reset_receipt: { sha256: RESET_RECEIPT_SHA256 }
      }
    ]
  }
  const catalogBytes = new TextEncoder().encode(`${JSON.stringify(catalog)}\n`)
  const prefix = `scv-instagram-automation/timestamped-snapshots/control/${SNAPSHOT_CONTROL_VERSION}`
  const latest = {
    control_version: SNAPSHOT_CONTROL_VERSION,
    snapshot_count: SNAPSHOT_COUNT,
    golden_snapshot_id: GOLDEN_SNAPSHOT_ID,
    current_snapshot_id: CURRENT_SNAPSHOT_ID,
    catalog: { key: `${prefix}/SCV_TIMESTAMPED_SNAPSHOT_CATALOG.json`, sha256: SNAPSHOT_CATALOG_SHA256 },
    seal: { key: `${prefix}/SCV_TIMESTAMPED_SNAPSHOT_CATALOG_SEAL.json`, sha256: 'dfb580e30a3448495fa6a648907f64e896909c78aad8181527893b21eb45ef0d' },
    restore_tool: { key: `${prefix}/scv-timestamped-restore.js`, sha256: '4044f96616a504c9049657fbe628b63246b56a626fa57cdb5f67dc1307d3f206' },
    restore_receipts: {
      pre_v134_omar_reset: {
        key: `${prefix}/receipts/pre-v134-omar-reset-20260901T195957Z.json`,
        sha256: PRE_RESTORE_RECEIPT_SHA256
      },
      current_post_v134_omar_reset: {
        key: `${prefix}/receipts/current-post-v134-omar-reset-20260901T195959Z.json`,
        sha256: POST_RESTORE_RECEIPT_SHA256
      }
    },
    restore_requires_exact_snapshot_id: true,
    production_cutover_automatic: false,
    private_r2_only: true
  }
  const object = (bytes) => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
  const archive = {
    async get(key) {
      if (key.endsWith('/LATEST.json')) return object(new TextEncoder().encode(JSON.stringify(latest)))
      if (key === latest.catalog.key) return object(catalogBytes)
      return null
    }
  }
  const result = await checkSnapshotControl(archive, {
    hashImpl: async () => SNAPSHOT_CATALOG_SHA256
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.reasons, [])
})

test('rejects a current snapshot pointer that overlays the golden snapshot', async () => {
  const prefix = `scv-instagram-automation/timestamped-snapshots/control/${SNAPSHOT_CONTROL_VERSION}`
  const latest = {
    control_version: SNAPSHOT_CONTROL_VERSION,
    snapshot_count: SNAPSHOT_COUNT,
    golden_snapshot_id: GOLDEN_SNAPSHOT_ID,
    current_snapshot_id: GOLDEN_SNAPSHOT_ID,
    catalog: { key: `${prefix}/SCV_TIMESTAMPED_SNAPSHOT_CATALOG.json`, sha256: SNAPSHOT_CATALOG_SHA256 },
    seal: { key: `${prefix}/SCV_TIMESTAMPED_SNAPSHOT_CATALOG_SEAL.json`, sha256: 'dfb580e30a3448495fa6a648907f64e896909c78aad8181527893b21eb45ef0d' },
    restore_tool: { key: `${prefix}/scv-timestamped-restore.js`, sha256: '4044f96616a504c9049657fbe628b63246b56a626fa57cdb5f67dc1307d3f206' },
    restore_receipts: {
      pre_v134_omar_reset: {
        key: `${prefix}/receipts/pre-v134-omar-reset-20260901T195957Z.json`,
        sha256: PRE_RESTORE_RECEIPT_SHA256
      },
      current_post_v134_omar_reset: {
        key: `${prefix}/receipts/current-post-v134-omar-reset-20260901T195959Z.json`,
        sha256: POST_RESTORE_RECEIPT_SHA256
      }
    },
    restore_requires_exact_snapshot_id: true,
    production_cutover_automatic: false,
    private_r2_only: true
  }
  const bytes = new TextEncoder().encode(JSON.stringify(latest))
  const archive = { async get() { return { arrayBuffer: async () => bytes.buffer } } }
  const result = await checkSnapshotControl(archive)
  assert.equal(result.ok, false)
  assert.ok(result.reasons.includes('current_snapshot_id'))
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
