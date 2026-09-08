#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')

const USER_HOME = process.env.HOME || os.homedir()
const IG_CLIENT_PATH = process.env.IG_CLIENT_PATH || path.join(USER_HOME, '.openclaw', 'plugins-src', 'instagram-cli-4llm', 'dist', 'client.js')

let instagramClientPromise = null

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function getInstagramRuntimeStatus() {
  return {
    client_path: IG_CLIENT_PATH,
    client_exists: fs.existsSync(IG_CLIENT_PATH),
    owner_username: resolveInstagramUsername()
  }
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

async function resolveThreadForUsername(username) {
  const normalizedUsername = normalizeUsername(username)
  if (!normalizedUsername) {
    throw new Error('missing_instagram_username')
  }

  const client = await getInstagramClient()
  const matches = await client.searchThreadByUsername(normalizedUsername, { forceExact: true })
  const candidateUser = matches?.[0]?.thread?.users?.[0]
  const participantPk = Number(candidateUser?.pk || 0)

  if (!Number.isFinite(participantPk) || participantPk <= 0) {
    throw new Error(`instagram_thread_user_pk_not_found:${normalizedUsername}`)
  }

  const thread = await client.ensureThread(participantPk)
  const threadId = String(thread?.id || '')
  if (!threadId) {
    throw new Error(`instagram_thread_not_found:${normalizedUsername}`)
  }

  return {
    client,
    threadId,
    participantPk,
    username: normalizedUsername
  }
}

async function getRecentMessages(threadId) {
  const client = await getInstagramClient()
  const payload = await client.getMessages(threadId)
  return Array.isArray(payload?.messages) ? payload.messages : []
}

async function confirmOutgoingTextVisible({
  instagram_username,
  text,
  polls = 4,
  initial_wait_ms = 1200,
  wait_ms = 2200
}) {
  const normalizedText = normalizeText(text)
  if (!normalizeUsername(instagram_username) || !normalizedText) {
    return {
      confirmed: false,
      reason: 'missing_username_or_text'
    }
  }

  const resolved = await resolveThreadForUsername(instagram_username)
  if (initial_wait_ms > 0) {
    await sleep(initial_wait_ms)
  }

  for (let attempt = 1; attempt <= polls; attempt += 1) {
    const messages = await getRecentMessages(resolved.threadId)
    const match = messages.find((message) => {
      if (!message?.isOutgoing) return false
      if (message.itemType !== 'text') return false
      return normalizeText(message.text) === normalizedText
    })

    if (match) {
      return {
        confirmed: true,
        thread_id: resolved.threadId,
        item_id: String(match.id || ''),
        attempt,
        method: 'instagram_visible_thread_match'
      }
    }

    if (attempt < polls) {
      await sleep(wait_ms)
    }
  }

  return {
    confirmed: false,
    reason: 'outgoing_text_not_visible',
    thread_id: resolved.threadId
  }
}

async function sendDirectTextByUsername({ instagram_username, text }) {
  const normalizedText = String(text || '').trim()
  if (!normalizedText) {
    return {
      sent: false,
      confirmed: false,
      reason: 'missing_text'
    }
  }

  const resolved = await resolveThreadForUsername(instagram_username)
  await resolved.client.sendMessage(resolved.threadId, normalizedText)

  const confirmation = await confirmOutgoingTextVisible({
    instagram_username,
    text: normalizedText,
    polls: 5,
    initial_wait_ms: 900,
    wait_ms: 1800
  })

  return {
    sent: true,
    confirmed: !!confirmation.confirmed,
    thread_id: resolved.threadId,
    confirmation
  }
}

module.exports = {
  confirmOutgoingTextVisible,
  getInstagramRuntimeStatus,
  getInstagramClient,
  resolveThreadForUsername,
  sendDirectTextByUsername
}
