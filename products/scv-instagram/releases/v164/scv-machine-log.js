#!/usr/bin/env node
const crypto = require('crypto')
const LOCAL_EPHEMERAL_LOG_HMAC_KEY = crypto.randomBytes(32)

function logHmacKey(env = process.env) {
  const dedicated = String(env.SCV_LOG_HMAC_SECRET || '')
  if (dedicated.length >= 32) return dedicated
  const admin = String(env.SCV_ADMIN_SHARED_SECRET || '')
  if (admin.length >= 32) return admin
  const cloudRuntime = String(env.SCV_CLOUD_RUNTIME || '') === '1' ||
    Boolean(String(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_ID || '').trim())
  if (cloudRuntime) throw new Error('scv_machine_log_cloud_hmac_secret_required')
  return LOCAL_EPHEMERAL_LOG_HMAC_KEY
}

function hmacSha256(value, env = process.env) {
  const text = String(value == null ? '' : value)
  return text
    ? crypto.createHmac('sha256', logHmacKey(env)).update(`scv-machine-log-v1\0${text}`).digest('hex')
    : ''
}

const sha256 = hmacSha256

function redactedIdentity(value = {}) {
  return {
    contact_hmac_sha256: hmacSha256(value.contact_id),
    thread_hmac_sha256: hmacSha256(value.thread_id || value.contact_id),
    username_hmac_sha256: hmacSha256(value.instagram_username),
    message_hmac_sha256: hmacSha256(value.message_id)
  }
}

function artifactSha256(file) {
  return sha256(String(file || ''))
}

function textMetrics(value, prefix = 'text') {
  const text = String(value == null ? '' : value)
  return {
    [`${prefix}_chars`]: text.length,
    [`${prefix}_hmac_sha256`]: hmacSha256(text)
  }
}

function errorMetrics(error, prefix = 'error') {
  const text = String(error && error.message ? error.message : error || '')
  const name = String(error && error.name ? error.name : 'Error')
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .slice(0, 80) || 'Error'
  return {
    [`${prefix}_name`]: name,
    [`${prefix}_chars`]: text.length,
    [`${prefix}_hmac_sha256`]: hmacSha256(text)
  }
}

function redactedPathList(values) {
  const list = Array.isArray(values) ? values : []
  return {
    count: list.length,
    hmac_sha256: hmacSha256(list.map((value) => String(value || '')).sort().join('\n'))
  }
}

function safeEnum(value, fallback = '') {
  const text = String(value == null ? '' : value).trim()
  if (!text) return fallback
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(text) ? text : fallback
}

const SENSITIVE_KEY = /(?:contact|thread|username|instagram|message|text|preview|name|phone|email|uid|file|path|root|dest|packet|result|body|error|secret|token|password|authorization)/i
const SENSITIVE_SCALAR_ID_KEY = /(?:^|_)(?:contact|thread|message|subscriber|user|instagram|phone|email|uid)(?:_id)?$/i
const SAFE_STRING_KEY = /^(?:event|type|mode|reason|status|role|source|stage|site|action|signal|schema|release_id|control_plane_id|control_epoch|runner|authority_gate|delivery_method|input_kind|runtime_mode|booking_stage_hint|timestamp_source|terminal_outcome|pause_stage|(?:[a-z0-9_]+_)?(?:version|rule|source|reason|status|mode|method|kind|stage))$/i
const SAFE_RELEASE_HASH_KEY = /^(?:content_fingerprint_sha256|release_manifest_sha256|booking_policy_fingerprint)$/

function sanitizeMachineLogObject(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : { value }
  const out = {}
  for (const [key, item] of Object.entries(input)) {
    if (item == null) continue
    if (typeof item === 'boolean') {
      out[key] = item
      continue
    }
    if (typeof item === 'number') {
      if (SENSITIVE_SCALAR_ID_KEY.test(key)) {
        out[`${key}_hmac_sha256`] = hmacSha256(String(item))
      } else {
        out[key] = item
      }
      continue
    }
    if (Array.isArray(item)) {
      out[`${key}_count`] = item.length
      out[`${key}_hmac_sha256`] = hmacSha256(JSON.stringify(item))
      continue
    }
    if (typeof item === 'object') {
      out[`${key}_field_count`] = Object.keys(item).length
      out[`${key}_hmac_sha256`] = hmacSha256(JSON.stringify(item))
      continue
    }
    const text = String(item)
    if (key.endsWith('_hmac_sha256') && /^[a-f0-9]{64}$/i.test(text)) {
      out[key] = text
    } else if (SAFE_RELEASE_HASH_KEY.test(key) && /^[a-f0-9]{64}$/i.test(text)) {
      out[key] = text
    } else if (!SENSITIVE_KEY.test(key) && key.endsWith('_at') && Number.isFinite(Date.parse(text))) {
      out[key] = new Date(text).toISOString()
    } else if (!SENSITIVE_KEY.test(key) && SAFE_STRING_KEY.test(key)) {
      out[key] = safeEnum(text, 'redacted_value')
    } else {
      out[`${key}_chars`] = text.length
      out[`${key}_hmac_sha256`] = hmacSha256(text)
    }
  }
  return out
}

module.exports = {
  logHmacKey,
  hmacSha256,
  sha256,
  redactedIdentity,
  artifactSha256,
  textMetrics,
  errorMetrics,
  redactedPathList,
  safeEnum,
  sanitizeMachineLogObject
}
