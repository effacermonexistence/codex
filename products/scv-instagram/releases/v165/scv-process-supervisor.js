#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const {
  hmacSha256,
  sanitizeMachineLogObject
} = require(path.join(__dirname, 'scv-machine-log.js'))

const MAX_RELAY_LINE_BYTES = 64 * 1024
const KNOWN_MARKER = /^===[A-Z0-9_:-]+===$|^\[(?:SCV|INFO|WARN|ERROR)[A-Z0-9_ .:-]*\]$/

function sanitizeRelayLine(lineBuffer) {
  const raw = Buffer.isBuffer(lineBuffer) ? lineBuffer : Buffer.from(String(lineBuffer || ''))
  const line = raw.toString('utf8').replace(/\r$/, '')
  if (KNOWN_MARKER.test(line)) return line
  try {
    const parsed = JSON.parse(line)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify(sanitizeMachineLogObject(parsed))
    }
  } catch {}
  return JSON.stringify({
    event: 'scv_child_nonjson_redacted',
    line_bytes: raw.length,
    line_hmac_sha256: hmacSha256(raw.toString('base64'))
  })
}

function attachSanitizedRelay(stream, label, write) {
  if (!stream || typeof stream.on !== 'function') return
  let pending = Buffer.alloc(0)
  const emit = (line) => write(`[${label}] ${sanitizeRelayLine(line)}\n`)
  stream.on('data', (chunk) => {
    pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))])
    let newline
    while ((newline = pending.indexOf(0x0a)) !== -1) {
      emit(pending.subarray(0, newline))
      pending = pending.subarray(newline + 1)
    }
    if (pending.length > MAX_RELAY_LINE_BYTES) {
      emit(pending)
      pending = Buffer.alloc(0)
    }
  })
  const flush = () => {
    if (!pending.length) return
    emit(pending)
    pending = Buffer.alloc(0)
  }
  stream.on('end', flush)
  stream.on('close', flush)
}

class ScvProcessSupervisor {
  constructor(options = {}) {
    this.root = options.root || __dirname
    this.services = (options.services || []).map(([label, script, args = []]) =>
      Object.freeze({ label, script, args: Object.freeze([...(args || [])]) })
    )
    this.statusFile = options.statusFile || path.join(this.root, 'logs', 'supervisor-status.json')
    this.spawnImpl = options.spawnImpl || spawn
    this.restartBaseMs = Math.max(1, Number(options.restartBaseMs || 1000))
    this.restartMaxMs = Math.max(this.restartBaseMs, Number(options.restartMaxMs || 30_000))
    this.heartbeatMs = Math.max(50, Number(options.heartbeatMs || 5000))
    this.recentWindowMs = Math.max(1000, Number(options.recentWindowMs || 60_000))
    this.state = new Map()
    this.children = new Map()
    this.restartTimers = new Map()
    this.heartbeat = null
    this.shuttingDown = false
    this.stdoutWrite = options.stdoutWrite || ((value) => process.stdout.write(value))
    this.stderrWrite = options.stderrWrite || ((value) => process.stderr.write(value))
  }

  status(now = Date.now()) {
    return {
      schema: 'scv-supervisor-status-2026-08-19-v2-argv-preserved',
      updated_at: new Date(now).toISOString(),
      pid: process.pid,
      shutting_down: this.shuttingDown,
      required_services: this.services.map(({ label }) => label),
      services: Object.fromEntries(this.services.map(({ label }) => {
        const value = this.state.get(label) || {}
        return [label, {
          script: String(value.script || ''),
          args: [...(value.args || [])],
          running: value.running === true,
          pid: Number(value.pid || 0),
          restarts: Number(value.restarts || 0),
          recent_restart_count: (value.restart_timestamps || [])
            .filter((at) => now - at < this.recentWindowMs).length,
          started_at: String(value.started_at || ''),
          exited_at: String(value.exited_at || ''),
          exit_code: value.exit_code ?? null,
          exit_signal: String(value.exit_signal || '')
        }]
      }))
    }
  }

  writeStatus() {
    const temp = `${this.statusFile}.${process.pid}.tmp`
    fs.mkdirSync(path.dirname(this.statusFile), { recursive: true })
    fs.writeFileSync(temp, `${JSON.stringify(this.status(), null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temp, this.statusFile)
  }

  descriptor(label) {
    return this.services.find((service) => service.label === label)
  }

  startService(label) {
    const descriptor = this.descriptor(label)
    if (!descriptor) throw new Error(`supervisor_unknown_service:${label}`)
    const previous = this.state.get(label) || { restarts: 0, restart_timestamps: [] }
    const argv = [path.join(this.root, descriptor.script), ...descriptor.args]
    const child = this.spawnImpl(process.execPath, argv, {
      cwd: this.root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.children.set(label, child)
    this.state.set(label, {
      ...previous,
      script: descriptor.script,
      args: descriptor.args,
      running: true,
      pid: child.pid,
      started_at: new Date().toISOString(),
      exited_at: '',
      exit_code: null,
      exit_signal: ''
    })
    this.writeStatus()

    attachSanitizedRelay(child.stdout, label, this.stdoutWrite)
    attachSanitizedRelay(child.stderr, label, this.stderrWrite)
    child.once('exit', (code, signal) => {
      this.children.delete(label)
      const state = this.state.get(label) || previous
      const now = Date.now()
      const restartTimestamps = [...(state.restart_timestamps || []), now]
        .filter((at) => now - at < this.recentWindowMs)
      this.state.set(label, {
        ...state,
        running: false,
        pid: 0,
        exited_at: new Date(now).toISOString(),
        exit_code: code,
        exit_signal: signal || '',
        restarts: Number(state.restarts || 0) + (this.shuttingDown ? 0 : 1),
        restart_timestamps: restartTimestamps
      })
      this.writeStatus()
      if (this.shuttingDown) return
      const delay = Math.min(
        this.restartMaxMs,
        this.restartBaseMs * (2 ** Math.min(5, Math.max(0, restartTimestamps.length - 1)))
      )
      const timer = setTimeout(() => {
        this.restartTimers.delete(label)
        if (!this.shuttingDown) this.startService(label)
      }, delay)
      this.restartTimers.set(label, timer)
    })
    return child
  }

  startAll() {
    for (const { label } of this.services) this.startService(label)
    this.heartbeat = setInterval(() => this.writeStatus(), this.heartbeatMs)
    return this
  }

  shutdown(signal = 'SIGTERM') {
    if (this.shuttingDown) return
    this.shuttingDown = true
    for (const timer of this.restartTimers.values()) clearTimeout(timer)
    this.restartTimers.clear()
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.writeStatus()
    for (const child of this.children.values()) {
      try { child.kill(signal) } catch {}
    }
  }
}

module.exports = {
  ScvProcessSupervisor,
  sanitizeRelayLine,
  attachSanitizedRelay
}
