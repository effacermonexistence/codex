import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

const MAX_CONTRACT_BYTES = 65536;
const MAX_POLICY_BYTES = 24000;
const MAX_OBJECTIVE_BYTES = 4096;
const HEX64 = /^[a-f0-9]{64}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const STAGES = new Set(['ingress', 'plan', 'route', 'execute', 'verify', 'adopt']);
const TOOL = 'os1_state_read';
const fail = (reason = 'contract_unavailable') => ({
  outcome: 'block', reason, message: 'OS-1 local controller contract was not verified; no model run was started.'
});
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');

/** The host chooses a private, immutable per-run file and passes its SHA-256.
 * This code never reads an arbitrary path provided by the model. */
export async function readContract(env = process.env) {
  const file = env.OS1_AGENT_CONTRACT_PATH;
  const expected = env.OS1_AGENT_CONTRACT_SHA256;
  if (!file || !file.startsWith('/') || !HEX64.test(expected ?? '')) throw Error('contract_locator_invalid');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size < 32 || st.size > MAX_CONTRACT_BYTES || (st.mode & 0o077) !== 0)
      throw Error('contract_file_invalid');
    const bytes = Buffer.alloc(st.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw Error('contract_short_read');
      offset += bytesRead;
    }
    if (digest(bytes) !== expected) throw Error('contract_digest_mismatch');
    const c = JSON.parse(bytes.toString('utf8'));
    if (!exactKeys(c, ['schema', 'run_id', 'session_id', 'request_sha256', 'policy_source_sha256',
      'policy_sha256', 'policy', 'state'])) throw Error('contract_shape_invalid');
    if (c.schema !== 1 || !RUN_ID.test(c.run_id) || !RUN_ID.test(c.session_id) ||
      !HEX64.test(c.request_sha256) || !HEX64.test(c.policy_source_sha256) ||
      !HEX64.test(c.policy_sha256) || typeof c.policy !== 'string' ||
      Buffer.byteLength(c.policy, 'utf8') < 1 || Buffer.byteLength(c.policy, 'utf8') > MAX_POLICY_BYTES ||
      digest(Buffer.from(c.policy, 'utf8')) !== c.policy_sha256) throw Error('contract_identity_invalid');
    const s = c.state;
    const baseStateKeys = ['objective', 'stage', 'eligible_candidate_ids', 'quality_claim'];
    const expectedStateKeys = s?.stage === 'route' ? [...baseStateKeys, 'route_options'] : baseStateKeys;
    if (!exactKeys(s, expectedStateKeys) ||
      typeof s.objective !== 'string' || !s.objective.trim() ||
      Buffer.byteLength(s.objective, 'utf8') > MAX_OBJECTIVE_BYTES ||
      !STAGES.has(s.stage) || s.quality_claim !== 'unverified' ||
      !Array.isArray(s.eligible_candidate_ids) || s.eligible_candidate_ids.length > 64 ||
      s.eligible_candidate_ids.some(x => typeof x !== 'string' || !RUN_ID.test(x)) ||
      new Set(s.eligible_candidate_ids).size !== s.eligible_candidate_ids.length) {
      throw Error('contract_state_invalid');
    }
    if (s.stage === 'route') {
      const rows = s.route_options;
      if (!Array.isArray(rows) || rows.length < 1 || rows.length !== s.eligible_candidate_ids.length ||
          rows.some((row, index) => !exactKeys(row,
            ['id', 'logical_surface', 'lane', 'transport', 'capabilities', 'quota_pool', 'quality_state']) ||
            row.id !== s.eligible_candidate_ids[index] ||
            !['consumer_chatgpt', 'codex_agent', 'claude_chat', 'claude_agent', 'local'].includes(row.logical_surface) ||
            !['agent', 'bounded_chat', 'consumer_chat', 'local'].includes(row.lane) ||
            !['local', 'codex_app_server', 'claude_cli', 'chatgpt_service', 'claude_service'].includes(row.transport) ||
            !['none', 'unknown', 'openai_codex', 'openai_chat', 'anthropic_shared'].includes(row.quota_pool) ||
            !['policy_admitted', 'exact_domain_verified', 'reference_equivalent', 'reference_above', 'unverified', 'mismatch'].includes(row.quality_state) ||
            !Array.isArray(row.capabilities) || row.capabilities.length > 16 ||
            row.capabilities.some(v => typeof v !== 'string' || !v || Buffer.byteLength(v, 'utf8') > 64))) {
        throw Error('contract_route_inventory_invalid');
      }
    }
    return c;
  } finally { await handle.close(); }
}

