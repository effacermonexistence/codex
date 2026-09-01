const SENTINEL_SCHEMA = 'scv-instagram-drift-sentinel-2026-08-31-v1'
const RELEASE_ID = 'scv-instagram-single-20260901-v130'
const CONTENT_FINGERPRINT = '21fd9e5f430e54236d00495b823686b9a0a042944d86211b6e701d5aee852b59'
const RELEASE_MANIFEST = '7ed809bd67c32f5a479a467e0a8acf4e99baf396de9d9e6087805d794c43f2f5'
const VISIBLE_MODEL = 'gpt-5.4-mini-2026-03-17'
const SNAPSHOT_CONTROL_VERSION = '20260901T082132Z'
const SNAPSHOT_COUNT = 19
const GOLDEN_SNAPSHOT_ID = 'scv-instagram-20260420T152810-local-origin'
const CURRENT_SNAPSHOT_ID = 'scv-instagram-20260901T081724Z-v130-post-omar-reset-current'
const SNAPSHOT_CATALOG_SHA256 = '67749b5bd4fd5ebe8ef44e53e360799abc13ee35eef879faf680dc854b06aa5f'
const SNAPSHOT_SEAL_SHA256 = 'e22fe4c7bcf02a489263c00fa77529837e5f47b124336108099742d8e608fe10'
const SNAPSHOT_RESTORE_TOOL_SHA256 = '4044f96616a504c9049657fbe628b63246b56a626fa57cdb5f67dc1307d3f206'
const MAX_CANARY_AGE_MS = 90 * 60 * 1000
const MAX_DRIFT_AGE_MS = 3 * 60 * 1000
const FETCH_TIMEOUT_MS = 20_000
const MAX_BODY_BYTES = 64 * 1024
const PREFIX = 'scv-instagram-automation/drift-attestations'
const SNAPSHOT_LATEST_KEY = 'scv-instagram-automation/timestamped-snapshots/LATEST.json'

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

