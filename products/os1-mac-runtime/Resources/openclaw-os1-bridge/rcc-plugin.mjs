import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, writeFile, readFile, chmod, unlink } from 'node:fs/promises';
import { join, dirname, basename, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { AsyncResource } from 'node:async_hooks';
import { createRCCRuntime, dispatchable, effectiveExplicitRoutes, RCCRuntimeError, ROUTE_CLASSES,
  routingAvailability } from './rcc-runtime.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const LOCAL_MODEL = 'ollama/qwen3.5:4b';
const ROUTER_MODE_LOCK = 'INTERNAL ROUTING PLAN ONLY. This is not the user-visible answer. Persona prefix Ben./LuaIsHere :3 is OFF for this internal JSON lane. Do not answer the user task, do not report completion, and do not emit Conclusion/Core reason/Breaking variable, prose, markdown or code fences. Return one JSON object only; actual execution and quality are verified after this candidate plan.';
export function buildRoutePlanSchema(task, catalog, now = Date.now()) {
  if (!Array.isArray(catalog?.candidates) || catalog.candidates.length === 0 ||
      catalog.candidates.length > 256)
    throw new RCCRuntimeError('planner_catalog_invalid');
  // These are identity choices, not free text. In particular, a configuration
  // hash is not a candidate ID: only the exact catalog value may be generated.
  // Keep scope branches separate so a writer cannot be selected in a read-only
  // node. The runtime still independently validates the returned plan.
  const candidateIDs = {read_only: [], workspace_write: []};
  const seen = new Set();
  for (const candidate of catalog.candidates) {
    if (typeof candidate?.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(candidate.id) ||
        seen.has(candidate.id) || !Object.hasOwn(candidateIDs, candidate.scope))
      throw new RCCRuntimeError('planner_catalog_invalid');
    seen.add(candidate.id);
    candidateIDs[candidate.scope].push(candidate.id);
  }
  // Outside an explicit route test the planner never chooses a row. It grades
  // each node (route_class) in a scope that can run now; the host resolves
  // the exact model, effort, surface and quota pool afterwards.
  const explicit = task.mode === 'explicit_routing_test';
  const availability = explicit ? null : routingAvailability(task, catalog, now);
  const offered = explicit ? {read_only: candidateIDs.read_only.length > 0,
    workspace_write: candidateIDs.workspace_write.length > 0} :
    {read_only: availability.scopes.includes('read_only') || availability.deterministic,
      workspace_write: availability.scopes.includes('workspace_write')};
  const refs = task.material_refs ?? [];
  const contextRefs = {type: 'array', maxItems: refs.length === 0 ? 0 : Math.min(128, refs.length),
    items: {type: 'string'}};
  if (refs.length > 0 && refs.length <= 8) contextRefs.items.enum = [...refs];
  const kind = explicit || !(availability.deterministic) ?
      {type: 'string', const: 'agent'} :
      {type: 'string', enum: ['agent', 'deterministic']};
  const choice = explicit ? 'candidate_id' : 'route_class';
  // A native writer row owns the whole workspace ("**"): it is not confined to
  // the paths a planner lists. When every writer that can run now is such a
  // row, a graded writer must say so instead of naming concrete paths.
  const writeRows = explicit ? [] : catalog.candidates.filter(c => c.scope === 'workspace_write' &&
    !['chatgpt', 'gpt-chat'].includes(c.surface) && dispatchable(c, task, now));
  const wholeWorkspace = writeRows.length > 0 && writeRows.every(c => c.allowed_paths?.includes('**'));
  const node = scope => ({type: 'object', additionalProperties: false,
    required: ['id', 'instruction', 'dependencies', 'kind', choice,
      'scope', 'owned_paths', 'context_refs'],
    properties: {
      id: {type: 'string'}, instruction: {type: 'string'},
      dependencies: {type: 'array', maxItems: 8, items: {type: 'string'}},
      kind, [choice]: explicit ? {type: 'string', enum: candidateIDs[scope]} :
        {type: 'string', enum: [...ROUTE_CLASSES]},
      scope: {type: 'string', const: scope},
      owned_paths: scope === 'read_only' ?
        {type: 'array', maxItems: 0, items: {type: 'string'}} : wholeWorkspace ?
        {type: 'array', minItems: 1, maxItems: 1, items: {type: 'string', enum: ['**']}} :
        {type: 'array', minItems: 1, maxItems: 64, items: {type: 'string'}},
      context_refs: contextRefs}});
  const readOnly = task.host_context?.require_read_only === true || !offered.workspace_write;
  if (readOnly && !offered.read_only)
    throw new RCCRuntimeError('planner_catalog_scope_unavailable');
  const writeOnly = !readOnly && !offered.read_only;
  const item = readOnly ? node('read_only') : writeOnly ? node('workspace_write') :
    {oneOf: [node('read_only'), node('workspace_write')]};
  const fixedCount = task.mode === 'explicit_routing_test' &&
    Array.isArray(task.host_context?.explicit_routes) ? effectiveExplicitRoutes(task).length : null;
  const properties = {
    schema: {type: 'integer', const: 1},
    task_id: {type: 'string', const: task.task_id},
    request_sha256: {type: 'string', const: task.request_sha256},
    nodes: {type: 'array', minItems: fixedCount ?? 1, maxItems: fixedCount ?? 8, items: item}};
  if (task.mode !== 'explicit_routing_test') properties.final_node_id = {type: 'string'};
  return {type: 'object', additionalProperties: false,
    required: ['schema', 'task_id', 'request_sha256', 'nodes'], properties};
}

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
  if (!['rcc-catalog', 'rcc-adapter', 'rcc-stage', 'rcc-install-status',
    'rcc-install-cancel'].includes(operation)) throw Error('native_operation_denied');
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
    throw Error('rcc_policy_binding_failed');
  return text;
}

