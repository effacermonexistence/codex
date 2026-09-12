const SENTINEL_SCHEMA = 'scv-instagram-drift-sentinel-2026-09-12-v31-v170-running-release-v167-recovery-gold'
// GOLD-3 (2026-09-03): v148 (owner-verified v145 plus the owner-ordered polish, live red-team verified) frozen as the reference; the pointer and manifest below are pinned by hash.
const GOLD_LATEST_KEY = 'scv-instagram-automation/gold/LATEST.json'
const GOLD_MANIFEST_KEY = 'scv-instagram-automation/gold/SCV_GOLD_MANIFEST_v148.json'
const GOLD_MANIFEST_SHA256 = '31ea4507381e6ec2c3ce4458d70af4a311f331a4a26651f5d9234a01312766cc'
// The frozen gold is a REFERENCE, not necessarily the running release: later releases shipped fixes,
// so the gold pointer deliberately still describes v148.
// Comparing the gold manifest against the running release id made the check fail by construction.
const GOLD_RELEASE_ID = 'scv-instagram-single-20260902-v148'
const GOLD_CONTENT_FINGERPRINT = '3a9a18631443f4738d13dd803f080979ff4d21ab0d9de1f5054b2f26e2ea3609'
// v31 (2026-09-12): the running release is v170 (client language matching plus the script-decisive
// short-turn switch: a short Hangul turn now overrides an English floor). The latest approved
// recovery Gold stays v167 — a release is not a Gold, and only the three running-release pins
// below move with a deployment. v151 remains a separately pinned previous recovery point,
// GOLD-3 v148 and the April Golden remain unchanged.
const RELEASE_ID = 'scv-instagram-single-20260912-v170'
const CONTENT_FINGERPRINT = '59902c60578a25ffb6c9c1027e56f2e68460abd3047afbf17bdb1725464ab406'
const RELEASE_MANIFEST = 'a055f62184e6f8963fd7aab017f0aa16d633b9abe82669bf60db601d2f1284d5'
const RECOVERY_POINT_RELEASE_ID = 'scv-instagram-single-20260908-v167'
const RECOVERY_POINT_CONTENT_FINGERPRINT = '6b85a63a25c23e9815491413eeb895e6b78ed8faa523f18aefea6b88f392faa7'
const RECOVERY_POINT_RELEASE_MANIFEST = '2f12a00d12114bbbb05080438dda88a6278a82ae65a9fc9aaaff70a2a25ad4b6'
const VISIBLE_MODEL = 'gpt-5.4-mini-2026-03-17'
const RECOVERY_LATEST_KEY = 'scv-instagram-automation/recovery-points/LATEST.json'
const RECOVERY_CATALOG_KEY = 'scv-instagram-automation/recovery-points/catalogs/20260908T231800Z/RECOVERY_POINT_CATALOG.json'
const RECOVERY_CATALOG_SHA256 = '1ba20b317f8b821e2ba48fe8e74b4e2983020c76c755cb612cd8b33c5bfaa9cb'
const CURRENT_RECOVERY_POINT_ID = 'scv-instagram-20260908T221557Z-v167-clean-current'
const CURRENT_RECOVERY_POINT_KEY = 'scv-instagram-automation/recovery-points/20260908T221557Z/SCV_RECOVERY_POINT.json'
const CURRENT_RECOVERY_POINT_SHA256 = 'fb71ecc4d4662972a4256ae41fbeba09e99ac9360540d075a2e2d0da2c3a5fb6'
const PREVIOUS_RECOVERY_POINT_ID = 'scv-instagram-20260904T222549Z-v151-clean-current'
const PREVIOUS_RECOVERY_POINT_KEY = 'scv-instagram-automation/recovery-points/20260904T222549Z/SCV_RECOVERY_POINT.json'
const PREVIOUS_RECOVERY_POINT_SHA256 = '75440f5063fb7deab879df404ea8fa7011fece7c3da1f7af93c042ee9a337a5a'
const RESTORE_TOOL_KEY = 'scv-instagram-automation/recovery-points/20260908T221557Z/restore-recovery-point.js'
const RESTORE_TOOL_SHA256 = 'b03571cee66bbb7bf08bcecda38a6ba7657a0426e51b0f6c61337171f39883a3'
const APPROVED_RECOVERY_GOLD_ID = 'scv-instagram-recovery-gold-20260908T231500Z-v167'
const APPROVED_RECOVERY_GOLD_RECORD_KEY = 'scv-instagram-automation/recovery-gold/20260908T231500Z/GOLD.json'
const APPROVED_RECOVERY_GOLD_RECORD_SHA256 = '41ec7dae8f527470f0c471e5425605ff692306c81eab6cf8d7e9c4f9b2605038'
const APPROVED_RECOVERY_GOLD_RECORD_BYTES = 2608
const APPROVED_RECOVERY_EXTENSION_KEY = 'scv-instagram-automation/recovery-extensions/20260908T223100Z-v167/SCV_RECOVERY_EXTENSION.json'
const APPROVED_RECOVERY_EXTENSION_SHA256 = '61548a196b36ae1274fbeada94e63cde08bf623cc4bc4284dd6ee8ac1f9c5e23'
const APPROVED_RECOVERY_EXTENSION_BYTES = 4296
const GOLDEN_SNAPSHOT_ID = 'scv-instagram-20260420T152810-local-origin'
const APRIL_GOLDEN_KEY = 'scv-instagram-automation/timestamped-snapshots/2026-04-20/20260420T152810-local/origin-snapshot.tar.gz'
const APRIL_GOLDEN_SHA256 = '1e5225d4d494e55cefec5ee0a58be61e92eeccab6e2d3ea9d1d0f02ccdceba98'
const APRIL_GOLDEN_BYTES = 40715
const RESET_RECEIPT_SHA256 = 'ef11b1fb98bb1115ae0416c5a7ba5a2f15edb5eddb420fa9a16a26c8be53d6e0'
const PRE_RESET_AUDIT_REMAINING_COUNT = 24
const MAX_CANARY_AGE_MS = 90 * 60 * 1000
const MAX_DRIFT_AGE_MS = 3 * 60 * 1000
const FETCH_TIMEOUT_MS = 20_000
// 2026-09-02: the timestamped catalog passed 64 KiB at 37 snapshots and the
// v5 sentinel reported snapshot_catalog_object_too_large; the bound is a guard
// against runaway bodies, not a size budget for the catalog.
const MAX_BODY_BYTES = 1024 * 1024
const MAX_RECOVERY_COMPONENT_BYTES = 8 * 1024 * 1024
const PREFIX = 'scv-instagram-automation/drift-attestations'

