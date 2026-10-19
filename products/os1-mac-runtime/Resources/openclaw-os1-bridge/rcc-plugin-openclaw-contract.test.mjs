// The pinned OpenClaw direct-completion contract the local model calls rely on
// (intent resolution and an explicit local route pass a JSON responseFormat).
// Build 407 removed the local planner; this contract check outlives it.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

test('pinned OpenClaw 2026.9.9 contract exposes direct responseFormat and Ollama native format', async t => {
  const dist = join(homedir(), 'Library/Application Support/OS-1/tools/openclaw-2026.9.9',
    'node_modules/openclaw/dist');
  let types, stream;
  try {
    types = await readFile(join(dist, 'types-DuAVdnLS.d.ts'), 'utf8');
    stream = await readFile(join(dist, 'stream.runtime-BPTCQ6OM.mjs'), 'utf8');
  } catch { t.skip('pinned OpenClaw bundle not installed on this runner'); return; }
  const direct = types.slice(types.indexOf('type LlmDirectCompleteParams ='),
    types.indexOf('type LlmIsolatedAgentRuntimeCompleteParams ='));
  const subagent = types.slice(types.indexOf('type SubagentCompleteParams ='),
    types.indexOf('type PluginManagedWorktree ='));
  assert.ok(direct.includes('responseFormat?: Record<string, unknown>;'));
  assert.equal(subagent.includes('responseFormat'), false);
  assert.ok(stream.includes('function resolveOllamaResponseFormat('));
  assert.ok(stream.includes('format: responseFormat'));
});
