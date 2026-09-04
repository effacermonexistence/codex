import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GOLD_LATEST_KEY,
  GOLD_MANIFEST_KEY,
  GOLD_MANIFEST_SHA256,
  GOLD_RELEASE_ID,
  GOLD_CONTENT_FINGERPRINT,
  checkGold,
  CONTENT_FINGERPRINT,
  CURRENT_SNAPSHOT_ID,
  GOLDEN_SNAPSHOT_ID,
  POST_RESTORE_RECEIPT_SHA256,
  PRE_RESET_AUDIT_REMAINING_COUNT,
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

test('accepts the exact healthy v138 release while preserving operational alerts', () => {
  const result = evaluateEndpoint(target, 200, healthyBody())
  assert.equal(result.ok, true)
  assert.equal(result.operational_alert_count, 1)
})

test('accepts the exact separated golden and post-reset v138 snapshot control', async () => {
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
        omar_system_audit_remaining_count: PRE_RESET_AUDIT_REMAINING_COUNT
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
    seal: { key: `${prefix}/SCV_TIMESTAMPED_SNAPSHOT_CATALOG_SEAL.json`, sha256: 'c04c45fcb0b54e3fda550f1e7f5196713e0a1a5c4fca6aaf019a602e4cce36e8' },
    restore_tool: { key: `${prefix}/scv-timestamped-restore.js`, sha256: '4044f96616a504c9049657fbe628b63246b56a626fa57cdb5f67dc1307d3f206' },
    restore_receipts: {
      pre_v150_omar_reset: {
        key: `${prefix}/receipts/pre-v150-omar-reset-20260904T054557Z.json`,
        sha256: PRE_RESTORE_RECEIPT_SHA256
      },
      current_post_v150_omar_reset: {
        key: `${prefix}/receipts/current-post-v150-omar-reset-20260904T054601Z.json`,
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
    seal: { key: `${prefix}/SCV_TIMESTAMPED_SNAPSHOT_CATALOG_SEAL.json`, sha256: 'c04c45fcb0b54e3fda550f1e7f5196713e0a1a5c4fca6aaf019a602e4cce36e8' },
    restore_tool: { key: `${prefix}/scv-timestamped-restore.js`, sha256: '4044f96616a504c9049657fbe628b63246b56a626fa57cdb5f67dc1307d3f206' },
    restore_receipts: {
      pre_v150_omar_reset: {
        key: `${prefix}/receipts/pre-v150-omar-reset-20260904T054557Z.json`,
        sha256: PRE_RESTORE_RECEIPT_SHA256
      },
      current_post_v150_omar_reset: {
        key: `${prefix}/receipts/current-post-v150-omar-reset-20260904T054601Z.json`,
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