const EXPECTED_RECOVERY_COMPONENTS = Object.freeze([
  Object.freeze({ name: 'runtime', required: true,
    key: 'scv-instagram-automation/release-ready/20260908T203126Z/v167/scv-instagram-single-20260908-v167-any-picture-is-a-design-r2.tar.gz',
    sha256: '94ce2f59b5f3724118cfcabe16cfb7f267f00f7c6f01841be42dbf6c77e56afe', bytes: 1494324 }),
  Object.freeze({ name: 'release_manifest', required: true,
    key: 'scv-instagram-automation/recovery-points/20260908T221557Z/SCV_SINGLE_RELEASE.json',
    sha256: '2f12a00d12114bbbb05080438dda88a6278a82ae65a9fc9aaaff70a2a25ad4b6', bytes: 45038 }),
  Object.freeze({ name: 'production_state', required: true,
    key: 'scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260908T221109Z/post-reset/prod-v167.tar.gz',
    sha256: '54673012af4fc4e5f84e2a214ef5a5328512ad541b9c8bd19a23e7743eee7e37', bytes: 4713305,
    namespace_tree_sha256: '926ddb10093d2ad88664770ed042434e79f230ee5d303573c5a281d3d2a0edbb', namespace_entry_count: 2609 }),
  Object.freeze({ name: 'pre_reset_production_state', required: false,
    key: 'scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260908T221109Z/pre-reset/prod-v167.tar.gz',
    sha256: 'ff358835adc8642c10cdc86e9c744552c035254a735b41a7f805820fb3a64c9b', bytes: 4801376,
    namespace_tree_sha256: '8d55ffadbbe0260aff12ad25e7b33c7434492376de27dcf68be1e81fc9256a02', namespace_entry_count: 2633 }),
  Object.freeze({ name: 'reset_receipt', required: true,
    key: 'scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260908T221109Z/execution.omar-system-purge.json',
    sha256: 'ef11b1fb98bb1115ae0416c5a7ba5a2f15edb5eddb420fa9a16a26c8be53d6e0', bytes: 5814 }),
  Object.freeze({ name: 'production_environment_manifest', required: true,
    key: 'scv-instagram-automation/recovery-points/20260908T221557Z/SCV_PRODUCTION_ENV_MANIFEST.json',
    sha256: '1e1dae021e5a31e339dfded166f002640abce8c8ad51429e8d650caa5f78330f', bytes: 19886 }),
  Object.freeze({ name: 'live_redteam_evidence', required: true,
    key: 'scv-instagram-automation/recovery-points/20260908T221557Z/SCV_LIVE_REDTEAM_EVIDENCE.json',
    sha256: '10f2b1bace8ab9ef86aadaf9c59f1643bef2924fe356367fd282562a41372687', bytes: 1243 }),
  Object.freeze({ name: 'final_production_readiness', required: true,
    key: 'scv-instagram-automation/recovery-points/20260908T221557Z/SCV_PRODUCTION_READINESS.json',
    sha256: '59f485b9aaa1da0b4bc16d08506de1a842da69a7911a18cdc3deba4406f15bb6', bytes: 1939 }),
  Object.freeze({ name: 'restore_tool', required: true,
    key: 'scv-instagram-automation/recovery-points/20260908T221557Z/restore-recovery-point.js',
    sha256: 'b03571cee66bbb7bf08bcecda38a6ba7657a0426e51b0f6c61337171f39883a3', bytes: 6317 }),
  Object.freeze({ name: 'owner_verified_state_capture', required: false,
    key: 'scv-instagram-automation/timestamped-snapshots/gold/20260908T221005Z/prod-v167-gold.tar.gz',
    sha256: '0afeceee3d477e332c3e768ff675911560aa61882152d03c0570a6f9ed5b1fb0', bytes: 4801333,
    namespace_tree_sha256: 'ea95946196f4dc6bebfa6a3a72e4b38c9224dc83780be9859ee684abe18284cf', namespace_entry_count: 2633 }),
  Object.freeze({ name: 'owner_verified_state_capture_receipt', required: false,
    key: 'scv-instagram-automation/timestamped-snapshots/gold/20260908T221005Z/execution.omar-system-gold-capture.json',
    sha256: 'f4d334ae2d92502fb79a6f9bada2d849b91fe6fe7d7015127474ac00a073d445', bytes: 2490 })
])

