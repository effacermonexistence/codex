#!/usr/bin/env node

// One authority for the only destructive/resettable Instagram debug identity.
// Matching is exact on structured username/contact fields; message text never
// grants debug status.
const DEBUG_USERNAMES = Object.freeze([
  'omar.system', 'omar_system', 'omarsystem', 'omar system',
  'omal.system', 'omal_system', 'omalsystem', 'omal system'
])
const DEBUG_CONTACT_IDS = Object.freeze(['1537753982'])
const DEBUG_USERNAMES_CSV = DEBUG_USERNAMES.join(',')
const DEBUG_CONTACT_IDS_CSV = DEBUG_CONTACT_IDS.join(',')

function splitCsv(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
  }
  return String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
}

function sameSet(left, right) {
  const a = new Set(left)
  const b = new Set(right)
  return a.size === b.size && [...a].every((value) => b.has(value))
}

function debugIdentityConfigurationVerdict(env = process.env) {
  const configuredUsernames = splitCsv(
    env.SCV_DEBUG_ACCOUNT_USERNAMES || env.SCV_PURGE_TEST_USERNAMES
  )
  const configuredContactIds = splitCsv(
    env.SCV_DEBUG_ACCOUNT_CONTACT_IDS || env.SCV_PURGE_TEST_CONTACT_IDS
  )
  return {
    ok: (!configuredUsernames.length || sameSet(configuredUsernames, DEBUG_USERNAMES)) &&
      (!configuredContactIds.length || sameSet(configuredContactIds, DEBUG_CONTACT_IDS)),
    usernames_exact: !configuredUsernames.length || sameSet(configuredUsernames, DEBUG_USERNAMES),
    contact_ids_exact: !configuredContactIds.length || sameSet(configuredContactIds, DEBUG_CONTACT_IDS)
  }
}

function debugIdentityFromEnv(_env = process.env) {
  // Environment variables are declarative release inputs, not an authority to
  // expand which real customers count as destructive/resettable test accounts.
  return {
    usernames: new Set(DEBUG_USERNAMES),
    contactIds: new Set(DEBUG_CONTACT_IDS)
  }
}

function isDebugIdentity(packet, env = process.env) {
  const identity = debugIdentityFromEnv(env)
  const username = String(packet?.instagram_username || packet?.username || '').trim().toLowerCase()
  const contactId = String(packet?.contact_id || packet?.thread_id || '').trim().toLowerCase()
  // Destructive/resettable identity is a bound pair. Neither a caller supplied
  // alias nor a contact id alone may put an unrelated customer into Omar's
  // pause, purge, or accelerated-recovery scope.
  return Boolean(
    username && contactId &&
    identity.usernames.has(username) &&
    identity.contactIds.has(contactId)
  )
}

function isCanonicalDebugUsername(username) {
  return DEBUG_USERNAMES.includes(String(username || '').trim().toLowerCase())
}

module.exports = {
  DEBUG_USERNAMES,
  DEBUG_CONTACT_IDS,
  DEBUG_USERNAMES_CSV,
  DEBUG_CONTACT_IDS_CSV,
  splitCsv,
  debugIdentityConfigurationVerdict,
  debugIdentityFromEnv,
  isDebugIdentity,
  isCanonicalDebugUsername
}
