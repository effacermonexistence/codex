#!/usr/bin/env node

const assert = require('assert')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  BACKUP_DIR,
  HISTORY_DIR,
  RECEIPT_DIR,
  STATE_DIR,
  TRANSACTION_JOURNAL,
  buildRecoveryPlan,
  runRecovery
} = require('./scv-restore-non-debug-history')

function writeJson(root, directory, name, value) {
  const target = path.join(root, directory)
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`)
}

function readJson(root, directory, name) {
  return JSON.parse(fs.readFileSync(path.join(root, directory, `${name}.json`), 'utf8'))
}

function makeEvent(messageId, role, text, at, bubbleIndex) {
  const event = { role, message_id: messageId, text, at }
  if (bubbleIndex !== undefined) event.bubble_index = bubbleIndex
  return event
}

function names(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : []
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex')
}

function writePrivateJournal(root, value) {
  const file = path.join(root, TRANSACTION_JOURNAL)
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return file
}

function assertReceiptIsPiiFree(receipt, forbidden) {
  const serialized = JSON.stringify(receipt)
  for (const value of forbidden) {
    assert(!serialized.includes(value), `receipt leaked forbidden value: ${value}`)
  }
  assert(/^[a-f0-9]{64}$/.test(receipt.hashes.input_inventory_sha256))
  assert(/^[a-f0-9]{64}$/.test(receipt.hashes.plan_sha256))
  assert(/^[a-f0-9]{64}$/.test(receipt.hashes.receipt_sha256))
}

function buildFixture(root) {
  const sourceA = path.join(root, 'archive-a')
  const sourceB = path.join(root, 'archive-b')
  const target = path.join(root, 'live-target')
  for (const directory of [sourceA, sourceB, target]) {
    fs.mkdirSync(path.join(directory, STATE_DIR), { recursive: true })
    fs.mkdirSync(path.join(directory, HISTORY_DIR), { recursive: true })
  }

  writeJson(sourceA, STATE_DIR, '9001', {
    contact_id: '9001',
    thread_id: '9001',
    instagram_username: 'real.client',
    text: 'archive older state',
    received_at: '2026-04-20T10:00:00.000Z',
    // Restore selection follows immutable interaction time, never a migration or
    // retry bookkeeping timestamp.
    updated_at: '2026-08-20T10:00:00.000Z'
  })
  writeJson(sourceB, STATE_DIR, '9001', {
    contact_id: '9001',
    thread_id: '9001',
    instagram_username: 'real.client',
    text: 'archive newest state',
    received_at: '2026-04-22T10:00:00.000Z'
  })
  writeJson(target, STATE_DIR, '9001', {
    contact_id: '9001',
    thread_id: '9001',
    instagram_username: 'real.client',
    text: 'live middle state',
    received_at: '2026-04-21T10:00:00.000Z'
  })

  writeJson(sourceA, STATE_DIR, '9002', {
    contact_id: '9002',
    thread_id: '9002',
    text: 'archive must not overwrite',
    received_at: '2026-04-20T10:00:00.000Z'
  })
  writeJson(target, STATE_DIR, '9002', {
    contact_id: '9002',
    thread_id: '9002',
    text: 'new live state wins',
    received_at: '2026-05-01T10:00:00.000Z'
  })

  writeJson(sourceA, STATE_DIR, '9003', {
    contact_id: '9003',
    thread_id: '9003',
    text: 'restored source state',
    received_at: '2026-04-20T10:00:00.000Z'
  })

  writeJson(sourceA, STATE_DIR, '9005', {
    contact_id: '9005',
    thread_id: '9005',
    text: 'unknown-time archive must not overwrite live'
  })
  writeJson(target, STATE_DIR, '9005', {
    contact_id: '9005',
    thread_id: '9005',
    text: 'unknown-time live state wins'
  })
  // Even an artificially future archive mtime is not customer interaction
  // evidence and must not defeat the target-wins contract.
  const futureMtime = new Date('2036-01-01T00:00:00.000Z')
  fs.utimesSync(path.join(sourceA, STATE_DIR, '9005.json'), futureMtime, futureMtime)

  writeJson(sourceA, HISTORY_DIR, '9001', {
    contact_id: '9001',
    thread_id: '9001',
    instagram_username: 'real.client',
    events: [
      makeEvent('m1', 'user', 'source collision must lose', '2026-04-20T10:00:00.000Z'),
      makeEvent('m2', 'assistant', 'source addition', '2026-04-20T10:01:00.000Z', 0)
    ]
  })
  writeJson(sourceB, HISTORY_DIR, '9001', {
    contact_id: '9001',
    thread_id: '9001',
    instagram_username: 'real.client',
    events: [
      makeEvent('m2', 'assistant', 'source addition', '2026-04-20T10:01:00.000Z', 0),
      makeEvent('m3', 'user', 'second source addition', '2026-04-20T10:02:00.000Z')
    ]
  })
  writeJson(target, HISTORY_DIR, '9001', {
    contact_id: '9001',
    thread_id: '9001',
    instagram_username: 'real.client',
    events: [
      makeEvent('m1', 'user', 'live collision wins', '2026-04-20T10:00:30.000Z')
    ]
  })

  writeJson(sourceA, HISTORY_DIR, '9003', {
    contact_id: '9003',
    thread_id: '9003',
    events: [makeEvent('m4', 'user', 'source-only event', '2026-04-20T11:00:00.000Z')]
  })

  // The exact canonical username/contact pair is excluded. Username-only and
  // contact-mismatched records below exercise preservation of real customers.
  writeJson(sourceA, STATE_DIR, '1537753982', {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    text: 'debug state must be excluded',
    received_at: '2026-05-03T10:00:00.000Z'
  })
  writeJson(sourceA, HISTORY_DIR, '1537753982', {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    events: [makeEvent('debug-1', 'user', 'debug history must be excluded', '2026-05-03T10:00:00.000Z')]
  })
  writeJson(sourceB, STATE_DIR, '9004', {
    contact_id: '9004',
    thread_id: '9004',
    instagram_username: 'omal.system',
    text: 'username-only mismatch must be restored',
    received_at: '2026-05-03T10:00:00.000Z'
  })
  writeJson(sourceB, HISTORY_DIR, '9004', {
    contact_id: '9004',
    thread_id: '9004',
    instagram_username: 'omal.system',
    events: [makeEvent('debug-2', 'user', 'username-only mismatch must be restored', '2026-05-03T10:00:00.000Z')]
  })
  // Identity evidence from separate records must not be aggregated into a
  // destructive pair, and this different contact ID must remain recoverable.
  writeJson(sourceA, STATE_DIR, '9006', {
    contact_id: '9006',
    thread_id: '9006',
    text: 'nested username-only mismatch must be restored'
  })
  writeJson(sourceB, HISTORY_DIR, '9006', {
    contact_id: '9006',
    thread_id: '9006',
    events: [{
      role: 'user',
      message_id: 'debug-nested',
      at: '2026-05-03T10:00:00.000Z',
      sender: { username: 'omar.system' }
    }]
  })
  writeJson(target, STATE_DIR, '1537753982', {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    text: 'existing debug sentinel',
    received_at: '2026-05-04T10:00:00.000Z'
  })
  writeJson(target, HISTORY_DIR, '1537753982', {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    events: [makeEvent('debug-live', 'user', 'existing debug sentinel', '2026-05-04T10:00:00.000Z')]
  })
  writeJson(sourceA, STATE_DIR, 'synthetic-probe', {
    contact_id: 'synthetic-probe',
    thread_id: 'synthetic-probe',
    instagram_username: 'probe.account',
    text: 'non-debug historical memory must be preserved'
  })
  writeJson(sourceA, HISTORY_DIR, 'synthetic-probe', {
    contact_id: 'synthetic-probe',
    thread_id: 'synthetic-probe',
    events: [makeEvent('probe-1', 'user', 'non-debug historical memory must be preserved', '2026-05-03T10:00:00.000Z')]
  })

  fs.mkdirSync(path.join(target, 'inbox'), { recursive: true })
  fs.mkdirSync(path.join(target, 'outbox'), { recursive: true })
  fs.writeFileSync(path.join(target, 'inbox', 'queue-sentinel.json'), '{"keep":true}\n')
  fs.writeFileSync(path.join(target, 'outbox', 'queue-sentinel.json'), '{"keep":true}\n')

  return { sourceA, sourceB, target }
}

function emptyMemoryRoot(root) {
  fs.mkdirSync(path.join(root, STATE_DIR), { recursive: true })
  fs.mkdirSync(path.join(root, HISTORY_DIR), { recursive: true })
  return root
}

function buildConflictFixture(root) {
  const sourceA = emptyMemoryRoot(path.join(root, 'conflict-source-a'))
  const sourceB = emptyMemoryRoot(path.join(root, 'conflict-source-b'))
  const target = emptyMemoryRoot(path.join(root, 'conflict-target'))
  const events = [
    makeEvent('temporal', 'user', 'same inbound', '2026-04-21T17:15:25.730Z'),
    makeEvent('temporal', 'user', 'same inbound', '2026-04-21T17:15:25.736Z'),
    makeEvent('attempt', 'assistant_attempted', 'attempt one', '2026-04-25T16:47:35.264Z', 0),
    makeEvent('attempt', 'assistant_attempted', 'attempt two', '2026-04-25T16:57:29.576Z', 0)
  ]
  for (const source of [sourceA, sourceB]) {
    writeJson(source, HISTORY_DIR, '9100', {
      contact_id: '9100',
      thread_id: '9100',
      events
    })
  }
  return { sourceA, sourceB, target }
}

function buildUnresolvedConflictFixture(root) {
  const source = emptyMemoryRoot(path.join(root, 'unresolved-source'))
  const target = emptyMemoryRoot(path.join(root, 'unresolved-target'))
  writeJson(source, HISTORY_DIR, '9101', {
    contact_id: '9101',
    thread_id: '9101',
    events: [
      makeEvent('ambiguous', 'user', 'content one', '2026-04-21T17:15:25.730Z'),
      makeEvent('ambiguous', 'user', 'content two', '2026-04-21T17:15:25.730Z')
    ]
  })
  return { source, target }
}

function buildPartialDebugFixture(root) {
  const source = emptyMemoryRoot(path.join(root, 'partial-debug-source'))
  const target = emptyMemoryRoot(path.join(root, 'partial-debug-target'))
  writeJson(source, STATE_DIR, '9004', {
    contact_id: '9004',
    thread_id: '9004',
    received_at: '2026-04-20T10:00:00.000Z'
  })
  writeJson(source, HISTORY_DIR, '9004', {
    contact_id: '9004',
    thread_id: '9004',
    instagram_username: 'omal.system',
    events: []
  })
  return { source, target }
}

function buildRollbackFixture(root) {
  const source = emptyMemoryRoot(path.join(root, 'rollback-source'))
  const target = emptyMemoryRoot(path.join(root, 'rollback-target'))
  for (const id of ['9201', '9202']) {
    writeJson(source, STATE_DIR, id, {
      contact_id: id,
      thread_id: id,
      received_at: '2026-04-20T10:00:00.000Z'
    })
    writeJson(source, HISTORY_DIR, id, {
      contact_id: id,
      thread_id: id,
      events: [makeEvent(`message-${id}`, 'user', 'restore me', '2026-04-20T10:00:00.000Z')]
    })
  }
  writeJson(target, HISTORY_DIR, '9201', {
    contact_id: '9201',
    thread_id: '9201',
    events: []
  })
  return { source, target }
}

function buildCrashFixture(root, prefix = 'crash') {
  const source = emptyMemoryRoot(path.join(root, `${prefix}-source`))
  const target = emptyMemoryRoot(path.join(root, `${prefix}-target`))
  for (const id of ['9301', '9302']) {
    writeJson(source, STATE_DIR, id, {
      contact_id: id,
      thread_id: id,
      received_at: '2026-04-20T10:00:00.000Z'
    })
    writeJson(source, HISTORY_DIR, id, {
      contact_id: id,
      thread_id: id,
      events: [makeEvent(`message-${id}`, 'user', 'crash restore', '2026-04-20T10:00:00.000Z')]
    })
  }
  writeJson(target, HISTORY_DIR, '9301', {
    contact_id: '9301',
    thread_id: '9301',
    events: []
  })
  return { source, target }
}

function spawnReceiptCrash(source, target, nowIso) {
  const toolFile = path.join(__dirname, 'scv-restore-non-debug-history.js')
  const script = [
    `const fs = require('fs')`,
    `const path = require('path')`,
    `const recovery = require(${JSON.stringify(toolFile)})`,
    `const originalRename = fs.renameSync`,
    `fs.renameSync = function (sourceFile, destination) {`,
    `  const result = originalRename.apply(this, arguments)`,
    `  if (destination.includes(path.sep + recovery.RECEIPT_DIR + path.sep)) process.kill(process.pid, 'SIGKILL')`,
    `  return result`,
    `}`,
    `recovery.runRecovery({ sources: [${JSON.stringify(source)}], target: ${JSON.stringify(target)}, execute: true, env: { SCV_PAUSE_ALL: '1' }, now: new Date(${JSON.stringify(nowIso)}) })`
  ].join('\n')
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 })
}

function spawnBackupCrash(source, target, nowIso) {
  const toolFile = path.join(__dirname, 'scv-restore-non-debug-history.js')
  const script = [
    `const fs = require('fs')`,
    `const path = require('path')`,
    `const recovery = require(${JSON.stringify(toolFile)})`,
    `const originalCopy = fs.copyFileSync`,
    `let backupCopies = 0`,
    `fs.copyFileSync = function (sourceFile, destination) {`,
    `  const result = originalCopy.apply(this, arguments)`,
    `  if (destination.includes(path.sep + recovery.BACKUP_DIR + path.sep) && ++backupCopies === 1) process.kill(process.pid, 'SIGKILL')`,
    `  return result`,
    `}`,
    `recovery.runRecovery({ sources: [${JSON.stringify(source)}], target: ${JSON.stringify(target)}, execute: true, env: { SCV_PAUSE_ALL: '1' }, now: new Date(${JSON.stringify(nowIso)}) })`
  ].join('\n')
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 })
}

function buildNoOpCrashFixture(root, prefix) {
  const source = emptyMemoryRoot(path.join(root, `${prefix}-source`))
  const target = emptyMemoryRoot(path.join(root, `${prefix}-target`))
  const state = {
    contact_id: '9350',
    thread_id: '9350',
    received_at: '2026-04-20T10:00:00.000Z'
  }
  const history = {
    contact_id: '9350',
    thread_id: '9350',
    events: [makeEvent('message-9350', 'user', 'already current', '2026-04-20T10:00:00.000Z')]
  }
  for (const base of [source, target]) {
    writeJson(base, STATE_DIR, '9350', state)
    writeJson(base, HISTORY_DIR, '9350', history)
  }
  return { source, target }
}

function run() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-memory-recovery-'))
  try {
    const fixture = buildFixture(temporaryRoot)
    const fixedNow = new Date('2026-08-19T12:00:00.000Z')
    const beforeState = fs.readFileSync(path.join(fixture.target, STATE_DIR, '9001.json'), 'utf8')
    const beforeDebug = fs.readFileSync(path.join(fixture.target, STATE_DIR, '1537753982.json'), 'utf8')
    const beforeInbox = fs.readFileSync(path.join(fixture.target, 'inbox', 'queue-sentinel.json'), 'utf8')
    const beforeOutbox = fs.readFileSync(path.join(fixture.target, 'outbox', 'queue-sentinel.json'), 'utf8')

    const dryReceipt = runRecovery({
      sources: [fixture.sourceA, fixture.sourceB],
      target: fixture.target,
      now: fixedNow,
      env: {}
    })
    assert.strictEqual(dryReceipt.mode, 'dry_run')
    assert.strictEqual(dryReceipt.safety.validation_passed, true)
    assert.strictEqual(dryReceipt.safety.backup_created, false)
    assert.strictEqual(dryReceipt.counts.queue_directories_touched, 0)
    assert.strictEqual(dryReceipt.counts.excluded_debug_files, 4)
    assert.strictEqual(dryReceipt.counts.excluded_synthetic_files, 0)
    assert.strictEqual(dryReceipt.counts.state_target_preserved, 2)
    assert.strictEqual(dryReceipt.counts.history_events_seen, 9)
    assert.strictEqual(dryReceipt.counts.history_events_unique, 7)
    assert.strictEqual(dryReceipt.counts.history_events_deduped, 2)
    assert.strictEqual(dryReceipt.counts.history_event_conflict_groups_seen, 1)
    assert.strictEqual(dryReceipt.counts.history_event_target_conflict_groups_resolved, 1)
    assert.strictEqual(dryReceipt.counts.history_event_unresolved_conflict_groups, 0)
    assert.strictEqual(dryReceipt.counts.state_writes_planned, 5)
    assert.strictEqual(dryReceipt.counts.history_writes_planned, 5)
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.target, STATE_DIR, '9001.json'), 'utf8'),
      beforeState,
      'dry-run mutated target state'
    )
    assert.strictEqual(fs.existsSync(path.join(fixture.target, STATE_DIR, '9003.json')), false)
    assert.strictEqual(fs.existsSync(path.join(fixture.target, STATE_DIR, '9006.json')), false)
    assert.strictEqual(fs.existsSync(path.join(fixture.target, BACKUP_DIR)), false)
    assert.strictEqual(fs.existsSync(path.join(fixture.target, RECEIPT_DIR)), false)

    const repeatedPlanA = buildRecoveryPlan({
      sources: [fixture.sourceA, fixture.sourceB],
      target: fixture.target,
      env: {}
    })
    const repeatedPlanB = buildRecoveryPlan({
      sources: [fixture.sourceA, fixture.sourceB],
      target: fixture.target,
      env: {}
    })
    assert.deepStrictEqual(repeatedPlanA.hashes, repeatedPlanB.hashes)
    const plannedMemoryFiles = new Set(
      repeatedPlanA.writes.map((write) => `${write.kind}:${write.basename}`)
    )
    for (const basename of ['9004.json', '9006.json']) {
      assert.strictEqual(plannedMemoryFiles.has(`state:${basename}`), true)
      assert.strictEqual(plannedMemoryFiles.has(`history:${basename}`), true)
    }
    assert.strictEqual(plannedMemoryFiles.has('state:1537753982.json'), false)
    assert.strictEqual(plannedMemoryFiles.has('history:1537753982.json'), false)

    const partialDebug = buildPartialDebugFixture(temporaryRoot)
    const partialDebugPlan = buildRecoveryPlan({
      sources: [partialDebug.source],
      target: partialDebug.target,
      env: {}
    })
    assert.strictEqual(partialDebugPlan.validationPassed, true)
    assert.strictEqual(partialDebugPlan.counts.excluded_debug_files, 0)
    assert.strictEqual(partialDebugPlan.counts.state_writes_planned, 1)
    assert.strictEqual(partialDebugPlan.counts.history_writes_planned, 1)
    assert.deepStrictEqual(
      partialDebugPlan.writes.map((write) => `${write.kind}:${write.basename}`).sort(),
      ['history:9004.json', 'state:9004.json']
    )

    const conflict = buildConflictFixture(temporaryRoot)
    const conflictReceipt = runRecovery({
      sources: [conflict.sourceA, conflict.sourceB],
      target: conflict.target,
      now: fixedNow,
      env: {}
    })
    assert.strictEqual(conflictReceipt.safety.validation_passed, true)
    assert.strictEqual(conflictReceipt.counts.history_event_conflict_groups_seen, 2)
    assert.strictEqual(conflictReceipt.counts.history_event_temporal_conflict_groups_resolved, 1)
    assert.strictEqual(conflictReceipt.counts.history_event_attempt_conflict_groups_preserved, 1)
    assert.strictEqual(conflictReceipt.counts.history_event_attempt_variants_preserved, 2)
    assert.strictEqual(conflictReceipt.counts.history_event_unresolved_conflict_groups, 0)
    assert.strictEqual(conflictReceipt.counts.history_events_seen, 8)
    assert.strictEqual(conflictReceipt.counts.history_events_unique, 3)
    assert.strictEqual(conflictReceipt.counts.history_events_deduped, 5)
    const conflictPlan = buildRecoveryPlan({
      sources: [conflict.sourceA, conflict.sourceB],
      target: conflict.target,
      env: {}
    })
    const conflictEvents = conflictPlan.writes.find((write) => write.kind === 'history').value.events
    assert.strictEqual(conflictEvents.filter((event) => event.role === 'user').length, 1)
    assert.strictEqual(
      conflictEvents.find((event) => event.role === 'user').at,
      '2026-04-21T17:15:25.730Z'
    )
    assert.deepStrictEqual(
      conflictEvents.filter((event) => event.role === 'assistant_attempted').map((event) => event.text),
      ['attempt one', 'attempt two']
    )

    const unresolved = buildUnresolvedConflictFixture(temporaryRoot)
    const unresolvedReceipt = runRecovery({
      sources: [unresolved.source],
      target: unresolved.target,
      now: fixedNow,
      env: {}
    })
    assert.strictEqual(unresolvedReceipt.safety.validation_passed, false)
    assert.strictEqual(unresolvedReceipt.counts.history_event_unresolved_conflict_groups, 1)
    assert.throws(() => runRecovery({
      sources: [unresolved.source],
      target: unresolved.target,
      execute: true,
      now: fixedNow,
      env: { SCV_PAUSE_ALL: '1' }
    }), /validation failed/)
    assert.strictEqual(names(path.join(unresolved.target, HISTORY_DIR)).length, 0)
    assert.strictEqual(fs.existsSync(path.join(unresolved.target, BACKUP_DIR)), false)

    const rollback = buildRollbackFixture(temporaryRoot)
    const rollbackOriginal = fs.readFileSync(
      path.join(rollback.target, HISTORY_DIR, '9201.json'),
      'utf8'
    )
    const originalRenameSync = fs.renameSync
    let memoryRenameCount = 0
    fs.renameSync = function injectedRenameFailure(source, destination) {
      const isMemoryWrite = destination.includes(`${path.sep}${STATE_DIR}${path.sep}`) ||
        destination.includes(`${path.sep}${HISTORY_DIR}${path.sep}`)
      if (isMemoryWrite && ++memoryRenameCount === 3) {
        throw new Error('injected recovery write failure')
      }
      return originalRenameSync.apply(this, arguments)
    }
    try {
      assert.throws(() => runRecovery({
        sources: [rollback.source],
        target: rollback.target,
        execute: true,
        now: new Date('2026-08-19T12:00:01.000Z'),
        env: { SCV_PAUSE_ALL: '1' }
      }), /injected recovery write failure; recovery writes rolled back/)
    } finally {
      fs.renameSync = originalRenameSync
    }
    assert.strictEqual(
      fs.readFileSync(path.join(rollback.target, HISTORY_DIR, '9201.json'), 'utf8'),
      rollbackOriginal
    )
    assert.strictEqual(fs.existsSync(path.join(rollback.target, HISTORY_DIR, '9202.json')), false)
    assert.strictEqual(names(path.join(rollback.target, STATE_DIR)).length, 0)
    assert.strictEqual(names(path.join(rollback.target, BACKUP_DIR)).length, 0)
    assert.strictEqual(fs.existsSync(path.join(rollback.target, RECEIPT_DIR)), false)
    assert.strictEqual(
      [...names(path.join(rollback.target, STATE_DIR)), ...names(path.join(rollback.target, HISTORY_DIR))]
        .some((name) => name.endsWith('.tmp')),
      false
    )
    assert.strictEqual(fs.existsSync(path.join(rollback.target, TRANSACTION_JOURNAL)), false)

    const crash = buildCrashFixture(temporaryRoot)
    const crashOriginal = fs.readFileSync(path.join(crash.target, HISTORY_DIR, '9301.json'), 'utf8')
    const toolFile = path.join(__dirname, 'scv-restore-non-debug-history.js')
    const crashScript = [
      `const fs = require('fs')`,
      `const path = require('path')`,
      `const recovery = require(${JSON.stringify(toolFile)})`,
      `const originalRename = fs.renameSync`,
      `let memoryWrites = 0`,
      `fs.renameSync = function (source, destination) {`,
      `  const result = originalRename.apply(this, arguments)`,
      `  if ((destination.includes(path.sep + recovery.STATE_DIR + path.sep) || destination.includes(path.sep + recovery.HISTORY_DIR + path.sep)) && ++memoryWrites === 1) process.kill(process.pid, 'SIGKILL')`,
      `  return result`,
      `}`,
      `recovery.runRecovery({ sources: [${JSON.stringify(crash.source)}], target: ${JSON.stringify(crash.target)}, execute: true, env: { SCV_PAUSE_ALL: '1' }, now: new Date('2026-08-19T12:00:02.000Z') })`
    ].join('\n')
    const crashedChild = spawnSync(process.execPath, ['-e', crashScript], {
      encoding: 'utf8',
      timeout: 10000
    })
    assert.strictEqual(crashedChild.signal, 'SIGKILL')
    const crashJournal = path.join(crash.target, TRANSACTION_JOURNAL)
    assert.strictEqual(fs.existsSync(crashJournal), true)
    assert.strictEqual(fs.lstatSync(crashJournal).mode & 0o077, 0)
    assert.throws(() => runRecovery({
      sources: [crash.source],
      target: crash.target,
      env: {}
    }), /pending recovery transaction requires paused --execute rollback/)
    assert.strictEqual(fs.existsSync(crashJournal), true)
    assert.throws(() => runRecovery({
      sources: [crash.source],
      target: crash.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' }
    }), /pending recovery transaction rolled back; rerun dry-run before execute/)
    assert.strictEqual(
      fs.readFileSync(path.join(crash.target, HISTORY_DIR, '9301.json'), 'utf8'),
      crashOriginal
    )
    assert.strictEqual(fs.existsSync(path.join(crash.target, HISTORY_DIR, '9302.json')), false)
    assert.strictEqual(names(path.join(crash.target, STATE_DIR)).length, 0)
    assert.strictEqual(fs.existsSync(crashJournal), false)
    assert.strictEqual(fs.existsSync(path.join(crash.target, RECEIPT_DIR)), false)
    assert.strictEqual(names(path.join(crash.target, BACKUP_DIR)).length, 0)

    const backupCrash = buildCrashFixture(temporaryRoot, 'backup-crash')
    const backupCrashOriginal = fs.readFileSync(
      path.join(backupCrash.target, HISTORY_DIR, '9301.json'),
      'utf8'
    )
    const backupCrashAt = '2026-08-19T12:00:02.500Z'
    const backupCrashChild = spawnBackupCrash(
      backupCrash.source,
      backupCrash.target,
      backupCrashAt
    )
    assert.strictEqual(backupCrashChild.signal, 'SIGKILL')
    assert.strictEqual(
      fs.existsSync(path.join(backupCrash.target, TRANSACTION_JOURNAL)),
      true
    )
    assert.strictEqual(names(path.join(backupCrash.target, BACKUP_DIR)).length, 1)
    assert.throws(() => runRecovery({
      sources: [backupCrash.source],
      target: backupCrash.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      now: new Date(backupCrashAt)
    }), /pending recovery transaction rolled back; rerun dry-run before execute/)
    assert.strictEqual(
      fs.readFileSync(path.join(backupCrash.target, HISTORY_DIR, '9301.json'), 'utf8'),
      backupCrashOriginal
    )
    assert.strictEqual(names(path.join(backupCrash.target, BACKUP_DIR)).length, 0)
    assert.strictEqual(
      fs.existsSync(path.join(backupCrash.target, TRANSACTION_JOURNAL)),
      false
    )
    runRecovery({
      sources: [backupCrash.source],
      target: backupCrash.target,
      env: {},
      now: new Date(backupCrashAt)
    })
    const backupCrashRetry = runRecovery({
      sources: [backupCrash.source],
      target: backupCrash.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      now: new Date(backupCrashAt)
    })
    assert.strictEqual(backupCrashRetry.safety.validation_passed, true)
    assert.strictEqual(names(path.join(backupCrash.target, RECEIPT_DIR)).length, 1)

    const noOpCrash = buildNoOpCrashFixture(temporaryRoot, 'no-op-backup-crash')
    const noOpCrashAt = '2026-08-19T12:00:02.750Z'
    const noOpCrashChild = spawnBackupCrash(noOpCrash.source, noOpCrash.target, noOpCrashAt)
    assert.strictEqual(noOpCrashChild.signal, 'SIGKILL')
    assert.strictEqual(
      fs.existsSync(path.join(noOpCrash.target, TRANSACTION_JOURNAL)),
      true
    )
    assert.throws(() => runRecovery({
      sources: [noOpCrash.source],
      target: noOpCrash.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      now: new Date(noOpCrashAt)
    }), /pending recovery transaction rolled back; rerun dry-run before execute/)
    assert.strictEqual(names(path.join(noOpCrash.target, BACKUP_DIR)).length, 0)
    runRecovery({
      sources: [noOpCrash.source],
      target: noOpCrash.target,
      env: {},
      now: new Date(noOpCrashAt)
    })
    const noOpCrashRetry = runRecovery({
      sources: [noOpCrash.source],
      target: noOpCrash.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      now: new Date(noOpCrashAt)
    })
    assert.strictEqual(noOpCrashRetry.counts.writes_committed, 0)
    assert.strictEqual(names(path.join(noOpCrash.target, RECEIPT_DIR)).length, 1)

    // Compatibility with the pre-journal backup ordering: a killed older
    // executor could leave this exact timestamp directory without a journal.
    // It must be removed and rebuilt, never reused as recovery evidence.
    const orphan = buildCrashFixture(temporaryRoot, 'orphan-before-journal')
    const orphanAt = new Date('2026-08-19T12:00:02.875Z')
    const orphanToken = '2026-08-19T12-00-02-875Z'
    const orphanRoot = path.join(orphan.target, BACKUP_DIR, orphanToken)
    fs.mkdirSync(path.join(orphanRoot, HISTORY_DIR), { recursive: true })
    fs.copyFileSync(
      path.join(orphan.target, HISTORY_DIR, '9301.json'),
      path.join(orphanRoot, HISTORY_DIR, '9301.json')
    )
    const orphanMarker = path.join(orphanRoot, 'untrusted-orphan-marker')
    fs.writeFileSync(orphanMarker, 'must-not-be-reused')
    const orphanRetry = runRecovery({
      sources: [orphan.source],
      target: orphan.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      now: orphanAt
    })
    assert.strictEqual(orphanRetry.safety.validation_passed, true)
    assert.strictEqual(fs.existsSync(orphanMarker), false)
    assert.strictEqual(fs.existsSync(path.join(orphan.target, TRANSACTION_JOURNAL)), false)
    assert.strictEqual(names(path.join(orphan.target, RECEIPT_DIR)).length, 1)

    const noOpOrphan = buildNoOpCrashFixture(temporaryRoot, 'no-op-orphan-before-journal')
    const noOpOrphanAt = new Date('2026-08-19T12:00:02.900Z')
    const noOpOrphanToken = '2026-08-19T12-00-02-900Z'
    const noOpOrphanRoot = path.join(noOpOrphan.target, BACKUP_DIR, noOpOrphanToken)
    fs.mkdirSync(path.join(noOpOrphanRoot, STATE_DIR), { recursive: true })
    fs.copyFileSync(
      path.join(noOpOrphan.target, STATE_DIR, '9350.json'),
      path.join(noOpOrphanRoot, STATE_DIR, '9350.json')
    )
    const noOpOrphanMarker = path.join(noOpOrphanRoot, 'untrusted-zero-write-marker')
    fs.writeFileSync(noOpOrphanMarker, 'must-not-be-reused')
    const noOpOrphanRetry = runRecovery({
      sources: [noOpOrphan.source],
      target: noOpOrphan.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      now: noOpOrphanAt
    })
    assert.strictEqual(noOpOrphanRetry.counts.writes_committed, 0)
    assert.strictEqual(fs.existsSync(noOpOrphanMarker), false)
    assert.strictEqual(fs.existsSync(path.join(noOpOrphan.target, TRANSACTION_JOURNAL)), false)
    assert.strictEqual(names(path.join(noOpOrphan.target, RECEIPT_DIR)).length, 1)

    const receiptFailure = buildCrashFixture(temporaryRoot, 'receipt-failure')
    const receiptFailureOriginal = fs.readFileSync(
      path.join(receiptFailure.target, HISTORY_DIR, '9301.json'),
      'utf8'
    )
    const receiptFailureRename = fs.renameSync
    fs.renameSync = function injectedReceiptFailure(source, destination) {
      if (destination.includes(`${path.sep}${RECEIPT_DIR}${path.sep}`)) {
        receiptFailureRename.apply(this, arguments)
        throw new Error('injected receipt write failure')
      }
      return receiptFailureRename.apply(this, arguments)
    }
    try {
      assert.throws(() => runRecovery({
        sources: [receiptFailure.source],
        target: receiptFailure.target,
        execute: true,
        env: { SCV_PAUSE_ALL: '1' },
        now: new Date('2026-08-19T12:00:03.000Z')
      }), /injected receipt write failure; receipt failure recovery writes rolled back/)
    } finally {
      fs.renameSync = receiptFailureRename
    }
    assert.strictEqual(
      fs.readFileSync(path.join(receiptFailure.target, HISTORY_DIR, '9301.json'), 'utf8'),
      receiptFailureOriginal
    )
    assert.strictEqual(fs.existsSync(path.join(receiptFailure.target, HISTORY_DIR, '9302.json')), false)
    assert.strictEqual(names(path.join(receiptFailure.target, STATE_DIR)).length, 0)
    assert.strictEqual(fs.existsSync(path.join(receiptFailure.target, TRANSACTION_JOURNAL)), false)
    assert.strictEqual(names(path.join(receiptFailure.target, RECEIPT_DIR)).length, 0)
    assert.strictEqual(names(path.join(receiptFailure.target, BACKUP_DIR)).length, 0)

    const committedCrash = buildCrashFixture(temporaryRoot, 'committed-crash')
    const committedCrashOriginal = fs.readFileSync(
      path.join(committedCrash.target, HISTORY_DIR, '9301.json'),
      'utf8'
    )
    const committedCrashChild = spawnReceiptCrash(
      committedCrash.source,
      committedCrash.target,
      '2026-08-19T12:00:06.000Z'
    )
    assert.strictEqual(committedCrashChild.signal, 'SIGKILL')
    const committedJournal = path.join(committedCrash.target, TRANSACTION_JOURNAL)
    assert.strictEqual(fs.existsSync(committedJournal), true)
    assert.strictEqual(names(path.join(committedCrash.target, RECEIPT_DIR)).length, 1)
    const committedOutput = path.join(committedCrash.target, HISTORY_DIR, '9301.json')
    const committedOutputHash = fileSha256(committedOutput)
    assert.notStrictEqual(fs.readFileSync(committedOutput, 'utf8'), committedCrashOriginal)
    assert.throws(() => runRecovery({
      sources: [committedCrash.source],
      target: committedCrash.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' }
    }), /pending committed recovery finalized; rerun dry-run before execute/)
    assert.strictEqual(fileSha256(committedOutput), committedOutputHash)
    assert.strictEqual(names(path.join(committedCrash.target, STATE_DIR)).length, 2)
    assert.strictEqual(names(path.join(committedCrash.target, HISTORY_DIR)).length, 2)
    assert.strictEqual(names(path.join(committedCrash.target, RECEIPT_DIR)).length, 1)
    assert.strictEqual(fs.existsSync(committedJournal), false)

    const mismatchedCrash = buildCrashFixture(temporaryRoot, 'mismatched-crash')
    const mismatchedCrashChild = spawnReceiptCrash(
      mismatchedCrash.source,
      mismatchedCrash.target,
      '2026-08-19T12:00:07.000Z'
    )
    assert.strictEqual(mismatchedCrashChild.signal, 'SIGKILL')
    const mismatchedJournal = path.join(mismatchedCrash.target, TRANSACTION_JOURNAL)
    const mismatchedOutput = path.join(mismatchedCrash.target, STATE_DIR, '9301.json')
    const mismatchedValue = JSON.parse(fs.readFileSync(mismatchedOutput, 'utf8'))
    mismatchedValue.unexpected_mutation = true
    fs.writeFileSync(mismatchedOutput, `${JSON.stringify(mismatchedValue, null, 2)}\n`)
    const mismatchedHash = fileSha256(mismatchedOutput)
    assert.throws(() => runRecovery({
      sources: [mismatchedCrash.source],
      target: mismatchedCrash.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' }
    }), /pending committed recovery output hash mismatch/)
    assert.strictEqual(fileSha256(mismatchedOutput), mismatchedHash)
    assert.strictEqual(fs.existsSync(mismatchedJournal), true)
    assert.strictEqual(names(path.join(mismatchedCrash.target, RECEIPT_DIR)).length, 1)

    const maliciousSource = emptyMemoryRoot(path.join(temporaryRoot, 'malicious-source'))
    const maliciousTarget = emptyMemoryRoot(path.join(temporaryRoot, 'malicious-target'))
    const outsideSentinel = path.join(temporaryRoot, 'escape.json')
    fs.writeFileSync(outsideSentinel, '{"keep":true}\n')
    writePrivateJournal(maliciousTarget, {
      schema: 'scv_non_debug_history_recovery_transaction_v1',
      backup_token: '2026-08-19T12-00-04-000Z',
      plan_sha256: 'a'.repeat(64),
      writes: [{
        kind: 'state',
        basename: '../escape.json',
        original_sha256: null,
        output_sha256: 'b'.repeat(64)
      }]
    })
    assert.throws(() => runRecovery({
      sources: [maliciousSource],
      target: maliciousTarget,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' }
    }), /unsafe memory filename|invalid recovery transaction/)
    assert.strictEqual(fs.readFileSync(outsideSentinel, 'utf8'), '{"keep":true}\n')
    assert.strictEqual(fs.existsSync(path.join(maliciousTarget, TRANSACTION_JOURNAL)), true)

    const unknownSource = emptyMemoryRoot(path.join(temporaryRoot, 'unknown-source'))
    const unknownTarget = emptyMemoryRoot(path.join(temporaryRoot, 'unknown-target'))
    writeJson(unknownTarget, STATE_DIR, '9400', {
      contact_id: '9400',
      thread_id: '9400',
      received_at: '2026-04-20T10:00:00.000Z'
    })
    const unknownFile = path.join(unknownTarget, STATE_DIR, '9400.json')
    const unknownBefore = fileSha256(unknownFile)
    const unknownToken = '2026-08-19T12-00-05-000Z'
    fs.mkdirSync(path.join(unknownTarget, BACKUP_DIR, unknownToken), { recursive: true })
    writePrivateJournal(unknownTarget, {
      schema: 'scv_non_debug_history_recovery_transaction_v1',
      backup_token: unknownToken,
      plan_sha256: 'c'.repeat(64),
      writes: [{
        kind: 'state',
        basename: '9400.json',
        original_sha256: 'd'.repeat(64),
        output_sha256: 'e'.repeat(64)
      }]
    })
    assert.throws(() => runRecovery({
      sources: [unknownSource],
      target: unknownTarget,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' }
    }), /unknown mutation/)
    assert.strictEqual(fileSha256(unknownFile), unknownBefore)
    assert.strictEqual(fs.existsSync(path.join(unknownTarget, TRANSACTION_JOURNAL)), true)

    const symlinkTarget = path.join(temporaryRoot, 'live-symlink-target')
    const persistentRoot = path.join(temporaryRoot, 'persistent-volume')
    const persistentNamespace = path.join(persistentRoot, 'scv-runtime-namespaces', 'prod')
    fs.mkdirSync(symlinkTarget, { recursive: true })
    for (const directoryName of [STATE_DIR, HISTORY_DIR]) {
      fs.mkdirSync(path.join(persistentNamespace, directoryName), { recursive: true })
      fs.symlinkSync(path.join(persistentNamespace, directoryName), path.join(symlinkTarget, directoryName))
    }
    const symlinkPlan = buildRecoveryPlan({
      sources: [fixture.sourceA],
      target: symlinkTarget,
      env: { SCV_PERSIST_ROOT: persistentRoot, SCV_RUNTIME_NAMESPACE: 'prod' }
    })
    assert.strictEqual(symlinkPlan.validationPassed, true)
    assert.strictEqual(symlinkPlan.artifactRoot, fs.realpathSync(persistentNamespace))
    const symlinkExecuteReceipt = runRecovery({
      sources: [fixture.sourceA],
      target: symlinkTarget,
      execute: true,
      now: new Date('2026-08-19T12:01:00.000Z'),
      env: {
        SCV_PAUSE_ALL: '1',
        SCV_PERSIST_ROOT: persistentRoot,
        SCV_RUNTIME_NAMESPACE: 'prod'
      }
    })
    assert.strictEqual(symlinkExecuteReceipt.mode, 'execute')
    assert.strictEqual(fs.existsSync(path.join(symlinkTarget, BACKUP_DIR)), false)
    assert.strictEqual(fs.existsSync(path.join(symlinkTarget, RECEIPT_DIR)), false)
    assert.strictEqual(names(path.join(persistentNamespace, BACKUP_DIR)).length, 1)
    assert.strictEqual(names(path.join(persistentNamespace, RECEIPT_DIR)).length, 1)
    assert.strictEqual(fs.existsSync(path.join(persistentNamespace, TRANSACTION_JOURNAL)), false)
    const wrongTarget = path.join(temporaryRoot, 'wrong-symlink-target')
    fs.mkdirSync(wrongTarget, { recursive: true })
    fs.symlinkSync(path.join(persistentNamespace, STATE_DIR), path.join(wrongTarget, STATE_DIR))
    fs.symlinkSync(path.join(persistentRoot, 'wrong-history'), path.join(wrongTarget, HISTORY_DIR))
    fs.mkdirSync(path.join(persistentRoot, 'wrong-history'), { recursive: true })
    assert.throws(() => buildRecoveryPlan({
      sources: [fixture.sourceA],
      target: wrongTarget,
      env: { SCV_PERSIST_ROOT: persistentRoot, SCV_RUNTIME_NAMESPACE: 'prod' }
    }), /symlink target mismatch/)

    assert.throws(() => runRecovery({
      sources: [fixture.sourceA, fixture.sourceB],
      target: fixture.target,
      execute: true,
      env: {},
      now: fixedNow
    }), /SCV_PAUSE_ALL=1/)

    const executeReceipt = runRecovery({
      sources: [fixture.sourceA, fixture.sourceB],
      target: fixture.target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      now: fixedNow
    })
    assert.strictEqual(executeReceipt.mode, 'execute')
    assert.strictEqual(executeReceipt.safety.pause_all_verified, true)
    assert.strictEqual(executeReceipt.safety.backup_created, true)
    assert.strictEqual(executeReceipt.counts.writes_committed, 10)
    assert.strictEqual(fs.existsSync(path.join(fixture.target, TRANSACTION_JOURNAL)), false)
    assert.strictEqual(readJson(fixture.target, STATE_DIR, '9001').text, 'archive newest state')
    assert.strictEqual(readJson(fixture.target, STATE_DIR, '9002').text, 'new live state wins')
    assert.strictEqual(readJson(fixture.target, STATE_DIR, '9003').text, 'restored source state')
    assert.strictEqual(readJson(fixture.target, STATE_DIR, '9005').text, 'unknown-time live state wins')

    const mergedHistory = readJson(fixture.target, HISTORY_DIR, '9001')
    assert.deepStrictEqual(mergedHistory.events.map((event) => event.message_id), ['m1', 'm2', 'm3'])
    assert.strictEqual(mergedHistory.events[0].text, 'live collision wins')
    assert.strictEqual(mergedHistory.events[1].text, 'source addition')
    assert.strictEqual(
      readJson(fixture.target, STATE_DIR, '9004').text,
      'username-only mismatch must be restored'
    )
    assert.deepStrictEqual(
      readJson(fixture.target, HISTORY_DIR, '9004').events.map((event) => event.message_id),
      ['debug-2']
    )
    assert.strictEqual(
      readJson(fixture.target, STATE_DIR, '9006').text,
      'nested username-only mismatch must be restored'
    )
    assert.deepStrictEqual(
      readJson(fixture.target, HISTORY_DIR, '9006').events.map((event) => event.message_id),
      ['debug-nested']
    )
    assert.strictEqual(
      readJson(fixture.target, STATE_DIR, 'synthetic-probe').text,
      'non-debug historical memory must be preserved'
    )
    assert.deepStrictEqual(
      readJson(fixture.target, HISTORY_DIR, 'synthetic-probe').events.map((event) => event.message_id),
      ['probe-1']
    )
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.target, STATE_DIR, '1537753982.json'), 'utf8'),
      beforeDebug,
      'existing debug state was mutated'
    )
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.target, 'inbox', 'queue-sentinel.json'), 'utf8'),
      beforeInbox,
      'inbox queue was touched'
    )
    assert.strictEqual(
      fs.readFileSync(path.join(fixture.target, 'outbox', 'queue-sentinel.json'), 'utf8'),
      beforeOutbox,
      'outbox queue was touched'
    )

    const backupRoots = names(path.join(fixture.target, BACKUP_DIR))
    assert.strictEqual(backupRoots.length, 1)
    const backupRoot = path.join(fixture.target, BACKUP_DIR, backupRoots[0])
    assert.strictEqual(fs.existsSync(path.join(backupRoot, STATE_DIR, '9001.json')), true)
    assert.strictEqual(fs.existsSync(path.join(backupRoot, HISTORY_DIR, '9001.json')), true)
    assert.strictEqual(names(path.join(fixture.target, RECEIPT_DIR)).length, 1)
    assert.strictEqual(
      names(path.join(fixture.target, STATE_DIR)).some((name) => name.endsWith('.tmp')),
      false
    )
    assertReceiptIsPiiFree(executeReceipt, [
      '9001',
      '9003',
      '9004',
      '9006',
      '1537753982',
      'omar.system',
      'omal.system',
      'archive newest state',
      'live collision wins',
      temporaryRoot
    ])

    const invalidSource = path.join(temporaryRoot, 'invalid-source')
    const invalidTarget = path.join(temporaryRoot, 'invalid-target')
    fs.mkdirSync(path.join(invalidSource, STATE_DIR), { recursive: true })
    fs.mkdirSync(path.join(invalidSource, HISTORY_DIR), { recursive: true })
    fs.mkdirSync(path.join(invalidTarget, STATE_DIR), { recursive: true })
    fs.mkdirSync(path.join(invalidTarget, HISTORY_DIR), { recursive: true })
    fs.writeFileSync(path.join(invalidSource, STATE_DIR, 'broken.json'), '{not-json')
    const invalidReceipt = runRecovery({
      sources: [invalidSource],
      target: invalidTarget,
      now: fixedNow,
      env: {}
    })
    assert.strictEqual(invalidReceipt.safety.validation_passed, false)
    assert.strictEqual(invalidReceipt.counts.invalid_json_files, 1)
    assert.throws(() => runRecovery({
      sources: [invalidSource],
      target: invalidTarget,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      now: fixedNow
    }), /validation failed/)
    assert.strictEqual(names(path.join(invalidTarget, STATE_DIR)).length, 0)
    assert.strictEqual(fs.existsSync(path.join(invalidTarget, BACKUP_DIR)), false)

    process.stdout.write(`${JSON.stringify({
      ok: true,
      checks: 160,
      dry_run_receipt_sha256: dryReceipt.hashes.receipt_sha256,
      execute_receipt_sha256: executeReceipt.hashes.receipt_sha256
    })}\n`)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

run()