const TARGETS = Object.freeze([
  Object.freeze({
    name: 'production',
    mode: 'production',
    url: 'https://scv-dm-cloud-survival-production.up.railway.app/readyz'
  }),
  Object.freeze({
    name: 'staging',
    mode: 'staging',
    url: 'https://scv-stg-ab25da488a5a-golden-stg-ab25da488a5a.up.railway.app/readyz'
  })
])

function boundedNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : Number.POSITIVE_INFINITY
}

function evaluateEndpoint(target, status, body) {
  const reasons = []
  const check = (condition, reason) => { if (!condition) reasons.push(reason) }
  check(status === 200, 'http_status')
  check(body?.ok === true, 'readiness')
  check(body?.fail_close_active === false, 'fail_close')
  check(body?.preflight_verified === true, 'preflight')
  check(body?.release?.ok === true, 'release_gate')
  check(body?.release?.mode === target.mode, 'release_mode')
  check(body?.release?.release_phase === 'active', 'release_phase')
  check(body?.release?.phase_ready === true, 'release_phase_ready')
  check(body?.release?.release_id === RELEASE_ID, 'release_id')
  check(body?.release?.content_fingerprint_sha256 === CONTENT_FINGERPRINT, 'content_fingerprint')
  check(body?.release?.release_manifest_sha256 === RELEASE_MANIFEST, 'release_manifest')
  check(body?.drift?.critical_ok === true, 'critical_drift')
  check(Number(body?.drift?.critical_alert_count) === 0, 'critical_drift_alerts')
  check(boundedNumber(body?.drift?.age_ms) <= MAX_DRIFT_AGE_MS, 'drift_status_stale')
  check(body?.capability_canary?.required === true, 'capability_canary_required')
  check(body?.capability_canary?.ok === true, 'capability_canary')
  check(body?.capability_canary?.voice_ok === true, 'voice_capability')
  check(body?.capability_canary?.vision_ok === true, 'vision_capability')
  check(body?.capability_canary?.visible_model_ok === true, 'visible_model_capability')
  check(body?.capability_canary?.provider_model === VISIBLE_MODEL, 'provider_model')
  check(boundedNumber(body?.capability_canary?.age_ms) <= MAX_CANARY_AGE_MS, 'capability_canary_stale')
  check(body?.model_identity?.visible_model === VISIBLE_MODEL, 'visible_model_identity')
  check(body?.model_identity?.executor === 'openai_responses', 'visible_executor')
  check(body?.model_identity?.api === 'responses_v1', 'visible_api')
  check(body?.model_identity?.enforced === true, 'model_identity_enforcement')
  check(body?.model_identity?.contract_ok === true, 'model_identity_contract')
  check(body?.model_identity?.cross_model_fallback_allowed === false, 'cross_model_fallback')
  check(body?.behavior_contract?.ok === true, 'behavior_contract')
  check(Array.isArray(body?.behavior_contract?.failures) && body.behavior_contract.failures.length === 0,
    'behavior_contract_failures')
  return {
    ok: reasons.length === 0,
    name: target.name,
    mode: target.mode,
    http_status: status,
    release_id: String(body?.release?.release_id || ''),
    content_fingerprint_sha256: String(body?.release?.content_fingerprint_sha256 || ''),
    release_manifest_sha256: String(body?.release?.release_manifest_sha256 || ''),
    critical_drift_ok: body?.drift?.critical_ok === true,
    critical_alert_count: Number(body?.drift?.critical_alert_count || 0),
    operational_alert_count: Number(body?.drift?.operational_alert_count || 0),
    drift_age_ms: Number.isFinite(boundedNumber(body?.drift?.age_ms))
      ? boundedNumber(body?.drift?.age_ms) : null,
    capability_canary_ok: body?.capability_canary?.ok === true,
    voice_ok: body?.capability_canary?.voice_ok === true,
    vision_ok: body?.capability_canary?.vision_ok === true,
    visible_model_ok: body?.capability_canary?.visible_model_ok === true,
    provider_model: String(body?.capability_canary?.provider_model || ''),
    capability_age_ms: Number.isFinite(boundedNumber(body?.capability_canary?.age_ms))
      ? boundedNumber(body?.capability_canary?.age_ms) : null,
    fail_close_active: body?.fail_close_active === true,
    reasons
  }
}