// The only task-quality verifier currently registered in the OpenClaw owner.
// It checks an exact host-parsed multi-surface arithmetic request using the
// actual native execution receipts. It is not a model critic, a generic
// completion judge, or a flagship-quality/parity certificate.
const arithmeticSum = instruction => {
  const parts = /^\s*(-?\d{1,9})\s*\+\s*(-?\d{1,9})\s*$/u.exec(instruction);
  return parts ? (BigInt(parts[1]) + BigInt(parts[2])).toString() : null;
};
const stableJSON = value => Array.isArray(value) ? `[${value.map(stableJSON).join(',')}]` :
  value !== null && typeof value === 'object' ?
    `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}` :
    JSON.stringify(value);
const CANDIDATE_COMMON_KEYS = ['account_id', 'model', 'quota_pool',
  'availability', 'availability_observed_at_ms', 'availability_valid_until_ms',
  'quota_remaining_fraction', 'quota_observed_at_ms', 'quota_valid_until_ms',
  'quality_state', 'estimated_cost_units'];
const CANDIDATE_VARIANT_KEYS = ['index', 'id', 'surface', 'transport', 'effort',
  'scope', 'permission_profile',
  'tools', 'allowed_paths', 'configuration_sha256'];
const MAX_PLANNER_OWN_INPUT_BYTES = 48_000;

// Group repeated model/account/quota metadata. Every original candidate,
// including a newer model sorted after legacy profiles, remains represented
// with its exact ID, configuration and original index. This is transport
// compression, not filtering, re-ranking or a quality claim.
export function compactCandidateCatalog(catalog) {
  if (!Array.isArray(catalog?.candidates) || catalog.candidates.length < 1 ||
      catalog.candidates.length > 256) throw new RCCRuntimeError('planner_catalog_invalid');
  const groups = [], byCommon = new Map();
  catalog.candidates.forEach((candidate, index) => {
    const common = CANDIDATE_COMMON_KEYS.map(key => candidate[key]);
    const variant = [index, ...CANDIDATE_VARIANT_KEYS.slice(1).map(key => candidate[key])];
    if ([...common, ...variant].some(value => value === undefined))
      throw new RCCRuntimeError('planner_candidate_field_missing');
    const key = stableJSON(common);
    let group = byCommon.get(key);
    if (!group) { group = {common, variants: []}; byCommon.set(key, group); groups.push(group); }
    group.variants.push(variant);
  });
  return {format: 'rcc-candidate-groups-v1', candidate_count: catalog.candidates.length,
    original_sha256: sha(Buffer.from(stableJSON(catalog.candidates))),
    common_keys: CANDIDATE_COMMON_KEYS, variant_keys: CANDIDATE_VARIANT_KEYS, groups};
}

