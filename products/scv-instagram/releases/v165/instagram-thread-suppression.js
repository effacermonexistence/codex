#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const { DEBUG_USERNAMES_CSV } = require(path.join(__dirname, 'scv-debug-identity.js'))

const ROOT = process.env.SCV_ROOT || __dirname
const LOG_DIR = path.join(ROOT, 'logs')
const CACHE_PATH = path.join(LOG_DIR, 'instagram-thread-suppression-cache.json')
const USER_HOME = process.env.HOME || os.homedir()
const IG_CLIENT_PATH = process.env.IG_CLIENT_PATH || path.join(USER_HOME, '.openclaw', 'plugins-src', 'instagram-cli-4llm', 'dist', 'client.js')
const CACHE_TTL_MS = Math.max(10_000, Number(process.env.SCV_INSTAGRAM_THREAD_CACHE_TTL_MS || '120000'))
const LOOKUP_MAX_PAGES = Math.max(1, Number(process.env.SCV_INSTAGRAM_THREAD_LOOKUP_MAX_PAGES || '3'))
const SUPPRESS_THREAD_LABELS = new Set(
  String(process.env.SCV_INSTAGRAM_SUPPRESS_THREAD_LABELS || '1')
    .split(',')
    .map((value) => Number.parseInt(String(value || '').trim(), 10))
    .filter((value) => Number.isFinite(value) && value >= 0)
)
const TATTOO_SHOP_USERNAME_RE = /\b(tattoo|tattoos|ink|studio|shop|piercing|collective|parlor|parlour|supply)\b/i
const TATTOO_SHOP_COMPACT_STRONG_HINTS = [
  'tattoo',
  'tattoos',
  'studio',
  'piercing',
  'collective',
  'parlor',
  'parlour',
  'supply'
]
const TATTOO_SHOP_KNOWN_COMPACT_USERNAMES = new Set([
  'oneshottattoo',
  'oneshottattoosf',
  'legendinksanfrancisco',
  'legendinksf',
  'missioninksf',
  'eyeofthetigertattoo',
  'undrgrndsf',
  'blackhearttattoo'
])
const TATTOO_SHOP_MESSAGE_RE = [
  /\bguest(?:ing)?\s+(?:artist|spot|spots|at|with|for)\b/i,
  /\bhost\s+guests?\b/i,
  /\bguest\s+artist\s+form\b/i,
  /\bguest\s+spot\b/i,
  /\btattoo\s+license\b/i,
  /\brental\s+agreement\b/i,
  /\bemail\s+the\s+shop\b/i,
  /\bplease\s+email\s+(?:the\s+)?shop\b/i,
  /\bopen\s+space\s+is\s+limited\b/i,
  /\bfull\s+crew\b/i,
  /\bone\s+of\s+the\s+tattooers\b/i,
  /\boneshottattoosf\b/i,
  /\blegendink\b/i,
  /\bmissionink\b/i,
  /\beye\s+of\s+the\s+tiger\s+tattoo\b/i
]
const TATTOO_SHOP_USERNAME_ALLOWLIST = new Set(
  String(process.env.SCV_TATTOO_SHOP_ALLOWLIST || '')
    .split(',')
    .map((value) => normalizeUsername(value))
    .filter(Boolean)
)

let instagramClientPromise = null
let cacheLoaded = false
let cache = { threads: {} }

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase()
}

function splitUsernames(value) {
  return String(value || '')
    .split(',')
    .map((entry) => normalizeUsername(entry))
    .filter(Boolean)
}

function getSuppressionBypassUsernames() {
  return new Set(splitUsernames(
    process.env.SCV_SUPPRESSION_BYPASS_USERNAMES ||
    process.env.SCV_PURGE_TEST_USERNAMES ||
    DEBUG_USERNAMES_CSV
  ))
}

function isSuppressionBypassUsername(username) {
  const normalizedUsername = normalizeUsername(username)
  return !!normalizedUsername && getSuppressionBypassUsernames().has(normalizedUsername)
}

function normalizeSuppressionText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