async function checkTarget(target, fetchImpl = fetch) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(target.url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': SENTINEL_SCHEMA },
      // Cloudflare Workers implements edge-safe manual redirect handling. Any
      // redirect still fails the exact HTTP 200 gate in evaluateEndpoint.
      redirect: 'manual',
      signal: controller.signal
    })
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return { ok: false, name: target.name, mode: target.mode, http_status: response.status,
        reasons: ['response_too_large'] }
    }
    let body
    try { body = JSON.parse(text) } catch {
      return { ok: false, name: target.name, mode: target.mode, http_status: response.status,
        reasons: ['invalid_json'] }
    }
    return evaluateEndpoint(target, response.status, body)
  } catch (error) {
    const failure = {
      ok: false,
      name: target.name,
      mode: target.mode,
      http_status: 0,
      reasons: [error?.name === 'AbortError' ? 'request_timeout' : 'request_failed'],
      error_name: String(error?.name || 'Error').slice(0, 80),
      error_message: String(error?.message || error || 'request_failed').slice(0, 240)
    }
    console.error(JSON.stringify({ event: 'scv_sentinel_target_fetch_failed', ...failure }))
    return failure
  } finally {
    clearTimeout(timer)
  }
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readBoundedR2Object(archive, key, maxBytes = MAX_BODY_BYTES) {
  const object = await archive.get(key)
  if (!object) return { ok: false, reason: 'object_missing' }
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (bytes.byteLength > maxBytes) return { ok: false, reason: 'object_too_large' }
  return { ok: true, bytes }
}

