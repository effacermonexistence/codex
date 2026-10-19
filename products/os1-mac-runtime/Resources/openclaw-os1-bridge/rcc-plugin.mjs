import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, writeFile, readFile, chmod, unlink } from 'node:fs/promises';
import { join, dirname, basename, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { AsyncResource } from 'node:async_hooks';
import { createRCCRuntime, effectiveExplicitRoutes, explicitRouteNodeID, explicitTierRouting,
  localWorkerRow, RCCRuntimeError } from './rcc-runtime.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const LOCAL_MODEL = 'ollama/qwen3.5:4b';

async function verifyNative() {
  const file = process.env.OS1_RCC_NATIVE_PATH;
  const expected = process.env.OS1_RCC_NATIVE_SHA256;
  if (!isAbsolute(file ?? '') || !HASH.test(expected ?? '')) throw Error('native_identity_unavailable');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > 200_000_000 || sha(await handle.readFile()) !== expected)
      throw Error('native_identity_changed');
  } finally { await handle.close(); }
  return file;
}

/** One exact native transport operation. No shell, PATH command resolution,
 * fallback account, routing decision, API key, or autonomous retry. */
export async function nativeOperation(operation, payload, signal,
                                      {cancelGraceMs = 6_000, cancelKillMs = 2_000} = {}) {
  if (!['rcc-intent', 'rcc-catalog', 'rcc-adapter', 'rcc-stage', 'rcc-install-status',
    'rcc-install-cancel', 'rcc-quality-decision'].includes(operation)) throw Error('native_operation_denied');
  if (!Number.isSafeInteger(cancelGraceMs) || cancelGraceMs < 100 || cancelGraceMs > 30_000 ||
      !Number.isSafeInteger(cancelKillMs) || cancelKillMs < 100 || cancelKillMs > 10_000)
    throw Error('native_cancel_bounds_invalid');
  const native = await verifyNative();
  const root = process.env.OS1_RCC_STATE_ROOT;
  if (!isAbsolute(root ?? '')) throw Error('state_root_unavailable');
  const inputs = join(root, 'native-inputs');
  await mkdir(inputs, { recursive: true, mode: 0o700 }); await chmod(inputs, 0o700);
  const file = join(inputs, `${randomUUID()}.json`);
  const cancelFile = file + '.cancel';
  await writeFile(file, JSON.stringify(payload), { flag: 'wx', mode: 0o600 });
  const home = process.env.OS1_RCC_NATIVE_HOME;
  if (!isAbsolute(home ?? '')) throw Error('native_home_unavailable');
  // The native executor must not inherit the Gateway token/config locator,
  // planner runtime or an ambient credential/account override.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['PATH', 'USER', 'LOGNAME', 'TMPDIR', 'LANG'].includes(key) || key.startsWith('LC_')));
  env.HOME = home; env.OS1_RCC_ADAPTER_CHILD = '1';
  // ExecutionCancellation in the native CLI already polls this exact marker.
  // It must reach that CLI but never another unrelated provider/session.
  const cancellable = operation === 'rcc-adapter' || operation === 'rcc-stage';
  if (cancellable) env.OS1_CANCEL_FILE = cancelFile;
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_AUTH_TOKEN']) delete env[key];
  const flag = operation === 'rcc-adapter' || operation === 'rcc-stage' ? '--ticket-file' : '--request-file';
  let markerWrite = Promise.resolve();
  let abortObserved = false;
  try {
    return await new Promise((resolve, reject) => {
      let output = Buffer.alloc(0), stderr = Buffer.alloc(0), overflow = false;
      const child = spawn(native, [operation, flag, file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let closed = false, processExited = false, cancelRequested = false, graceTimer, killTimer;
      const clearCancellation = () => {
        closed = true;
        if (graceTimer) clearTimeout(graceTimer);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener('abort', cancel);
      };
      const escalate = () => {
        if (closed || processExited) return;
        if (!child.kill('SIGTERM')) return;
        killTimer = setTimeout(() => { if (!closed && !processExited) child.kill('SIGKILL'); }, cancelKillMs);
        killTimer.unref?.();
      };
      const cancel = () => {
        if (closed || processExited || cancelRequested) return;
        cancelRequested = true;
        abortObserved = true;
        // Marker precedes termination so the native transport can interrupt
        // the exact Codex/Claude turn and drain its own child. Never infer
        // descendant custody from this direct PID alone.
        markerWrite = (async () => {
          try {
            const handle = await open(cancelFile,
              constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            try { await handle.writeFile('cancel\n'); await handle.sync(); }
            finally { await handle.close(); }
            if (!closed) {
              graceTimer = setTimeout(escalate, cancelGraceMs);
              graceTimer.unref?.();
            }
          } catch {
            // If the bounded private marker cannot be written, no graceful
            // cancellation can be claimed. Stop only the exact child now.
            escalate();
          }
        })();
      };
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      child.stdout.on('data', data => {
        if (output.length + data.length > 2_000_000) {
          overflow = true;
          if (cancellable) cancel();
          else child.kill('SIGTERM');
        } else output = Buffer.concat([output, data]);
      });
      child.stderr.on('data', data => { if (stderr.length < 256_000) stderr = Buffer.concat([stderr, data.subarray(0, 256_000 - stderr.length)]); });
      child.once('exit', () => {
        processExited = true;
        if (graceTimer) clearTimeout(graceTimer);
        if (killTimer) clearTimeout(killTimer);
      });
      child.once('error', error => { clearCancellation(); reject(error); });
      child.once('close', async code => {
        clearCancellation();
        // Preserve raw failed output privately, never print it into the owner's chat.
        await writeFile(file + '.stderr', stderr, { mode: 0o600 }).catch(() => {});
        if (overflow || code !== 0) return reject(Error(overflow ? 'native_output_overflow' : 'native_operation_failed'));
        try { resolve(JSON.parse(output.toString('utf8'))); } catch { reject(Error('native_record_invalid')); }
      });
    });
  } finally {
    await markerWrite.catch(() => {});
    await unlink(file).catch(() => {});
    // Keep an abort marker as a private tombstone. The direct CLI may have
    // exited before an independently spawned backend turn fully stopped;
    // deleting the marker here would let a descendant miss cancellation.
    if (!abortObserved) await unlink(cancelFile).catch(() => {});
  }
}

function policy(task) {
  const snapshot = task.host_context?.owner_policy;
  const text = snapshot ? snapshot.routing + '\n' + snapshot.projection : process.env.OS1_RCC_PUBLIC_POLICY;
  if (typeof text !== 'string' || !text || sha(Buffer.from(text)) !== task.policy_sha256)
    throw new RCCRuntimeError('rcc_policy_binding_failed');
  return text;
}

// The only task-quality verifier currently registered in the OpenClaw owner.
// It checks an exact host-parsed multi-surface arithmetic request using the
// actual native execution receipts. It is not a model critic, a generic
// completion judge, or a flagship-quality/parity certificate. Its family is
// every operator the host's route-all parser sends ("+", "-", "*"; the same
// grammar as Core's pureArithmetic, nine digits a side, a signed result).
export const arithmeticResult = instruction => {
  const parts = /^\s*(-?\d{1,9})\s*([+*\-])\s*(-?\d{1,9})\s*$/u.exec(instruction);
  if (!parts) return null;
  const a = BigInt(parts[1]), b = BigInt(parts[3]);
  return (parts[2] === '+' ? a + b : parts[2] === '*' ? a * b : a - b).toString();
};
/** Already-admitted exact route diagnostics need no model to rediscover a
 * DAG whose recipients/payloads are fixed. This creates AGENT nodes, never
 * answers: every named worker still executes and its actual receipt is
 * verified. The same downstream host resolver honors model/effort/quota and
 * permission gates. Legacy catalogs and every non-exact task abstain.
 * Original route ordinals survive skipped/dropped routes. No owner policy,
 * conversation context, task identity or native source context is altered.
 * Build 407: the host builds every explicit route plan itself (Core
 * hostPlan, the same nodes for any payload); this exact-arithmetic form is
 * kept as the documented reference shape and is no longer on the request path. */
export function deterministicExplicitArithmeticPlan(task, catalog) {
  if (!explicitTierRouting(task, catalog) || task?.host_context?.require_read_only !== true ||
      !Array.isArray(task.material_refs) || task.material_refs.length !== 0 ||
      catalog?.schema !== 1 || catalog.task_id !== task.task_id ||
      catalog.request_sha256 !== task.request_sha256 || !Array.isArray(catalog.candidates) ||
      catalog.candidates.length === 0 || catalog.candidates.length > 256) return null;
  const original = task.host_context.explicit_routes, effective = effectiveExplicitRoutes(task);
  if (!Array.isArray(original) || original.length === 0 || original.length > 8 ||
      !Array.isArray(effective) || effective.length === 0 ||
      effective.some(route => !['local', 'codex', 'claude', 'claude-chat'].includes(route?.surface) ||
        typeof route?.instruction !== 'string' || arithmeticResult(route.instruction) === null)) return null;
  return {schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
    nodes: original.flatMap((route, index) => effective.includes(route) ? [{
      id: explicitRouteNodeID(index), instruction: route.instruction, dependencies: [], kind: 'agent',
      route_class: 'trivial', scope: 'read_only', owned_paths: [], context_refs: []}] : [])};
}
const stableJSON = value => Array.isArray(value) ? `[${value.map(stableJSON).join(',')}]` :
  value !== null && typeof value === 'object' ?
    `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}` :
    JSON.stringify(value);
/** The local completion's own receipt: the pinned Ollama model answered
 * through the direct provider path and stopped normally. Shared by intent
 * resolution and the local execution surface, each with its own typed code. */
export function assertLocalModelCompletion(result, code) {
  if (result?.provider !== 'ollama' ||
      !['qwen3.5:4b', LOCAL_MODEL].includes(result?.model) ||
      result?.execution?.mode !== 'direct-provider' ||
      result?.execution?.owner?.kind !== 'provider' ||
      result?.execution?.owner?.id !== 'ollama' ||
      (result.responseModel != null && !['qwen3.5:4b', LOCAL_MODEL].includes(result.responseModel)) ||
      (result.stopReason != null && result.stopReason !== 'stop') ||
      typeof result?.text !== 'string')
    throw new RCCRuntimeError(code);
  return result.text;
}

// The intent resolver's own visible prompt bytes (policy + compiler prompt +
// input); OpenClaw's hidden system overhead is outside this bound.
const MAX_INTENT_INPUT_BYTES = 48_000;

/** A compiler operation inside the SAME Core task, not a second task owner.
 * Native code owns source/payload/recipient admission; OpenClaw owns the local
 * candidate completion, deadline/cancellation and subsequent dispatch. Neither
 * a JSON classifier answer nor a native operation creates provider authority. */
export function routingIntentResolver({complete, native = nativeOperation,
  lifetimeSignal = () => null, stateDir = null}) {
  return async ({task, signal}) => {
    const signals = [signal, lifetimeSignal()].filter(value => value instanceof AbortSignal);
    const combined = signals.length ? AbortSignal.any(signals) : undefined;
    const checkAbort = () => { if (combined?.aborted) throw new RCCRuntimeError('intent_cancelled'); };
    const bound = value => {
      if (value?.schema !== 1 || value.task_id !== task.task_id ||
          value.request_sha256 !== task.request_sha256 || value.policy_sha256 !== task.policy_sha256 ||
          value.source_fingerprint !== task.source_fingerprint)
        throw new RCCRuntimeError('intent_source_binding_invalid');
      return value;
    };
    checkAbort();
    const probe = bound(await native('rcc-intent', {schema: 1, task}, combined));
    checkAbort();
    if (probe.kind !== 'needs_model') return {...probe, model_answer: null};
    if (typeof complete !== 'function' || typeof probe.model_prompt !== 'string' ||
        Buffer.byteLength(probe.model_prompt) > 16_384 || typeof probe.model_input !== 'string' ||
        Buffer.byteLength(probe.model_input) > 8_192 || probe.model_schema?.type !== 'object' ||
        typeof probe.model_schema_json !== 'string' || Buffer.byteLength(probe.model_schema_json) > 8_192 ||
        Buffer.byteLength(JSON.stringify(probe.model_schema)) > 8_192)
      throw new RCCRuntimeError('intent_model_contract_invalid');
    // Schema property order is part of this classifier's frozen input. Native
    // canonical wire encoding sorts object keys; the literal preserves the
    // original schema order without accepting a different schema.
    let responseFormat;
    try { responseFormat = JSON.parse(probe.model_schema_json); }
    catch { throw new RCCRuntimeError('intent_model_contract_invalid'); }
    if (stableJSON(responseFormat) !== stableJSON(probe.model_schema))
      throw new RCCRuntimeError('intent_model_contract_invalid');
    // The policy is still applied to this child operation. Source text stays
    // in the user message; it cannot change the internal JSON-only objective.
    const instructions = policy(task) + '\n\n' +
      'INTERNAL ROUTING INTENT ONLY. Persona is OFF. Do not execute or answer the user task. ' +
      'Return only the classifier JSON schema. This is a candidate; code admits it.\n\n' +
      probe.model_prompt;
    if (Buffer.byteLength(instructions) + Buffer.byteLength(probe.model_input) > MAX_INTENT_INPUT_BYTES)
      throw new RCCRuntimeError('intent_input_budget_exceeded');
    const started = Date.now();
    const response = await complete({model: LOCAL_MODEL,
      messages: [{role: 'user', content: probe.model_input}], systemPrompt: instructions,
      responseFormat, maxTokens: 192, temperature: 0, reasoning: 'off',
      signal: combined, purpose: 'os1.rcc.internal-routing-intent'});
    checkAbort();
    const answer = assertLocalModelCompletion(response, 'intent_local_model_receipt_invalid');
    if (!answer || Buffer.byteLength(answer) > 4_096)
      throw new RCCRuntimeError('intent_model_output_invalid');
    if (isAbsolute(stateDir ?? '')) {
      // A task-bound visible-output receipt, not hidden model introspection.
      await writeFile(join(stateDir, `intent-output-${randomUUID()}.json`), JSON.stringify({
        schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
        source_fingerprint: task.source_fingerprint, policy_sha256: task.policy_sha256,
        model_requested: LOCAL_MODEL, provider_observed: response.provider,
        model_observed: response.model, response_model_observed: response.responseModel ?? null,
        execution_mode_observed: response.execution.mode, stop_reason_observed: response.stopReason ?? null,
        usage_observed: response.usage ?? null, elapsed_ms: Date.now() - started,
        output_sha256: sha(Buffer.from(answer)), text: answer,
      }), {flag: 'wx', mode: 0o600});
    }
    checkAbort();
    const admitted = bound(await native('rcc-intent', {schema: 1, task, answer}, combined));
    checkAbort();
    if (admitted.kind === 'needs_model') throw new RCCRuntimeError('intent_compiler_did_not_settle');
    return {...admitted, model_answer: answer};
  };
}

// ---- Local execution surface (route-all, 2026-10-14) ----
// An explicit route that names the local surface runs its one instruction on
// the SAME local model intent resolution uses, through the same OpenClaw completion
// path: tools-free (before_tool_call blocks every tool in this Gateway),
// read-only, no quota pool. Only the instruction is sent, never the owner's
// whole request. Its execution record is a private receipt in the same
// native-receipts custody the exact verifier reads.
export const LOCAL_WORKER_PURPOSE = 'os1.rcc.local-worker';
const LOCAL_WORKER_SYSTEM = 'OS-1 local answer lane. Answer only the task in the user message, from the message alone. ' +
  'Reply with only the final result and no other text: no reasoning, no explanation, no markdown.';
const LOCAL_WORKER_MAX_TOKENS = 512;
export function localWorkerCompletionRequest({instruction, signal}) {
  return {model: LOCAL_MODEL, messages: [{role: 'user', content: instruction}], systemPrompt: LOCAL_WORKER_SYSTEM,
    maxTokens: LOCAL_WORKER_MAX_TOKENS, temperature: 0, reasoning: 'off', signal, purpose: LOCAL_WORKER_PURPOSE};
}
/** The answer as delivered: a leaked reasoning block removed and the edges
 * trimmed. Nothing else is rewritten, so "1+1 = 2" stays "1+1 = 2" and the
 * exact verifier, not this function, decides whether it is the result. */
export function normalizeLocalOutput(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<think>[\s\S]*?<\/think>/giu, '').replace(/^\s*<think>[\s\S]*$/iu, '').trim();
}
const LOCAL_MAX_OUTPUT_BYTES = 64_000;
function localUsage(observed, durationMS) {
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const usage = {input_tokens: count(observed?.inputTokens), output_tokens: count(observed?.outputTokens),
    cache_read_tokens: count(observed?.cacheReadTokens), cache_write_tokens: count(observed?.cacheWriteTokens),
    provider_calls: 1, duration_ms: count(durationMS)};
  if (['input_tokens', 'output_tokens'].some(key => usage[key] !== null)) usage.metric = 'local_model_usage_observation';
  return usage;
}
/** One RunSummary step for the local surface, the shape the native adapter
 * returns (opaque to Core), so the host shows which surface answered. */
function localRunSummary(ticket, model, output, durationMS) {
  return JSON.stringify({status: 'returned_unverified', steps: [{sequence: 1, provider: 'local',
    action: 'rcc_local_model', model, effort: 'none', revas_disposition: 'execution_only',
    session_id: ticket.attempt_id, permission_profile: 'read_only', exit_code: 0, output, stderr: '',
    duration_ms: durationMS, native_record: null, surface: 'local'}]});
}
/** The local surface's executor: `complete(request)` is OpenClaw's
 * api.runtime.llm.complete, already bound to the service's lifetime scope.
 * Returns an execution record for Core's _validateExecution and writes the
 * identical private receipt the exact verifier reads. */
export function localModelExecutor({complete, stateDir, lifetimeSignal = () => null}) {
  return async function executeLocal(ticket, signal) {
    const config = ticket?.selected_config;
    if (typeof complete !== 'function' || !isAbsolute(stateDir ?? '') || !localWorkerRow(config) ||
        ticket.continuation != null || typeof ticket.instruction !== 'string' || ticket.instruction.length === 0 ||
        ticket.owned_paths?.length)
      throw new RCCRuntimeError('local_worker_ticket_invalid');
    const directory = join(stateDir, 'native-receipts');
    await mkdir(directory, {recursive: true, mode: 0o700}); await chmod(directory, 0o700);
    const receipt = join(directory, `${randomUUID()}.json`);
    const record = {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
      candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
      selected_config: config, acknowledged_config: null, observed_config: null,
      status: 'failed', dispatch_stage: 'dispatched', side_effects: 'none', output: null,
      execution_verified: false, task_verified: false, task_quality: 'failed', parity_state: 'unverified',
      native_receipt: receipt, usage: null, error: null, native_summary: null};
    const write = async () => {
      await writeFile(receipt, JSON.stringify(record), {flag: 'wx', mode: 0o600});
      return record;
    };
    const signals = [signal, lifetimeSignal()].filter(value => value instanceof AbortSignal);
    const started = Date.now();
    let response;
    try {
      response = await complete(localWorkerCompletionRequest({instruction: ticket.instruction,
        signal: signals.length ? AbortSignal.any(signals) : undefined}));
    } catch {
      // The completion call returned no answer: the turn is over, and on a
      // tools-free, read-only, quota-free surface it changed nothing. An
      // owner cancel or a service stop is a cancelled turn (Core counts it a
      // safe cancel); any other failure (Ollama down or restarted, a model
      // load error, a Gateway change) is a finished attempt with no answer:
      // Core holds only this route and the sibling routes keep their answers.
      // Never "uncertain": that made the whole route-all task
      // effects_uncertain and dropped every sibling answer.
      record.native_turn_terminated = true;
      record.usage = localUsage(null, Date.now() - started);
      if (signals.some(value => value.aborted)) record.error = 'local_model_completion_aborted';
      else Object.assign(record, {status: 'succeeded', error: 'local_model_completion_failed'});
      return write();
    }
    const durationMS = Date.now() - started;
    record.usage = localUsage(response?.usage, durationMS);
    record.native_turn_terminated = true;
    let text = null;
    try { text = assertLocalModelCompletion(response, 'local_worker_receipt_invalid'); }
    catch {
      // Something other than the pinned local model answered, or it did not
      // stop normally: a finished candidate that is never adopted.
      Object.assign(record, {status: 'succeeded', error: 'local_model_receipt_invalid'});
      return write();
    }
    const output = normalizeLocalOutput(text);
    if (!output || Buffer.byteLength(output) > LOCAL_MAX_OUTPUT_BYTES) {
      Object.assign(record, {status: 'succeeded', error: output ? 'local_model_output_oversize' : 'local_model_output_empty'});
      return write();
    }
    // The same exact check the native adapter records: an exact arithmetic
    // instruction answered with exactly its result is task-verified at the source.
    const expected = arithmeticResult(ticket.instruction);
    const exact = expected !== null && output === expected;
    Object.assign(record, {status: 'succeeded', acknowledged_config: config, output, execution_verified: true,
      task_verified: exact, task_quality: exact ? 'task_verified' : 'execution_only',
      native_summary: localRunSummary(ticket, response.model.replace(/^ollama\//, ''), output, durationMS)});
    return write();
  };
}
async function readExactNativeReceipt(path, stateDir) {
  if (!isAbsolute(stateDir ?? '') || typeof path !== 'string') return null;
  const directory = join(stateDir, 'native-receipts');
  if (dirname(path) !== directory || !/^[a-f0-9-]{36}\.json$/.test(basename(path))) return null;
  let handle;
  try {
    const parent = await lstat(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() ||
        (parent.mode & 0o077) !== 0) return null;
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = await handle.stat();
    if (!st.isFile() || st.uid !== process.getuid() || st.nlink !== 1 ||
        (st.mode & 0o777) !== 0o600 || st.size < 2 || st.size > 1_000_000) return null;
    return JSON.parse((await handle.readFile()).toString('utf8'));
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}
export async function verifyExactExplicitArithmetic({task, plan, children}, {stateDir} = {}) {
  const verdict = (verified, output, reason) => ({schema: 1, task_id: task.task_id,
    task_verified: verified, output, parity_state: 'unverified', reason});
  // New plans bind exactly the routes that still run. A plan admitted before
  // GPT stopped being routed was built from the full original list and is
  // verified against it (its GPT nodes ran on the then-approved rows).
  const effective = effectiveExplicitRoutes(task);
  const original = task.host_context?.explicit_routes;
  const routes = Array.isArray(effective) && Array.isArray(plan?.nodes) &&
    plan.nodes.length !== effective.length && Array.isArray(original) &&
    plan.nodes.length === original.length ? original : effective;
  if (task.mode !== 'explicit_routing_test' || !Array.isArray(routes) ||
      routes.length === 0 || !Array.isArray(plan?.nodes) || !Array.isArray(children) ||
      routes.length !== plan.nodes.length || routes.length !== children.length ||
      plan.final_node_id != null)
    return verdict(false, null, 'no_registered_exact_task_verifier');
  const remaining = new Set(routes.map(route => stableJSON(route)));
  const byID = new Map(children.map(child => [child.id, child]));
  if (byID.size !== children.length) return verdict(false, null, 'exact_route_child_duplicate');
  for (const node of plan.nodes) {
    const child = byID.get(node.id);
    const config = child?.selected_config;
    const expected = typeof node.instruction === 'string' ? arithmeticResult(node.instruction) : null;
    if (node.kind !== 'agent' || node.dependencies?.length !== 0 || !child || !config ||
        child.state !== 'completed' || child.candidate_id !== node.candidate_id ||
        child.instruction !== node.instruction || config.scope !== 'read_only' ||
        child.execution_verified !== true || !['task_verified', 'execution_only'].includes(child.task_quality) ||
        typeof child.output !== 'string' || expected === null || child.output.trim() !== expected ||
        !remaining.delete(stableJSON({surface: config.surface, instruction: node.instruction})))
      return verdict(false, null, 'exact_route_output_or_binding_mismatch');
    const receipt = await readExactNativeReceipt(child.native_receipt, stateDir);
    if (!receipt || receipt.schema !== 1 || receipt.task_id !== task.task_id ||
        receipt.node_id !== node.id || receipt.attempt_id !== child.attempt_id ||
        receipt.candidate_id !== node.candidate_id ||
        receipt.configuration_sha256 !== config.configuration_sha256 ||
        receipt.native_receipt !== child.native_receipt ||
        receipt.status !== 'succeeded' || receipt.dispatch_stage !== 'dispatched' ||
        receipt.execution_verified !== true || receipt.side_effects !== 'none' ||
        receipt.task_quality !== child.task_quality ||
        receipt.task_verified !== (child.task_quality === 'task_verified') ||
        receipt.parity_state !== 'unverified' || receipt.output !== child.output ||
        stableJSON(receipt.selected_config) !== stableJSON(config) ||
        stableJSON(receipt.acknowledged_config) !== stableJSON(config) ||
        (receipt.observed_config != null && stableJSON(receipt.observed_config) !== stableJSON(config)))
      return verdict(false, null, 'exact_native_receipt_mismatch');
  }
  if (remaining.size !== 0) return verdict(false, null, 'exact_route_uncovered');
  const output = plan.nodes.length === 1 ? byID.get(plan.nodes[0].id).output :
    plan.nodes.map(node => `${node.id}: ${byID.get(node.id).output}`).join('\n\n');
  return verdict(true, output, 'exact_explicit_route_arithmetic_receipts');
}

export function registerRCCRuntime(api) {
  let runtime, starting;
  // Durable work outlives the submit RPC. Capture the service's registration
  // scope, not an RPC root whose admission is released after its acknowledgement.
  // The official runtime still checks plugin identity, model policy and lifetime.
  // The local model (intent resolution, an explicit local route) runs in it.
  const makePlannerScope = AsyncResource.bind(() =>
    new AsyncResource('OS1RCCServicePlanner', { requireManualDestroy: true }));
  let plannerScope, plannerLifetime;
  // This Gateway is OS-1's local task core, never a hosted-model planner: its
  // one local model is pinned for intent resolution and the local route only.
  api.on('before_model_resolve', () => ({ providerOverride: 'ollama', modelOverride: 'qwen3.5:4b' }), { priority: 1000 });
  api.on('before_tool_call', () => ({ block: true, blockReason: 'rcc_planner_tool_free' }), { priority: 1000 });
  api.registerService({
    id: 'os1-rcc-runtime',
    async start(ctx) {
      plannerScope = makePlannerScope(); plannerLifetime = new AbortController();
      const stateDir = process.env.OS1_RCC_STATE_ROOT ?? ctx.stateDir;
      // The local execution surface runs in the service scope, on the pinned
      // local model, and stops with the service.
      const executeLocal = localModelExecutor({stateDir,
        complete: request => plannerScope.runInAsyncScope(() => api.runtime.llm.complete(request)),
        lifetimeSignal: () => plannerLifetime?.signal ?? null});
      const local = ticket => ticket?.selected_config?.surface === 'local';
      starting = createRCCRuntime({ stateDir,
        maximumWorkers: 4,
        maximumReadWorkersPerPool: 4,
        resolveIntent: routingIntentResolver({stateDir,
          complete: request => plannerScope.runInAsyncScope(() => api.runtime.llm.complete(request)),
          lifetimeSignal: () => plannerLifetime?.signal ?? null}),
        // The owner/public policy a task is bound to must still be the one
        // this service holds before any native probe or worker runs (every
        // pre-dispatch refresh included); a mismatch holds the task typed.
        catalog: task => { policy(task); return nativeOperation('rcc-catalog', task); },
        // R7: Core builds every plan itself (one node running the owner's
        // request byte-exact, or one node per named route) and binds it by the
        // one admission law. No model plans, grades or rewrites it; repairs
        // re-resolve rows and never re-plan. The local model below answers
        // only intent resolution and an explicit local route.
        hostAutoPlan: true,
        execute: (ticket, signal) => local(ticket) ? executeLocal(ticket, signal) :
          nativeOperation('rcc-adapter', ticket, signal),
        // Same pinned native adapter and task owner. A typed, receipt-bound
        // continuation never chooses another route; the local surface has no
        // continuation and refuses one.
        executeContinuation: (ticket, signal) => local(ticket) ? executeLocal(ticket, signal) :
          nativeOperation('rcc-adapter', ticket, signal),
        decideOperationalQuality: (request, signal) => nativeOperation('rcc-quality-decision', request, signal),
        stageSelfUpdate: (request, signal) => nativeOperation('rcc-stage', request, signal),
        reconcileInstallation: request => nativeOperation('rcc-install-status', request),
        cancelInstallation: request => nativeOperation('rcc-install-cancel', request),
        verifyTask: evidence => verifyExactExplicitArithmetic(evidence, {stateDir}),
      });
      runtime = await starting;
      await runtime.startQueued();
    },
    async stop() {
      plannerLifetime?.abort(Error('rcc_service_stopping'));
      if (runtime) await runtime.close(); runtime = undefined;
      plannerScope?.emitDestroy(); plannerScope = undefined;
    },
  });
  for (const name of ['submit', 'status', 'cancel', 'quiesce']) {
    api.registerGatewayMethod('os1.rcc.' + name, async ({ params, respond }) => {
      try {
        if (!runtime && starting) await starting;
        if (!runtime) throw Error('rcc_runtime_unavailable');
        const result = name === 'submit' ? await runtime.submit(params) : name === 'status'
          ? await runtime.statusWithInstallation(params) : name === 'cancel'
          ? await runtime.cancelWithInstallation(params) : await runtime.quiesce(params);
        respond(true, result);
      } catch (error) { respond(false, undefined, { code: 'INVALID_REQUEST', message: error?.code ?? 'rcc_request_rejected' }); }
    }, { scope: 'operator.write', profileAccess: 'independent' });
  }
}
