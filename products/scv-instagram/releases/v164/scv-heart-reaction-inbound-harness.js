#!/usr/bin/env node
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-heart-reaction-harness-'))
const PORT = 40241 + Math.floor(Math.random() * 1000)

function postJson(body) {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body)
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/manychat/inbound',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(raw)
      }
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let parsed = {}
        try { parsed = JSON.parse(data || '{}') } catch {}
        resolve({ status: res.statusCode, body: parsed, raw: data })
      })
    })
    req.on('error', reject)
    req.write(raw)
    req.end()
  })
}

async function waitForHealth() {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${PORT}/livez`, (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode))
        })
        req.on('error', reject)
        req.setTimeout(500, () => req.destroy(new Error('timeout')))
      })
      if (result === 200) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('inbound_server_liveness_timeout')
}

function inboxPacket(messageId) {
  const dir = path.join(ROOT, 'inbox')
  for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.json'))) {
    const packet = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
    if (String(packet.message_id || '') === String(messageId || '')) return packet
  }
  return null
}

function assert(condition, message, detail = {}) {
  if (!condition) {
    const err = new Error(message)
    err.detail = detail
    throw err
  }
}

async function run() {
  const child = spawn(process.execPath, [path.join(__dirname, 'inbound-scv.js')], {
    env: {
      ...process.env,
      SCV_ROOT: ROOT,
      SCV_INBOUND_PORT: String(PORT),
      SCV_BIND_HOST: '127.0.0.1',
      SCV_CLOUD_RUNTIME: '0',
      SCV_INBOUND_AUTH_REQUIRED: '0',
      SCV_ADMIN_AUTH_REQUIRED: '0',
      MANYCHAT_API_KEY: '',
      SCV_FAST_TARGET_INBOX_KICK: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })

  try {
    await waitForHealth()

    const cases = [
      {
        name: 'direct_heart_emoji_message_text_is_not_silent',
        body: {
          contact_id: '910000000001',
          thread_id: '910000000001',
          message_id: 'heart-direct-message-text',
          instagram_username: 'srta.avalos',
          message_text: '❤️'
        }
      },
      {
        name: 'direct_heart_emoji_text_is_not_silent',
        body: {
          contact_id: '910000000002',
          thread_id: '910000000002',
          message_id: 'heart-direct-text',
          instagram_username: 'SRTA.AVALOS',
          text: '♥️'
        }
      },
      {
        name: 'reaction_payload_heart_is_not_silent',
        body: {
          contact_id: '910000000003',
          thread_id: '910000000003',
          message_id: 'heart-reaction-payload',
          instagram_username: 'srta.avalos',
          reaction: { emoji: '❤️' }
        }
      }
    ]

    let checked = 0
    for (const testCase of cases) {
      const result = await postJson(testCase.body)
      assert(result.status === 200, `${testCase.name}: expected 200`, result)
      assert(result.body?.stored === true, `${testCase.name}: expected stored=true`, result.body)
      const packet = inboxPacket(testCase.body.message_id)
      const packetText = String(packet?.text || '')
      assert(packetText === 'sent a heart reaction', `${testCase.name}: unexpected packet text`, {
        expected: 'sent a heart reaction',
        actual: packetText,
        body: result.body
      })
      assert(String(packet?.text_source || '').startsWith('heart_reaction'), `${testCase.name}: expected heart_reaction text_source`, packet)
      checked += 1
    }

    return { ok: true, checked, root: ROOT }
  } finally {
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 1000).unref()
    try { fs.rmSync(ROOT, { recursive: true, force: true }) } catch {}
    if (child.exitCode && child.exitCode !== 0) {
      process.stderr.write(stderr)
      process.stdout.write(stdout)
    }
  }
}

run()
  .then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  })
  .catch((err) => {
    process.stderr.write(JSON.stringify({
      ok: false,
      error: err.message,
      detail: err.detail || {}
    }, null, 2) + '\n')
    process.exit(1)
  })