async function readBoundedR2Json(archive, key, maxBytes = MAX_BODY_BYTES) {
  const result = await readBoundedR2Object(archive, key, maxBytes)
  if (!result.ok) return result
  try {
    return { ...result, value: JSON.parse(new TextDecoder().decode(result.bytes)) }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}

async function verifyPinnedObject(archive, expected, options = {}) {
  const hashImpl = options.hashImpl || sha256
  const result = await readBoundedR2Object(
    archive,
    expected.key,
    options.maxBytes || MAX_RECOVERY_COMPONENT_BYTES
  )
  if (!result.ok) return { ok: false, reason: result.reason, key: expected.key }
  if (result.bytes.byteLength !== expected.bytes) {
    return { ok: false, reason: 'byte_count', key: expected.key, actual_bytes: result.bytes.byteLength }
  }
  const actualSha256 = await hashImpl(result.bytes, expected.key)
  if (actualSha256 !== expected.sha256) {
    return { ok: false, reason: 'sha256', key: expected.key, actual_sha256: actualSha256 }
  }
  return { ok: true, key: expected.key, bytes: result.bytes.byteLength, sha256: actualSha256 }
}

async function checkRecoveryPoint(archive, options = {}) {
  const hashImpl = options.hashImpl || sha256
  const verifyObject = options.verifyObject || ((expected) => verifyPinnedObject(archive, expected, { hashImpl }))
  const reasons = []
  const check = (condition, reason) => { if (!condition) reasons.push(reason) }
  try {
    const latestResult = await readBoundedR2Json(archive, RECOVERY_LATEST_KEY)
    if (!latestResult.ok) {
      return { ok: false, reasons: [`recovery_latest_${latestResult.reason}`] }
    }
    const latest = latestResult.value
    check(latest?.bucket === 'omar-private-archive', 'recovery_bucket')
    check(latest?.golden_snapshot_id === GOLDEN_SNAPSHOT_ID, 'golden_snapshot_id')
    check(latest?.golden_preserved_separately === true, 'golden_not_separate')
    check(latest?.current_recovery_point_id === CURRENT_RECOVERY_POINT_ID, 'current_recovery_point_id')
    check(latest?.current_recovery_point?.key === CURRENT_RECOVERY_POINT_KEY, 'current_recovery_point_key')
    check(latest?.current_recovery_point?.sha256 === CURRENT_RECOVERY_POINT_SHA256,
      'current_recovery_point_pointer_hash')
    check(latest?.previous_recovery_point_id === PREVIOUS_RECOVERY_POINT_ID, 'previous_recovery_point_id')
    check(latest?.catalog?.key === RECOVERY_CATALOG_KEY, 'recovery_catalog_key')
    check(latest?.catalog?.sha256 === RECOVERY_CATALOG_SHA256, 'recovery_catalog_pointer_hash')
    check(latest?.restore_tool?.key === RESTORE_TOOL_KEY, 'restore_tool_key')
    check(latest?.restore_tool?.sha256 === RESTORE_TOOL_SHA256, 'restore_tool_pointer_hash')
    check(latest?.approved_gold?.gold_id === APPROVED_RECOVERY_GOLD_ID, 'approved_recovery_gold_id')
    check(latest?.approved_gold?.record_key === APPROVED_RECOVERY_GOLD_RECORD_KEY, 'approved_recovery_gold_record_key')
    check(latest?.approved_gold?.record_sha256 === APPROVED_RECOVERY_GOLD_RECORD_SHA256, 'approved_recovery_gold_record_hash')
    check(latest?.restore_requires_exact_recovery_point_id === true, 'recovery_exact_id_required')
    check(latest?.production_cutover_automatic === false, 'recovery_automatic_cutover')
    check(latest?.private_r2_only === true, 'recovery_private_r2')

    const catalogResult = await readBoundedR2Json(archive, RECOVERY_CATALOG_KEY)
    let catalog = null
    if (!catalogResult.ok) {
      reasons.push(`recovery_catalog_${catalogResult.reason}`)
    } else {
      catalog = catalogResult.value
      check(await hashImpl(catalogResult.bytes, RECOVERY_CATALOG_KEY) === RECOVERY_CATALOG_SHA256,
        'recovery_catalog_object_hash')
      check(catalog?.current_recovery_point_id === CURRENT_RECOVERY_POINT_ID,
        'recovery_catalog_current')
      check(catalog?.golden_reference?.snapshot_id === GOLDEN_SNAPSHOT_ID, 'recovery_catalog_golden')
      check(catalog?.golden_reference?.key === APRIL_GOLDEN_KEY, 'recovery_catalog_golden_key')
      check(catalog?.golden_reference?.sha256 === APRIL_GOLDEN_SHA256, 'recovery_catalog_golden_hash')
      check(Number(catalog?.golden_reference?.bytes) === APRIL_GOLDEN_BYTES,
        'recovery_catalog_golden_bytes')
      check(catalog?.golden_reference?.preserved_separately_from_current === true,
        'recovery_catalog_golden_not_separate')
      check(catalog?.restore_requires_exact_recovery_point_id === true,
        'recovery_catalog_exact_id_required')
      check(catalog?.production_cutover_automatic === false, 'recovery_catalog_automatic_cutover')
      const previous = Array.isArray(catalog?.recovery_points)
        ? catalog.recovery_points.find((point) => point?.recovery_point_id === PREVIOUS_RECOVERY_POINT_ID)
        : null
      const current = Array.isArray(catalog?.recovery_points)
        ? catalog.recovery_points.find((point) => point?.recovery_point_id === CURRENT_RECOVERY_POINT_ID)
        : null
      check(previous?.key === PREVIOUS_RECOVERY_POINT_KEY, 'recovery_catalog_previous_key')
      check(previous?.sha256 === PREVIOUS_RECOVERY_POINT_SHA256, 'recovery_catalog_previous_hash')
      check(previous?.current === false, 'recovery_catalog_previous_not_historical')
      check(previous?.staged_restore_verified === true, 'recovery_catalog_previous_restore')
      check(current?.key === CURRENT_RECOVERY_POINT_KEY, 'recovery_catalog_current_key')
      check(current?.sha256 === CURRENT_RECOVERY_POINT_SHA256, 'recovery_catalog_current_hash')
      check(current?.current === true, 'recovery_catalog_current_flag')
      check(current?.staged_restore_verified === true, 'recovery_catalog_current_restore')
      check(Number(current?.live_redteam_cases_passed) === 1, 'recovery_catalog_redteam')
      check(current?.approved_gold_id === APPROVED_RECOVERY_GOLD_ID, 'recovery_catalog_approved_gold_id')
      check(current?.gold_record_key === APPROVED_RECOVERY_GOLD_RECORD_KEY, 'recovery_catalog_gold_record_key')
      check(current?.gold_record_sha256 === APPROVED_RECOVERY_GOLD_RECORD_SHA256, 'recovery_catalog_gold_record_hash')
    }

    const pointResult = await readBoundedR2Json(archive, CURRENT_RECOVERY_POINT_KEY)
    let point = null
    if (!pointResult.ok) {
      reasons.push(`current_recovery_point_${pointResult.reason}`)
    } else {
      point = pointResult.value
      check(await hashImpl(pointResult.bytes, CURRENT_RECOVERY_POINT_KEY) === CURRENT_RECOVERY_POINT_SHA256,
        'current_recovery_point_object_hash')
      check(point?.recovery_point_id === CURRENT_RECOVERY_POINT_ID, 'recovery_point_identity')
      check(point?.immutable === true && point?.current_at_capture === true, 'recovery_point_immutability')
      check(point?.release?.release_id === RECOVERY_POINT_RELEASE_ID, 'recovery_point_release')
      check(point?.release?.content_fingerprint_sha256 === RECOVERY_POINT_CONTENT_FINGERPRINT,
        'recovery_point_fingerprint')
      check(point?.release?.release_manifest_sha256 === RECOVERY_POINT_RELEASE_MANIFEST,
        'recovery_point_manifest')
      check(point?.capture_evidence?.full_local_test_exit_zero === true, 'recovery_point_local_tests')
      check(point?.capture_evidence?.staging_isolated_full_test_exit_zero === true,
        'recovery_point_staging_tests')
      check(Number(point?.capture_evidence?.live_redteam_semantic_passed) === 1,
        'recovery_point_redteam')
      check(Number(point?.capture_evidence?.paused_worker_count) === 10,
        'recovery_point_worker_barrier')
      check(Number(point?.capture_evidence?.post_reset_omar_system_residual_count) === 0,
        'recovery_point_zero_residual')
      check(point?.capture_evidence?.r2_component_readback_byte_identical === true,
        'recovery_point_r2_readback')
      check(point?.capture_evidence?.final_production_ok === true, 'recovery_point_production_ready')
      check(point?.capture_evidence?.final_fail_close_active === false,
        'recovery_point_fail_close')
      check(point?.secret_recovery?.values_in_manifest === false, 'recovery_point_secret_values')
      check(point?.restore_conditions?.r2_only_self_contained === false,
        'recovery_point_external_dependencies_claim')
      const components = new Map(
        Array.isArray(point?.components) ? point.components.map((component) => [component?.name, component]) : []
      )
      for (const expected of EXPECTED_RECOVERY_COMPONENTS) {
        const actual = components.get(expected.name)
        check(actual?.key === expected.key, `recovery_component_${expected.name}_key`)
        check(actual?.sha256 === expected.sha256, `recovery_component_${expected.name}_hash`)
        check(Number(actual?.bytes) === expected.bytes, `recovery_component_${expected.name}_bytes`)
        check(actual?.required === expected.required, `recovery_component_${expected.name}_required`)
        if ('namespace_tree_sha256' in expected) {
          check(actual?.namespace_tree_sha256 === expected.namespace_tree_sha256,
            `recovery_component_${expected.name}_tree`)
          check(Number(actual?.namespace_entry_count) === expected.namespace_entry_count,
            `recovery_component_${expected.name}_entries`)
        }
      }
    }

    const pinnedObjects = [
      ...EXPECTED_RECOVERY_COMPONENTS,
      { key: PREVIOUS_RECOVERY_POINT_KEY, sha256: PREVIOUS_RECOVERY_POINT_SHA256, bytes: 5725 },
      { key: APRIL_GOLDEN_KEY, sha256: APRIL_GOLDEN_SHA256, bytes: APRIL_GOLDEN_BYTES },
      { key: APPROVED_RECOVERY_GOLD_RECORD_KEY, sha256: APPROVED_RECOVERY_GOLD_RECORD_SHA256, bytes: APPROVED_RECOVERY_GOLD_RECORD_BYTES },
      { key: APPROVED_RECOVERY_EXTENSION_KEY, sha256: APPROVED_RECOVERY_EXTENSION_SHA256, bytes: APPROVED_RECOVERY_EXTENSION_BYTES }
    ]
    const objectChecks = await Promise.all(pinnedObjects.map((expected) => verifyObject(expected)))
    for (const result of objectChecks) {
      if (!result.ok) reasons.push(`recovery_object_${result.reason}:${result.key}`)
    }
    return {
      ok: reasons.length === 0,
      current_recovery_point_id: String(latest?.current_recovery_point_id || ''),
      previous_recovery_point_id: String(latest?.previous_recovery_point_id || ''),
      golden_snapshot_id: String(latest?.golden_snapshot_id || ''),
      recovery_point_sha256: String(latest?.current_recovery_point?.sha256 || ''),
      catalog_sha256: String(latest?.catalog?.sha256 || ''),
      pinned_object_count: pinnedObjects.length,
      pinned_objects_verified: objectChecks.filter((result) => result.ok).length,
      reasons
    }
  } catch (error) {
    return {
      ok: false,
      reasons: ['recovery_point_check_failed'],
      error_name: String(error?.name || 'Error').slice(0, 80),
      error_message: String(error?.message || error || 'recovery_point_check_failed').slice(0, 240)
    }
  }
}

async function readState(archive) {
  try {
    const object = await archive.get(`${PREFIX}/STATE.json`)
    return object ? await object.json() : null
  } catch {
    return null
  }
}

async function checkGold(archive, options = {}) {
  const hashImpl = options.hashImpl || sha256
  const reasons = []
  const check = (condition, reason) => { if (!condition) reasons.push(reason) }
  try {
    const latestResult = await readBoundedR2Json(archive, GOLD_LATEST_KEY)
    if (!latestResult.ok) return { ok: false, reasons: [`gold_latest_${latestResult.reason}`] }
    const latest = latestResult.value
    check(latest?.manifest?.key === GOLD_MANIFEST_KEY, 'gold_manifest_key')
    check(latest?.manifest?.sha256 === GOLD_MANIFEST_SHA256, 'gold_manifest_pointer_hash')
    const object = await archive.get(GOLD_MANIFEST_KEY)
    if (!object) return { ok: false, reasons: [...reasons, 'gold_manifest_missing'] }
    const bytes = new Uint8Array(await object.arrayBuffer())
    if (bytes.byteLength > MAX_BODY_BYTES) return { ok: false, reasons: [...reasons, 'gold_manifest_object_too_large'] }
    const actual = await hashImpl(bytes)
    check(actual === GOLD_MANIFEST_SHA256, 'gold_manifest_object_hash')
    let manifest = null
    try { manifest = JSON.parse(new TextDecoder().decode(bytes)) } catch { reasons.push('gold_manifest_invalid_json') }
    check(manifest?.release?.content_fingerprint_sha256 === GOLD_CONTENT_FINGERPRINT, 'gold_manifest_release_fingerprint')
    check(manifest?.release?.release_id === GOLD_RELEASE_ID, 'gold_manifest_release_id')
    return { ok: reasons.length === 0, reasons, manifest_sha256: actual, gold_name: String(manifest?.gold_name || '') }
  } catch (error) {
    return { ok: false, reasons: [...reasons, `gold_check_error:${String(error && error.message ? error.message : error).slice(0, 80)}`] }
  }
}

async function runSentinel(env, options = {}) {
  const checkedAt = new Date(options.now || Date.now()).toISOString()
  const [checks, recoveryPoint, gold] = await Promise.all([
    Promise.all(TARGETS.map((target) => checkTarget(target, options.fetchImpl || fetch))),
    checkRecoveryPoint(env.ARCHIVE),
    checkGold(env.ARCHIVE)
  ])
  const ok = checks.every((check) => check.ok === true) && recoveryPoint.ok === true && gold.ok === true
  const previous = await readState(env.ARCHIVE)
  const consecutiveFailures = ok ? 0 : Number(previous?.consecutive_failures || 0) + 1
  const receipt = {
    schema: SENTINEL_SCHEMA,
    ok,
    checked_at_utc: checkedAt,
    trigger: String(options.trigger || 'scheduled'),
    expected_release: {
      release_id: RELEASE_ID,
      content_fingerprint_sha256: CONTENT_FINGERPRINT,
      release_manifest_sha256: RELEASE_MANIFEST,
      visible_model: VISIBLE_MODEL
    },
    expected_recovery: {
      current_recovery_point_id: CURRENT_RECOVERY_POINT_ID,
      current_recovery_point_sha256: CURRENT_RECOVERY_POINT_SHA256,
      previous_recovery_point_id: PREVIOUS_RECOVERY_POINT_ID,
      golden_snapshot_id: GOLDEN_SNAPSHOT_ID,
      catalog_sha256: RECOVERY_CATALOG_SHA256,
      approved_recovery_gold_id: APPROVED_RECOVERY_GOLD_ID,
      approved_recovery_gold_record_sha256: APPROVED_RECOVERY_GOLD_RECORD_SHA256
    },
    checks,
    recovery_point: recoveryPoint,
    gold: { ...gold, expected_manifest_key: GOLD_MANIFEST_KEY, expected_manifest_sha256: GOLD_MANIFEST_SHA256, expected_release_id: GOLD_RELEASE_ID, expected_content_fingerprint_sha256: GOLD_CONTENT_FINGERPRINT },
    consecutive_failures: consecutiveFailures,
    contains_credentials: false,
    contains_customer_message_content: false
  }
  const bytes = new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`)
  const receiptSha256 = await sha256(bytes)
  const compact = checkedAt.replace(/[-:.]/g, '')
  const day = checkedAt.slice(0, 10)
  const key = `${PREFIX}/${day}/${compact}.json`
  await env.ARCHIVE.put(key, bytes, { httpMetadata: { contentType: 'application/json' } })
  const state = {
    schema: `${SENTINEL_SCHEMA}-state`,
    updated_at_utc: checkedAt,
    ok,
    consecutive_failures: consecutiveFailures,
    latest_attestation_key: key,
    latest_attestation_sha256: receiptSha256
  }
  await env.ARCHIVE.put(`${PREFIX}/STATE.json`, `${JSON.stringify(state, null, 2)}\n`, {
    httpMetadata: { contentType: 'application/json' }
  })
  const latest = {
    schema: `${SENTINEL_SCHEMA}-pointer`,
    updated_at_utc: checkedAt,
    ok,
    consecutive_failures: consecutiveFailures,
    attestation: { bucket: 'omar-private-archive', key, sha256: receiptSha256 },
    expected_release: receipt.expected_release,
    expected_recovery: receipt.expected_recovery
  }
  await env.ARCHIVE.put(`${PREFIX}/LATEST.json`, `${JSON.stringify(latest, null, 2)}\n`, {
    httpMetadata: { contentType: 'application/json' }
  })
  return receipt
}

function json(value, status = 200) {
  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.pathname !== '/health') {
      return json({ ok: false, error: 'not_found' }, 404)
    }
    const latestObject = await env.ARCHIVE.get(`${PREFIX}/LATEST.json`)
    const latest = latestObject ? await latestObject.json() : null
    const expectedReleaseMatches = latest?.expected_release?.release_id === RELEASE_ID &&
      latest?.expected_release?.content_fingerprint_sha256 === CONTENT_FINGERPRINT &&
      latest?.expected_release?.release_manifest_sha256 === RELEASE_MANIFEST
    const expectedRecoveryMatches =
      latest?.expected_recovery?.current_recovery_point_id === CURRENT_RECOVERY_POINT_ID &&
      latest?.expected_recovery?.current_recovery_point_sha256 === CURRENT_RECOVERY_POINT_SHA256 &&
      latest?.expected_recovery?.previous_recovery_point_id === PREVIOUS_RECOVERY_POINT_ID &&
      latest?.expected_recovery?.golden_snapshot_id === GOLDEN_SNAPSHOT_ID &&
      latest?.expected_recovery?.catalog_sha256 === RECOVERY_CATALOG_SHA256 &&
      latest?.expected_recovery?.approved_recovery_gold_id === APPROVED_RECOVERY_GOLD_ID &&
      latest?.expected_recovery?.approved_recovery_gold_record_sha256 === APPROVED_RECOVERY_GOLD_RECORD_SHA256
    const healthy = latest?.ok === true && expectedReleaseMatches && expectedRecoveryMatches
    return json({
      ok: healthy,
      schema: SENTINEL_SCHEMA,
      schedule: 'every_5_minutes',
      latest: latest ? {
        updated_at_utc: String(latest.updated_at_utc || ''),
        ok: latest.ok === true,
        consecutive_failures: Number(latest.consecutive_failures || 0),
        attestation_sha256: String(latest.attestation?.sha256 || '')
      } : null,
      expected_release: {
        release_id: RELEASE_ID,
        content_fingerprint_sha256: CONTENT_FINGERPRINT,
        release_manifest_sha256: RELEASE_MANIFEST
      },
      expected_recovery: {
        current_recovery_point_id: CURRENT_RECOVERY_POINT_ID,
        current_recovery_point_sha256: CURRENT_RECOVERY_POINT_SHA256,
        previous_recovery_point_id: PREVIOUS_RECOVERY_POINT_ID,
        golden_snapshot_id: GOLDEN_SNAPSHOT_ID,
        catalog_sha256: RECOVERY_CATALOG_SHA256,
        approved_recovery_gold_id: APPROVED_RECOVERY_GOLD_ID,
        approved_recovery_gold_record_sha256: APPROVED_RECOVERY_GOLD_RECORD_SHA256
      }
    }, healthy ? 200 : 503)
  },

  async scheduled(controller, env) {
    const receipt = await runSentinel(env, {
      trigger: 'scheduled',
      now: controller?.scheduledTime || Date.now()
    })
    if (!receipt.ok) throw new Error('scv_instagram_drift_sentinel_failed')
  }
}

export {
  GOLD_LATEST_KEY,
  GOLD_MANIFEST_KEY,
  GOLD_MANIFEST_SHA256,
  GOLD_RELEASE_ID,
  GOLD_CONTENT_FINGERPRINT,
  checkGold,
  APRIL_GOLDEN_KEY,
  APRIL_GOLDEN_SHA256,
  CURRENT_RECOVERY_POINT_ID,
  CURRENT_RECOVERY_POINT_KEY,
  CURRENT_RECOVERY_POINT_SHA256,
  EXPECTED_RECOVERY_COMPONENTS,
  PRE_RESET_AUDIT_REMAINING_COUNT,
  CONTENT_FINGERPRINT,
  GOLDEN_SNAPSHOT_ID,
  MAX_CANARY_AGE_MS,
  MAX_DRIFT_AGE_MS,
  RELEASE_ID,
  RELEASE_MANIFEST,
  RECOVERY_POINT_RELEASE_ID,
  RECOVERY_POINT_CONTENT_FINGERPRINT,
  RECOVERY_POINT_RELEASE_MANIFEST,
  PREVIOUS_RECOVERY_POINT_ID,
  PREVIOUS_RECOVERY_POINT_KEY,
  PREVIOUS_RECOVERY_POINT_SHA256,
  RECOVERY_CATALOG_KEY,
  RECOVERY_CATALOG_SHA256,
  RECOVERY_LATEST_KEY,
  RESET_RECEIPT_SHA256,
  RESTORE_TOOL_KEY,
  RESTORE_TOOL_SHA256,
  SENTINEL_SCHEMA,
  VISIBLE_MODEL,
  checkRecoveryPoint,
  evaluateEndpoint,
  runSentinel,
  verifyPinnedObject
}
