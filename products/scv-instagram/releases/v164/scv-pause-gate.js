// ============================================================
// SCV PAUSE GATE — full-stop switch for live surgery (Ben directive 2026-07-07).
//
// SCV_PAUSE_NON_TEST=1 is the staging/test-only gate: everyone except the
// allowlist is held. SCV_PAUSE_DEBUG_ACCOUNTS=1 is the production gate: the
// Omar.system debug identity is held while real customers continue to flow.
// The debug gate is fail-safe by default in production and must be explicitly
// disabled for an isolated staging E2E run.
// ============================================================
const {
  DEBUG_USERNAMES: DEFAULT_DEBUG_USERNAMES,
  DEBUG_CONTACT_IDS: DEFAULT_DEBUG_CONTACT_IDS,
  debugIdentityFromEnv,
  isDebugIdentity
} = require('./scv-debug-identity.js')

function splitCsv(value) {
  return String(value || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
}

function envFlag(value, fallback = false) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return fallback
  return /^(1|true|yes|on)$/i.test(normalized)
}

function productionLike(env = process.env) {
  return String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() === 'production' ||
    String(env.SCV_RELEASE_MODE || '').trim().toLowerCase() === 'production'
}

function pauseEnabled(env = process.env) {
  return String(env.SCV_PAUSE_NON_TEST || '0').trim() === '1'
}

function pauseAllowlist(env = process.env) {
  return {
    usernames: new Set([
      ...splitCsv(env.SCV_FAST_TARGET_USERNAMES),
      ...splitCsv(env.SCV_CANARY_INSTAGRAM_USERNAME),
      ...splitCsv(env.SCV_PAUSE_ALLOW_USERNAMES)
    ]),
    contactIds: new Set([
      ...splitCsv(env.SCV_FAST_TARGET_CONTACT_IDS),
      ...splitCsv(env.SCV_CANARY_CONTACT_ID),
      ...splitCsv(env.SCV_PAUSE_ALLOW_CONTACT_IDS)
    ])
  }
}

function debugAccountIdentity(env = process.env) {
  return debugIdentityFromEnv(env)
}

function isDebugAccountPacket(packet, env = process.env) {
  return isDebugIdentity(packet, env)
}

function pauseDebugAccountsEnabled(env = process.env) {
  return envFlag(env.SCV_PAUSE_DEBUG_ACCOUNTS, productionLike(env))
}

// Total hard-stop (Ben 2026-07-08): SCV_PAUSE_ALL=1 holds EVERYONE, including the
// test allowlist (omar.system). Nothing is dropped — held in place like the normal
// pause. Use when even the test account must go silent during a full handoff.
function pauseAll(env = process.env) {
  if (String(env.SCV_PAUSE_ALL || '0').trim() === '1') return true
  // A persistent golden-release synthetic failure is a stronger hard stop than
  // the mutable environment switch. It is checked at every worker/sender gate
  // and survives restarts on the namespaced Railway volume.
  try {
    const { isFailClosed } = require('./scv-golden-fail-close.js')
    return isFailClosed({ env, root: env.SCV_ROOT || __dirname })
  } catch {
    // In production, inability to determine the safety-latch state is itself a
    // fail-close condition. Local legacy harnesses stay compatible.
    return String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() === 'production' ||
      String(env.SCV_RELEASE_MODE || '').trim().toLowerCase() === 'production'
  }
}

// Report only deliberate operator/configuration holds. This deliberately does
// not consult the persistent fail-close latch: monitoring needs to distinguish
// the packet that caused a latch from packets that merely accumulated after
// that latch stopped the workers.
function operatorPauseReasonForPacket(packet, env = process.env) {
  if (String(env.SCV_PAUSE_ALL || '0').trim() === '1') return 'pause_all'
  if (pauseDebugAccountsEnabled(env) && isDebugAccountPacket(packet, env)) {
    return 'pause_debug_account'
  }
  if (!pauseEnabled(env)) return ''

  const allow = pauseAllowlist(env)
  const username = String(packet?.instagram_username || '').trim().toLowerCase()
  const contact = String(packet?.contact_id || packet?.thread_id || '').trim().toLowerCase()
  const exactArmedStaging = (
    !productionLike(env) &&
    String(env.SCV_RELEASE_MODE || '').trim().toLowerCase() === 'staging' &&
    String(env.SCV_STAGING_CAPABILITY_MODE || '').trim() === 'provider_bound' &&
    envFlag(env.SCV_STAGING_REAL_E2E_ARMED, false)
  )
  if (exactArmedStaging) {
    return username === 'omar.system' && contact === '1537753982'
      ? ''
      : 'pause_non_test_exact_staging'
  }
  if (username && allow.usernames.has(username)) return ''
  if (contact && allow.contactIds.has(contact)) return ''
  return 'pause_non_test'
}

// True when this packet must be HELD (paused). Test-allowlisted accounts flow.
function isPausedForPacket(packet, env = process.env) {
  if (pauseAll(env)) return true
  const railwayMode = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const configuredMode = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  if (
    ['production', 'staging'].includes(railwayMode) &&
    ['production', 'staging'].includes(configuredMode) &&
    railwayMode !== configuredMode
  ) return true
  return Boolean(operatorPauseReasonForPacket(packet, env))
}

module.exports = {
  DEFAULT_DEBUG_USERNAMES,
  DEFAULT_DEBUG_CONTACT_IDS,
  pauseEnabled,
  pauseAllowlist,
  debugAccountIdentity,
  isDebugAccountPacket,
  pauseDebugAccountsEnabled,
  pauseAll,
  operatorPauseReasonForPacket,
  isPausedForPacket
}