function loadCache() {
  if (cacheLoaded) return cache
  cacheLoaded = true

  try {
    cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
  } catch {
    cache = { threads: {} }
  }

  if (!cache || typeof cache !== 'object') {
    cache = { threads: {} }
  }

  if (!cache.threads || typeof cache.threads !== 'object') {
    cache.threads = {}
  }

  return cache
}

function saveCache() {
  ensureLogDir()
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n')
}

function resolveInstagramUsername() {
  const fromEnv = normalizeUsername(process.env.SCV_REACTION_IG_USERNAME || '')
  if (fromEnv) return fromEnv

  const configPath = path.join(USER_HOME, '.instagram-cli', 'config.ts.yaml')
  if (!fs.existsSync(configPath)) return ''

  const raw = fs.readFileSync(configPath, 'utf8')
  const match = raw.match(/^\s*currentUsername:\s*([^\n]+)\s*$/m)
  if (!match) return ''

  return normalizeUsername(String(match[1] || '').replace(/^['"]|['"]$/g, ''))
}

async function getInstagramClient() {
  if (!instagramClientPromise) {
    instagramClientPromise = (async () => {
      const ownerUsername = resolveInstagramUsername()
      if (!ownerUsername) {
        throw new Error('instagram_owner_username_unavailable')
      }

      const { InstagramClient } = require(IG_CLIENT_PATH)
      const client = new InstagramClient(ownerUsername)
      const login = await client.loginBySession({ initializeRealtime: false })

      if (!login?.success) {
        throw new Error(`instagram_session_login_failed:${login?.error || 'unknown'}`)
      }

      return client
    })().catch((err) => {
      instagramClientPromise = null
      throw err
    })
  }

  return instagramClientPromise
}

function buildThreadSnapshot(thread) {
  const usernames = Array.isArray(thread?.users)
    ? thread.users.map((user) => normalizeUsername(user?.username || '')).filter(Boolean)
    : []

  return {
    usernames,
    thread_id: String(thread?.thread_id || ''),
    folder: Number.isFinite(Number(thread.folder)) ? Number(thread.folder) : 0,
    business_thread_folder: Number.isFinite(Number(thread?.business_thread_folder)) ? Number(thread.business_thread_folder) : 0,
    system_folder: Number.isFinite(Number(thread?.system_folder)) ? Number(thread.system_folder) : 0,
    thread_label: Number.isFinite(Number(thread?.thread_label)) ? Number(thread.thread_label) : 0,
    pending: !!thread?.pending,
    is_pin: !!thread?.is_pin,
    marked_as_unread: !!thread?.marked_as_unread,
    archived: !!thread?.archived,
    muted: !!thread?.muted,
    spam: !!(thread?.spam || thread?.is_spam),
    label_items: Array.isArray(thread?.label_items)
      ? thread.label_items.map((item) => ({
          name: String(item?.name || ''),
          type: Number.isFinite(Number(item?.type)) ? Number(item.type) : null
        }))
      : [],
    seen_at: new Date().toISOString()
  }
}

function getSuppressionVerdict(snapshot) {
  if (!snapshot) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: 'instagram_thread_not_found'
    }
  }

  const bypassUsername = Array.isArray(snapshot.usernames)
    ? snapshot.usernames.find((username) => isSuppressionBypassUsername(username))
    : ''
  if (bypassUsername) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: 'suppression_bypass_username',
      snapshot
    }
  }

  if (SUPPRESS_THREAD_LABELS.has(Number(snapshot.thread_label || 0))) {
    return {
      suppressed: true,
      matched_tag: `instagram_thread_label_${snapshot.thread_label}`,
      reason: 'instagram_thread_label',
      snapshot
    }
  }

  return {
    suppressed: false,
    matched_tag: '',
    reason: 'instagram_thread_allowed',
    snapshot
  }
}