async function readBoundedR2Json(archive, key) {
  const object = await archive.get(key)
  if (!object) return { ok: false, reason: 'object_missing' }
  const bytes = new Uint8Array(await object.arrayBuffer())
  if (bytes.byteLength > MAX_BODY_BYTES) return { ok: false, reason: 'object_too_large' }
  try {
    return { ok: true, bytes, value: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}

async function checkSnapshotControl(archive, options = {}) {
  const hashImpl = options.hashImpl || sha256
  const reasons = []
  const check = (condition, reason) => { if (!condition) reasons.push(reason) }
  try {
    const latestResult = await readBoundedR2Json(archive, SNAPSHOT_LATEST_KEY)
    if (!latestResult.ok) {
      return { ok: false, reasons: [`snapshot_latest_${latestResult.reason}`] }
    }
    const latest = latestResult.value
    const expectedPrefix = `scv-instagram-automation/timestamped-snapshots/control/${SNAPSHOT_CONTROL_VERSION}`
    check(latest?.control_version === SNAPSHOT_CONTROL_VERSION, 'snapshot_control_version')
    check(Number(latest?.snapshot_count) === SNAPSHOT_COUNT, 'snapshot_count')
    check(latest?.golden_snapshot_id === GOLDEN_SNAPSHOT_ID, 'golden_snapshot_id')
    check(latest?.current_snapshot_id === CURRENT_SNAPSHOT_ID, 'current_snapshot_id')
    check(latest?.catalog?.key === `${expectedPrefix}/SCV_TIMESTAMPED_SNAPSHOT_CATALOG.json`, 'snapshot_catalog_key')
    check(latest?.catalog?.sha256 === SNAPSHOT_CATALOG_SHA256, 'snapshot_catalog_pointer_hash')
    check(latest?.seal?.key === `${expectedPrefix}/SCV_TIMESTAMPED_SNAPSHOT_CATALOG_SEAL.json`, 'snapshot_seal_key')
    check(latest?.seal?.sha256 === SNAPSHOT_SEAL_SHA256, 'snapshot_seal_pointer_hash')
    check(latest?.restore_tool?.key === `${expectedPrefix}/scv-timestamped-restore.js`, 'snapshot_restore_tool_key')
    check(latest?.restore_tool?.sha256 === SNAPSHOT_RESTORE_TOOL_SHA256, 'snapshot_restore_tool_pointer_hash')
    check(latest?.restore_requires_exact_snapshot_id === true, 'snapshot_exact_id_required')
    check(latest?.production_cutover_automatic === false, 'snapshot_automatic_cutover')
    check(latest?.private_r2_only === true, 'snapshot_private_r2')

    if (typeof latest?.catalog?.key === 'string') {
      const catalogResult = await readBoundedR2Json(archive, latest.catalog.key)
      if (!catalogResult.ok) {
        reasons.push(`snapshot_catalog_${catalogResult.reason}`)
      } else {
        const catalog = catalogResult.value
        check(await hashImpl(catalogResult.bytes) === SNAPSHOT_CATALOG_SHA256, 'snapshot_catalog_object_hash')
        check(Number(catalog?.snapshot_count) === SNAPSHOT_COUNT, 'snapshot_catalog_count')
        check(catalog?.named_pointers?.golden === GOLDEN_SNAPSHOT_ID, 'snapshot_catalog_golden')
        check(catalog?.named_pointers?.current === CURRENT_SNAPSHOT_ID, 'snapshot_catalog_current')
        check(catalog?.named_pointers?.golden !== catalog?.named_pointers?.current, 'snapshot_catalog_distinct')
      }
    }
    return {
      ok: reasons.length === 0,
      control_version: String(latest?.control_version || ''),
      snapshot_count: Number(latest?.snapshot_count || 0),
      golden_snapshot_id: String(latest?.golden_snapshot_id || ''),
      current_snapshot_id: String(latest?.current_snapshot_id || ''),
      catalog_sha256: String(latest?.catalog?.sha256 || ''),
      reasons
    }
  } catch (error) {
    return {
      ok: false,
      reasons: ['snapshot_control_read_failed'],
      error_name: String(error?.name || 'Error').slice(0, 80),
      error_message: String(error?.message || error || 'snapshot_control_read_failed').slice(0, 240)
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

async function runSentinel(env, options = {}) {
  const checkedAt = new Date(options.now || Date.now()).toISOString()
  const [checks, snapshotControl] = await Promise.all([
    Promise.all(TARGETS.map((target) => checkTarget(target, options.fetchImpl || fetch))),
    checkSnapshotControl(env.ARCHIVE)
  ])
  const ok = checks.every((check) => check.ok === true) && snapshotControl.ok === true
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
    expected_snapshot: {
      control_version: SNAPSHOT_CONTROL_VERSION,
      snapshot_count: SNAPSHOT_COUNT,
      golden_snapshot_id: GOLDEN_SNAPSHOT_ID,
      current_snapshot_id: CURRENT_SNAPSHOT_ID,
      catalog_sha256: SNAPSHOT_CATALOG_SHA256
    },
    checks,
    snapshot_control: snapshotControl,
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
    expected_snapshot: receipt.expected_snapshot
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
    const expectedSnapshotMatches = latest?.expected_snapshot?.control_version === SNAPSHOT_CONTROL_VERSION &&
      Number(latest?.expected_snapshot?.snapshot_count) === SNAPSHOT_COUNT &&
      latest?.expected_snapshot?.golden_snapshot_id === GOLDEN_SNAPSHOT_ID &&
      latest?.expected_snapshot?.current_snapshot_id === CURRENT_SNAPSHOT_ID &&
      latest?.expected_snapshot?.catalog_sha256 === SNAPSHOT_CATALOG_SHA256
    const healthy = latest?.ok === true && expectedReleaseMatches && expectedSnapshotMatches
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
      expected_snapshot: {
        control_version: SNAPSHOT_CONTROL_VERSION,
        snapshot_count: SNAPSHOT_COUNT,
        golden_snapshot_id: GOLDEN_SNAPSHOT_ID,
        current_snapshot_id: CURRENT_SNAPSHOT_ID,
        catalog_sha256: SNAPSHOT_CATALOG_SHA256
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
  CONTENT_FINGERPRINT,
  CURRENT_SNAPSHOT_ID,
  GOLDEN_SNAPSHOT_ID,
  MAX_CANARY_AGE_MS,
  MAX_DRIFT_AGE_MS,
  RELEASE_ID,
  RELEASE_MANIFEST,
  SENTINEL_SCHEMA,
  SNAPSHOT_CATALOG_SHA256,
  SNAPSHOT_CONTROL_VERSION,
  SNAPSHOT_COUNT,
  VISIBLE_MODEL,
  checkSnapshotControl,
  evaluateEndpoint,
  runSentinel
}