async function writeGateReceipt(c, env = process.env) {
  const file = env.OS1_AGENT_GATE_RECEIPT_PATH;
  const contractPath = env.OS1_AGENT_CONTRACT_PATH;
  if (!file || !contractPath || dirname(file) !== dirname(contractPath) ||
      basename(file) !== 'gate-receipt.json') throw Error('gate_receipt_path_invalid');
  const receipt = {
    schema: 1, run_id: c.run_id, session_id: c.session_id,
    request_sha256: c.request_sha256, policy_sha256: c.policy_sha256,
    contract_sha256: env.OS1_AGENT_CONTRACT_SHA256,
    gate: 'before_agent_run_passed', model_invoked: false
  };
  const encoded = JSON.stringify(receipt);
  let handle;
  try {
    handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(encoded); await handle.sync(); }
    finally { await handle.close(); }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    // A prompt rebuild may rerun the gate. Accept only the identical existing
    // receipt, never overwrite or inherit one from another attempt.
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.size > 2048 || (st.mode & 0o077) !== 0 ||
          (await handle.readFile('utf8')) !== encoded) throw Error('gate_receipt_conflict');
    } finally { await handle.close(); }
  }
}

export function systemFragment(c) {
  return `OS-1 governed local run ${c.run_id} policy ${c.policy_sha256}\n${c.policy}`;
}

export default {
  id: 'os1-bridge',
  name: 'OS-1 Typed State Bridge',
  description: 'Host-bound policy and one read-only typed state tool',
  register(api) {
    // This modifier may fail open in OpenClaw; the following gate MUST be present.
    api.on('before_prompt_build', async () => {
      const contract = await readContract();
      return { appendSystemContext: systemFragment(contract), toolsAllow: [TOOL] };
    }, { priority: 1000 });
    api.on('before_agent_run', async (event) => {
      try {
        const contract = await readContract();
        if (digest(Buffer.from(event.prompt ?? '', 'utf8')) !== contract.request_sha256 ||
            typeof event.systemPrompt !== 'string' ||
            !event.systemPrompt.includes(systemFragment(contract))) return fail('policy_or_request_not_bound');
        await writeGateReceipt(contract);
        return { outcome: 'pass' };
      } catch { return fail(); }
    }, { priority: 1000 });
    api.on('before_tool_call', async (event) => {
      // Defense in depth: global config also selects ONLY this tool.
      if (event.toolName !== TOOL) return { block: true, blockReason: 'os1_tool_not_authorized' };
      try { await readContract(); return; } catch { return { block: true, blockReason: 'os1_contract_not_current' }; }
    }, { priority: 1000 });
    api.registerTool({
      name: TOOL,
      label: 'Read OS-1 run state',
      description: 'Read the exact OS-1-approved state snapshot for this run. It cannot execute work, access files, grant permission or change model routing.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: {
        type: 'object', additionalProperties: false,
        required: ['run_id', 'session_id', 'request_sha256', 'policy_sha256', 'objective', 'stage', 'eligible_candidate_ids', 'route_options', 'quality_claim'],
        properties: {
          run_id: { type: 'string' }, session_id: { type: 'string' }, request_sha256: { type: 'string' },
          policy_sha256: { type: 'string' }, objective: { type: 'string' }, stage: { type: 'string' },
          eligible_candidate_ids: { type: 'array', items: { type: 'string' } },
          route_options: { type: 'array', items: { type: 'object', additionalProperties: false,
            required: ['id', 'logical_surface', 'lane', 'transport', 'capabilities', 'quota_pool', 'quality_state'],
            properties: { id: { type: 'string' }, logical_surface: { type: 'string' }, lane: { type: 'string' },
              transport: { type: 'string' }, capabilities: { type: 'array', items: { type: 'string' } },
              quota_pool: { type: 'string' }, quality_state: { type: 'string' } } } },
          quality_claim: { const: 'unverified' }
        }
      },
      async execute(_toolCallId, _params, signal) {
        signal?.throwIfAborted?.();
        const c = await readContract();
        signal?.throwIfAborted?.();
        const details = {
          run_id: c.run_id, session_id: c.session_id, request_sha256: c.request_sha256,
          policy_sha256: c.policy_sha256, objective: c.state.objective, stage: c.state.stage,
          eligible_candidate_ids: c.state.eligible_candidate_ids, route_options: c.state.route_options ?? [],
          quality_claim: 'unverified'
        };
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
      }
    }, { name: TOOL, optional: true });
  }
};