function getHeuristicSuppressionVerdict(username) {
  const normalizedUsername = normalizeUsername(username)
  const compactUsername = normalizedUsername.replace(/[^a-z0-9]/g, '')
  if (!normalizedUsername) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: 'missing_instagram_username'
    }
  }

  if (isSuppressionBypassUsername(normalizedUsername)) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: 'suppression_bypass_username'
    }
  }

  if (TATTOO_SHOP_USERNAME_ALLOWLIST.has(normalizedUsername)) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: 'tattoo_shop_username_allowlisted'
    }
  }

  if (TATTOO_SHOP_KNOWN_COMPACT_USERNAMES.has(compactUsername)) {
    return {
      suppressed: true,
      matched_tag: 'known_tattoo_shop_username',
      reason: 'known_tattoo_shop_username'
    }
  }

  if (TATTOO_SHOP_USERNAME_RE.test(normalizedUsername)) {
    return {
      suppressed: true,
      heuristic: true,
      matched_tag: 'tattoo_shop_username_heuristic',
      reason: 'tattoo_shop_username_heuristic'
    }
  }

  if (TATTOO_SHOP_COMPACT_STRONG_HINTS.some((token) => compactUsername.includes(token))) {
    return {
      suppressed: true,
      heuristic: true,
      matched_tag: 'tattoo_shop_username_compact_heuristic',
      reason: 'tattoo_shop_username_compact_heuristic'
    }
  }

  return {
    suppressed: false,
    matched_tag: '',
    reason: 'instagram_thread_allowed'
  }
}

function getMessageHeuristicSuppressionVerdict(text) {
  const normalizedText = normalizeSuppressionText(text)

  if (!normalizedText) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: 'missing_message_text'
    }
  }

  if (TATTOO_SHOP_MESSAGE_RE.some((pattern) => pattern.test(normalizedText))) {
    return {
      suppressed: true,
      // Message-content matching is advisory, exactly like username pattern
      // matching. A real lead can mention another studio without consenting to
      // automation suppression; only explicit tags/known identities may silence
      // the reply lane.
      heuristic: true,
      matched_tag: 'tattoo_shop_message_heuristic',
      reason: 'tattoo_shop_message_heuristic'
    }
  }

  return {
    suppressed: false,
    matched_tag: '',
    reason: 'message_text_allowed'
  }
}

function getCachedVerdict(username) {
  if (!username) return null

  const entry = loadCache().threads[username]
  if (!entry) return null

  const seenAtMs = Date.parse(String(entry?.seen_at || ''))
  if (!Number.isFinite(seenAtMs) || (Date.now() - seenAtMs) > CACHE_TTL_MS) {
    return null
  }

  return getSuppressionVerdict(entry)
}

async function lookupThreadSnapshotByUsername(username) {
  const client = await getInstagramClient()
  const ig = client.getInstagramClient()
  const normalizedUsername = normalizeUsername(username)

  if (!normalizedUsername) return null

  const feed = ig.feed.directInbox()

  for (let page = 0; page < LOOKUP_MAX_PAGES; page += 1) {
    const threads = await feed.items()

    for (const thread of threads) {
      const snapshot = buildThreadSnapshot(thread)

      for (const candidateUsername of snapshot.usernames) {
        cache.threads[candidateUsername] = snapshot
      }

      if (snapshot.usernames.includes(normalizedUsername)) {
        saveCache()
        return snapshot
      }
    }

    if (!feed.isMoreAvailable()) {
      break
    }
  }

  saveCache()
  return null
}

async function getInstagramSuppressionForUsername(username, context = {}) {
  const normalizedUsername = normalizeUsername(username)

  if (isSuppressionBypassUsername(normalizedUsername)) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: 'suppression_bypass_username'
    }
  }

  const messageVerdict = getMessageHeuristicSuppressionVerdict(
    context?.text || context?.message_text || context?.body_text || ''
  )

  if (messageVerdict.suppressed) {
    return messageVerdict
  }

  if (!normalizedUsername) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: 'missing_instagram_username'
    }
  }

  const heuristicVerdict = getHeuristicSuppressionVerdict(normalizedUsername)
  if (heuristicVerdict.suppressed) {
    return heuristicVerdict
  }

  try {
    const cached = getCachedVerdict(normalizedUsername)
    if (cached) {
      return cached
    }

    const snapshot = await lookupThreadSnapshotByUsername(normalizedUsername)
    return getSuppressionVerdict(snapshot)
  } catch (err) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: 'instagram_thread_lookup_failed',
      error: String(err?.message || err || '')
    }
  }
}

module.exports = {
  getInstagramSuppressionForUsername,
  isSuppressionBypassUsername
}