export function expandCandidateCatalog(compact) {
  if (compact?.format !== 'rcc-candidate-groups-v1' ||
      stableJSON(compact.common_keys) !== stableJSON(CANDIDATE_COMMON_KEYS) ||
      stableJSON(compact.variant_keys) !== stableJSON(CANDIDATE_VARIANT_KEYS) ||
      !Array.isArray(compact.groups) || !Number.isSafeInteger(compact.candidate_count) ||
      compact.candidate_count < 1 || compact.candidate_count > 256)
    throw new RCCRuntimeError('planner_compact_catalog_invalid');
  const entries = [];
  for (const group of compact.groups) {
    if (!Array.isArray(group.common) || group.common.length !== CANDIDATE_COMMON_KEYS.length ||
        !Array.isArray(group.variants)) throw new RCCRuntimeError('planner_compact_catalog_invalid');
    for (const variant of group.variants) {
      if (!Array.isArray(variant) || variant.length !== CANDIDATE_VARIANT_KEYS.length ||
          !Number.isSafeInteger(variant[0])) throw new RCCRuntimeError('planner_compact_catalog_invalid');
      entries.push([variant[0], Object.fromEntries([
        ...CANDIDATE_COMMON_KEYS.map((key, i) => [key, group.common[i]]),
        ...CANDIDATE_VARIANT_KEYS.slice(1).map((key, i) => [key, variant[i + 1]])])]);
    }
  }
  entries.sort((a, b) => a[0] - b[0]);
  if (entries.length !== compact.candidate_count ||
      entries.some(([index], position) => index !== position))
    throw new RCCRuntimeError('planner_compact_catalog_invalid');
  const candidates = entries.map(([, candidate]) => candidate);
  if (sha(Buffer.from(stableJSON(candidates))) !== compact.original_sha256)
    throw new RCCRuntimeError('planner_compact_catalog_hash_mismatch');
  return candidates;
}

const EXPLICIT_PLAN_INSTRUCTIONS = 'RCC EXECUTION PLAN: preserve the original objective and supplied source. Choose exact candidate IDs only; each ID already fixes model, effort, tools, quota and scope. Candidate catalog is lossless grouped data: each group.common uses common_keys, each group.variants row uses variant_keys (including the original index); do not omit, alias or invent an ID. Prefer the smallest total resources sufficient for this task, not a fixed strongest model. Unknown cost/quality stays unknown; policy_admitted means permission admission, NOT measured quality parity. Independent work may be parallel; dependent work must name dependencies. Explicit routes require exactly one independent node per supplied surface/instruction, without alias, substitution or payload rewrite. No command, account or permission invention. Return only JSON {schema:1,task_id,request_sha256,nodes:[{id,instruction,dependencies,kind:"agent",candidate_id,scope,owned_paths,context_refs}]}. For one indivisible task keep instruction equal to the original request. Integration, if actually needed, is an explicit dependent node, not a mandatory summarizer.';
const GRADED_PLAN_INSTRUCTIONS = 'RCC EXECUTION PLAN: preserve the original objective and supplied source. Decompose only into genuinely separable parts and grade each node with route_class: trivial = lookup, short factual answer or formatting; standard = normal coding or analysis; deep = hard multi-step design, debugging or proof. Grade the node, not the user: a short request can be deep and a long one trivial. The host then chooses the exact model, reasoning effort, surface and quota pool for each node from route_class and scope; never name a model, provider, account, effort or candidate. availability lists only scopes that can run now. read_only nodes never write and have no owned_paths; a workspace_write node owns the whole workspace, owned_paths ["**"], unless the response schema allows narrower paths, and the host runs writers one at a time. Independent work may be parallel; dependent work must name dependencies. No command, account or permission invention. Return only JSON {schema:1,task_id,request_sha256,nodes:[{id,instruction,dependencies,kind:"agent",route_class,scope,owned_paths,context_refs}]}. For one indivisible task keep instruction equal to the original request. Integration, if actually needed, is an explicit dependent node, not a mandatory summarizer.';

