#!/usr/bin/env node
'use strict'

const assert = require('assert')
process.env.SCV_RELEASE_PROTOCOL = 'single_release_v1'
const { statusAgeMs } = require('./inbound-scv.js')

const now = Date.parse('2026-08-31T23:00:00.000Z')

assert.strictEqual(
  statusAgeMs({ checked_at_utc: '2026-08-31T22:59:30.000Z' }, now),
  30_000,
  'new capability receipts must be fresh from checked_at_utc'
)
assert.strictEqual(
  statusAgeMs({ updated_at: '2026-08-31T22:59:40.000Z' }, now),
  20_000,
  'legacy heartbeat receipts must remain supported'
)
assert.strictEqual(
  statusAgeMs({ at: '2026-08-31T22:59:50.000Z' }, now),
  10_000,
  'legacy at receipts must remain supported'
)
assert.strictEqual(
  statusAgeMs({}, now),
  Number.POSITIVE_INFINITY,
  'missing timestamps must fail closed'
)

console.log(JSON.stringify({
  ok: true,
  checked: 4,
  checked_at_utc_supported: true,
  missing_timestamp_fails_closed: true
}, null, 2))
