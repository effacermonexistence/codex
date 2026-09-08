#!/usr/bin/env node
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-post-share-harness-'))
const PORT = 39241 + Math.floor(Math.random() * 1000)

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
        req.setTimeout(500, () => {
          req.destroy(new Error('timeout'))
        })
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
        name: 'placeholder_last_input_text_with_instagram_post_url',
        body: {
          contact_id: '123456789',
          thread_id: '123456789',
          message_id: 'post-share-placeholder-url',
          instagram_username: 'client_test',
          message_text: '{{last_input_text}}',
          post: {
            url: 'https://www.instagram.com/p/POSTID/'
          }
        },
        expectedText: 'sent a reference post'
      },
      {
        name: 'empty_text_with_instagram_post_url',
        body: {
          contact_id: '123456789',
          thread_id: '123456789',
          message_id: 'post-share-empty-url',
          instagram_username: 'client_test',
          post: {
            url: 'https://www.instagram.com/p/POSTID/'
          }
        },
        expectedText: 'sent a reference post'
      },
      {
        name: 'short_attachment_title_preserved_as_reference_context',
        body: {
          contact_id: '123456789',
          thread_id: '123456789',
          message_id: 'post-share-title',
          instagram_username: 'client_test',
          attachments: [
            {
              type: 'share',
              title: 'cy:D/ flash DJ Nerdy',
              url: 'https://www.instagram.com/p/POSTID/'
            }
          ]
        },
        expectedText: 'sent a reference post: cy:D/ flash DJ Nerdy'
      },
      {
        name: 'post_media_object_without_url_or_title_still_becomes_reference_turn',
        body: {
          contact_id: '123456789',
          thread_id: '123456789',
          message_id: 'post-share-media-object-only',
          instagram_username: 'client_test',
          message_text: '{{last_input_text}}',
          post: {
            id: '17900000000000000',
            media_type: 'IMAGE'
          }
        },
        expectedText: 'sent a reference post'
      }
    ]

    let checked = 0
    for (const testCase of cases) {
      const result = await postJson(testCase.body)
      assert(result.status === 200, `${testCase.name}: expected 200`, result)
      assert(result.body?.stored === true, `${testCase.name}: expected stored=true`, result.body)
      const packet = inboxPacket(testCase.body.message_id)
      const packetText = String(packet?.text || '')
      assert(packetText === testCase.expectedText, `${testCase.name}: unexpected packet text`, {
        expected: testCase.expectedText,
        actual: packetText,
        body: result.body
      })
      assert(String(packet?.text_source || '').startsWith('reference_post'), `${testCase.name}: expected reference_post text_source`, packet)
      checked += 1
    }

    return {
      ok: true,
      checked,
      root: ROOT
    }
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