export function buildBoundedPlannerInput({task, catalog, feedback, policyText, now = Date.now()}) {
  const explicit = task.mode === 'explicit_routing_test';
  const instructions = ROUTER_MODE_LOCK + '\n\n' + policyText + '\n\n' + ROUTER_MODE_LOCK + '\n\n' +
    (explicit ? EXPLICIT_PLAN_INSTRUCTIONS : GRADED_PLAN_INSTRUCTIONS);
  // Outside an explicit route test the planner gets no candidate catalog and
  // no candidate ID (feedback included): only what can run now.
  const message = 'OS1_RCC_PLAN\n' + JSON.stringify(explicit ? {task_id: task.task_id,
    request_sha256: task.request_sha256, original_objective: task.objective,
    request: task.request, material_refs: task.material_refs,
    explicit_routes: effectiveExplicitRoutes(task) ?? [],
    context: task.host_context.context,
    candidate_catalog: compactCandidateCatalog(catalog), feedback} : {task_id: task.task_id,
    request_sha256: task.request_sha256, original_objective: task.objective,
    request: task.request, material_refs: task.material_refs,
    context: task.host_context.context,
    availability: routingAvailability(task, catalog, now)});
  // Only our own visible prompt bytes are bounded here; OpenClaw's hidden
  // system overhead still requires an actual local-model context smoke.
  const responseFormat = buildRoutePlanSchema(task, catalog, now);
  if (Buffer.byteLength(instructions) + Buffer.byteLength(message) +
      Buffer.byteLength(JSON.stringify(responseFormat)) > MAX_PLANNER_OWN_INPUT_BYTES)
    throw new RCCRuntimeError('planner_input_budget_exceeded');
  return {instructions, message, responseFormat};
}

/** The local planner grades nodes; it never chooses a row outside an
 * explicit route test, even if the model ignored the response schema. */
export function assertPlannerRouteChoice(task, plan) {
  if (task.mode !== 'explicit_routing_test' && Array.isArray(plan?.nodes) &&
      plan.nodes.some(node => node !== null && typeof node === 'object' && Object.hasOwn(node, 'candidate_id')))
    throw new RCCRuntimeError('planner_candidate_choice_forbidden');
  return plan;
}

export function plannerCompletionRequest({instructions, message, responseFormat, signal}) {
  return {model: LOCAL_MODEL, messages: [{role: 'user', content: message}],
    systemPrompt: instructions, responseFormat,
    maxTokens: 4_096, temperature: 0, signal, purpose: 'os1.rcc.internal-route-plan'};
}

