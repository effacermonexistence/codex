const SENTINEL_SCHEMA = 'scv-instagram-drift-sentinel-2026-09-05-v15-v152-running-release-v151-recovery-gold'
// GOLD-3 (2026-09-03): v148 (owner-verified v145 plus the owner-ordered polish, live red-team verified) frozen as the reference; the pointer and manifest below are pinned by hash.
const GOLD_LATEST_KEY = 'scv-instagram-automation/gold/LATEST.json'
const GOLD_MANIFEST_KEY = 'scv-instagram-automation/gold/SCV_GOLD_MANIFEST_v148.json'
const GOLD_MANIFEST_SHA256 = '31ea4507381e6ec2c3ce4458d70af4a311f331a4a26651f5d9234a01312766cc'
// The frozen gold is a REFERENCE, not necessarily the running release: later releases shipped fixes,
// so the gold pointer deliberately still describes v148.
// Comparing the gold manifest against the running release id made the check fail by construction.
const GOLD_RELEASE_ID = 'scv-instagram-single-20260902-v148'
const GOLD_CONTENT_FINGERPRINT = '3a9a18631443f4738d13dd803f080979ff4d21ab0d9de1f5054b2f26e2ea3609'
// v15 (2026-09-05): the RUNNING release (v152, the owner's first experiment-round fix) and the
// latest RECOVERY POINT (the owner-approved v151 Gold) are different objects; the recovery-point
// checks below pin the Gold's own release identity.
const RELEASE_ID = 'scv-instagram-single-20260905-v152'
const CONTENT_FINGERPRINT = '46d222d1c413b518078aec1b05b36f92979355814623cfacbf5aedd429583a67'
const RELEASE_MANIFEST = '95365181be58a0edc10517a861534cab877ea8d03581a970552e20835ac91fa1'
const RECOVERY_POINT_RELEASE_ID = 'scv-instagram-single-20260904-v151'
const RECOVERY_POINT_CONTENT_FINGERPRINT = 'd60dfc9f1f082f9d5e268556c0eb43364b5f1d9b1217f6a1f95d04546043c151'
const RECOVERY_POINT_RELEASE_MANIFEST = 'b307c86bb59e1287afe746f50d8ccd036d7b1bea70820ef3f1facce6baef7d6c'
const VISIBLE_MODEL = 'gpt-5.4-mini-2026-03-17'
const RECOVERY_LATEST_KEY = 'scv-instagram-automation/recovery-points/LATEST.json'
const RECOVERY_CATALOG_KEY = 'scv-instagram-automation/recovery-points/catalogs/20260904T223113Z/RECOVERY_POINT_CATALOG.json'
const RECOVERY_CATALOG_SHA256 = '97129fd50a26fc87d9f47d203a1c37f195417174e9cafa10c6147052637395b8'
const CURRENT_RECOVERY_POINT_ID = 'scv-instagram-20260904T222549Z-v151-clean-current'
const CURRENT_RECOVERY_POINT_KEY = 'scv-instagram-automation/recovery-points/20260904T222549Z/SCV_RECOVERY_POINT.json'
const CURRENT_RECOVERY_POINT_SHA256 = '75440f5063fb7deab879df404ea8fa7011fece7c3da1f7af93c042ee9a337a5a'
const PREVIOUS_RECOVERY_POINT_ID = 'scv-instagram-20260904T210539Z-v150-clean-current-before-v151'
const PREVIOUS_RECOVERY_POINT_KEY = 'scv-instagram-automation/recovery-points/20260904T210539Z/SCV_RECOVERY_POINT.json'
const PREVIOUS_RECOVERY_POINT_SHA256 = '4d4274e7ac9393313ef77662116e076d85bbe0b98e70ab26bb97df7dba9b23da'
const RESTORE_TOOL_KEY = 'scv-instagram-automation/recovery-points/20260904T222549Z/restore-recovery-point.js'
const RESTORE_TOOL_SHA256 = 'b03571cee66bbb7bf08bcecda38a6ba7657a0426e51b0f6c61337171f39883a3'
const GOLDEN_SNAPSHOT_ID = 'scv-instagram-20260420T152810-local-origin'
const APRIL_GOLDEN_KEY = 'scv-instagram-automation/timestamped-snapshots/2026-04-20/20260420T152810-local/origin-snapshot.tar.gz'
const APRIL_GOLDEN_SHA256 = '1e5225d4d494e55cefec5ee0a58be61e92eeccab6e2d3ea9d1d0f02ccdceba98'
const APRIL_GOLDEN_BYTES = 40715
const RESET_RECEIPT_SHA256 = '1d812f0a4e052a4edb9661a78b87e9ceb2e4dad5e1d7bd54af7f128454f1567f'
const PRE_RESET_AUDIT_REMAINING_COUNT = 33
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
    key: 'scv-instagram-automation/release-ready/20260904T221512Z/v151/scv-instagram-single-20260904T221512Z-v151-liveness-and-recoverability.tar.gz',
    sha256: '5b70ce46742e342a855152734be267ad5b98807918c68c174eddf024ee467fdd', bytes: 1409301 }),
  Object.freeze({ name: 'release_manifest', required: true,
    key: 'scv-instagram-automation/recovery-points/20260904T222549Z/SCV_SINGLE_RELEASE.json',
    sha256: RECOVERY_POINT_RELEASE_MANIFEST, bytes: 44201 }),
  Object.freeze({ name: 'production_state', required: true,
    key: 'scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260904T222549Z/post-reset/prod-v151.tar.gz',
    sha256: '493382b7c383ffe0c7ad17a7d09a17b4b9095f1baca0eeeebd83e1949da322bb', bytes: 4044415,
    namespace_tree_sha256: '336e513903a4b12022885e798d415250b8dd9da91cad7b0296ab6f59a9351e62', namespace_entry_count: 2128 }),
  Object.freeze({ name: 'pre_reset_production_state', required: false,
    key: 'scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260904T222549Z/pre-reset/prod-v151.tar.gz',
    sha256: 'a6f6c51ea077b5117d06aeb75ec67814fb910c728b8b9d5cf03efd7ac04efb2a', bytes: 4231470,
    namespace_tree_sha256: '2d720d7f58bc49e117ec98dc83afd4da0ba62f134c42d169c528c2c24027bca3', namespace_entry_count: 2161 }),
  Object.freeze({ name: 'reset_receipt', required: true,
    key: 'scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260904T222549Z/execution.omar-system-purge.json',
    sha256: RESET_RECEIPT_SHA256, bytes: 6552 }),
  Object.freeze({ name: 'production_environment_manifest', required: true,
    key: 'scv-instagram-automation/recovery-points/20260904T222549Z/SCV_PRODUCTION_ENV_MANIFEST.json',
    sha256: 'd89775731a4f32fdeba734f64bb28604e3d9a794863837fbcab749fa936f3b03', bytes: 19886 }),
  Object.freeze({ name: 'live_redteam_evidence', required: true,
    key: 'scv-instagram-automation/recovery-points/20260904T222549Z/SCV_LIVE_REDTEAM_EVIDENCE.json',
    sha256: 'f9cf1288bb7a8737a30523fd81869d91532d6fdea3bbc4d73bfa454078ec78a9', bytes: 13937 }),
  Object.freeze({ name: 'final_production_readiness', required: true,
    key: 'scv-instagram-automation/recovery-points/20260904T222549Z/SCV_PRODUCTION_READINESS.json',
    sha256: '1b658be94aa21ec57713ca9870d7316bdfb3fe37215398b6090aa1c9ccfcd0af', bytes: 1938 }),
  Object.freeze({ name: 'restore_tool', required: true,
    key: RESTORE_TOOL_KEY, sha256: RESTORE_TOOL_SHA256, bytes: 6317 })
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
      check(Number(current?.live_redteam_cases_passed) === 18, 'recovery_catalog_redteam')
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
      check(Number(point?.capture_evidence?.live_redteam_semantic_passed) === 18,
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
      { key: PREVIOUS_RECOVERY_POINT_KEY, sha256: PREVIOUS_RECOVERY_POINT_SHA256, bytes: 4188 },
      { key: APRIL_GOLDEN_KEY, sha256: APRIL_GOLDEN_SHA256, bytes: APRIL_GOLDEN_BYTES }
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
      catalog_sha256: RECOVERY_CATALOG_SHA256
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
      latest?.expected_recovery?.catalog_sha256 === RECOVERY_CATALOG_SHA256
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
        catalog_sha256: RECOVERY_CATALOG_SHA256
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
