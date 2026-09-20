#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const binary = path.resolve(process.argv[2] ?? 'release/stage/usr/local/bin/os1');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'os1-fixture-isolation-'));
try {
  const files = { OS1_ACTIVITY_FILE: path.join(root, 'activity'), OS1_EVENT_JOURNAL: path.join(root, 'journal') };
  const sentinel = 'owner telemetry must survive fixture execution\n';
  for (const file of Object.values(files)) fs.writeFileSync(file, sentinel, { mode: 0o600 });
  const result = spawnSync(binary, ['self-test'], {
    env: { ...process.env, ...files }, encoding: 'utf8', timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr + result.stdout);
  for (const file of Object.values(files)) assert.equal(fs.readFileSync(file, 'utf8'), sentinel);
  console.log('PASS: self-test cannot write fixture auth/quota events into owner activity or journal');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