export function assertLocalPlannerCompletion(result) {
  if (result?.provider !== 'ollama' ||
      !['qwen3.5:4b', LOCAL_MODEL].includes(result?.model) ||
      result?.execution?.mode !== 'direct-provider' ||
      result?.execution?.owner?.kind !== 'provider' ||
      result?.execution?.owner?.id !== 'ollama' ||
      (result.responseModel != null && !['qwen3.5:4b', LOCAL_MODEL].includes(result.responseModel)) ||
      (result.stopReason != null && result.stopReason !== 'stop') ||
      typeof result?.text !== 'string')
    throw new RCCRuntimeError('planner_local_model_receipt_invalid');
  return result.text;
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
    const expected = typeof node.instruction === 'string' ? arithmeticSum(node.instruction) : null;
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
  const makePlannerScope = AsyncResource.bind(() =>
    new AsyncResource('OS1RCCServicePlanner', { requireManualDestroy: true }));
  let plannerScope, plannerLifetime;
  // This Gateway is OS-1's local task core, never a hosted-model planner.
  api.on('before_model_resolve', () => ({ providerOverride: 'ollama', modelOverride: 'qwen3.5:4b' }), { priority: 1000 });
  api.on('before_tool_call', () => ({ block: true, blockReason: 'rcc_planner_tool_free' }), { priority: 1000 });
  api.registerService({
    id: 'os1-rcc-runtime',
    async start(ctx) {
      plannerScope = makePlannerScope(); plannerLifetime = new AbortController();
      const stateDir = process.env.OS1_RCC_STATE_ROOT ?? ctx.stateDir;
      starting = createRCCRuntime({ stateDir,
        maximumWorkers: 4,
        catalog: task => nativeOperation('rcc-catalog', task),
        plan: async ({ task, catalog, ...feedback }) => {
          const {instructions, message, responseFormat} = buildBoundedPlannerInput({task, catalog,
            feedback, policyText: policy(task)});
          let response;
          try { response = await plannerScope.runInAsyncScope(() => api.runtime.llm.complete(
            plannerCompletionRequest({instructions, message, responseFormat,
              signal: plannerLifetime.signal})));
            assertLocalPlannerCompletion(response);
          } catch (error) {
            // Raw exception details stay in this private, task-bound diagnostic;
            // no prompt, policy, auth token or stack is printed into the UI.
            const root = process.env.OS1_RCC_STATE_ROOT;
            if (isAbsolute(root ?? '')) {
              const redact = value => String(value ?? '').slice(0, 8192)
                .replace(/\b(?:sk-|ghp_|github_pat_|sk-ant-)[A-Za-z0-9_-]+\b/g, '[secret]')
                .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[secret]');
              await writeFile(join(root, `planner-error-${randomUUID()}.json`), JSON.stringify({
                schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
                stage: 'local_planner_completion', model: LOCAL_MODEL,
                observed_at_ms: Date.now(), name: redact(error?.name),
                message: redact(error?.message), stack: redact(error?.stack),
              }), { flag: 'wx', mode: 0o600 }).catch(() => {});
            }
            throw error;
          }
          // Preserve the model's raw returned text before normalization/JSON
          // validation. This is an output artifact, never a hidden-reasoning
          // trace or proof that the selected execution route ran.
          const rawText = assertLocalPlannerCompletion(response);
          const stateRoot = process.env.OS1_RCC_STATE_ROOT;
          if (isAbsolute(stateRoot ?? '') && Buffer.byteLength(rawText) <= 65_536) {
            await writeFile(join(stateRoot, `planner-output-${randomUUID()}.json`), JSON.stringify({
              schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
              policy_sha256: task.policy_sha256, model_requested: LOCAL_MODEL,
              provider_observed: response.provider, model_observed: response.model,
              response_model_observed: response.responseModel ?? null,
              execution_mode_observed: response.execution.mode,
              stop_reason_observed: response.stopReason ?? null,
              usage_observed: response.usage ?? null,
              observed_at_ms: Date.now(), output_sha256: sha(Buffer.from(rawText)), text: rawText,
            }), { flag: 'wx', mode: 0o600 }).catch(() => {});
          }
          const text = response.text.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
          const parsed = JSON.parse(text);
          // The core's independent typed verifier checks objective binding, DAG,
          // permissions, scopes, catalogue and quota before any child dispatch.
          // Outside explicit route tests the core binds each graded node.
          return assertPlannerRouteChoice(task, parsed);
        },
        execute: (ticket, signal) => nativeOperation('rcc-adapter', ticket, signal),
        // Same pinned native adapter and task owner. A typed, receipt-bound
        // continuation never asks the local planner to choose another route.
        executeContinuation: (ticket, signal) => nativeOperation('rcc-adapter', ticket, signal),
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
