import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, mkdir, lstat, writeFile, readFile, chmod, unlink } from 'node:fs/promises';
import { join, dirname, basename, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { AsyncResource } from 'node:async_hooks';
import { createRCCRuntime, dispatchable, effectiveExplicitRoutes, explicitRouteNodeID, explicitTierRouting,
  localWorkerRow, lockIndivisibleInstruction, RCCRuntimeError, ROUTE_CLASSES, routingAvailability } from './rcc-runtime.mjs';

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
  // The planner chooses an exact row only in an explicit route test on an
  // older catalog (no model_tiers). Otherwise it grades each node
  // (route_class) and the host binds the exact tier route for that grade
  // afterwards; in an explicit route test the host binds it on the route's
  // own named surface, so the planner only grades each named route.
  const explicit = task.mode === 'explicit_routing_test';
  const gradedExplicit = explicitTierRouting(task, catalog);
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
  const choice = explicit && !gradedExplicit ? 'candidate_id' : 'route_class';
  // A graded explicit node names its route by id (its position in the
  // owner's original list); the host then binds that route's surface.
  const routeIDs = gradedExplicit ? (task.host_context?.explicit_routes ?? [])
    .map((route, index) => effectiveExplicitRoutes(task).includes(route) ? explicitRouteNodeID(index) : null)
    .filter(Boolean) : [];
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
      id: gradedExplicit ? {type: 'string', enum: routeIDs} : {type: 'string'}, instruction: {type: 'string'},
      dependencies: gradedExplicit ? {type: 'array', maxItems: 0, items: {type: 'string'}} :
        {type: 'array', maxItems: 8, items: {type: 'string'}},
      kind, [choice]: choice === 'candidate_id' ? {type: 'string', enum: candidateIDs[scope]} :
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

export const COMPACT_PLANNER_PROTOCOL = 'os1-compact-plan-v2';
// Historical raw receipts can be inspected under their explicit old protocol;
// new calls never select it or retry a malformed response with another format.
const legacyCompactPlannerProtocol = 'os1-compact-plan-v1';
const fullPlannerProtocol = 'os1-full-plan-v1';
const plannerRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function plannerKeys(value, required, optional = []) {
  return plannerRecord(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
const canCopyPlannerRequest = task => typeof task?.request === 'string' && task.request.length > 0 &&
  Buffer.byteLength(task.request) <= 12_000;
function compactNodeBranches(task, catalog, now) {
  const full = buildRoutePlanSchema(task, catalog, now).properties.nodes.items;
  return full.oneOf ?? [full];
}
function compactRefsSchema(task) {
  const count = task.material_refs?.length ?? 0;
  return {type: 'array', maxItems: Math.min(128, count), uniqueItems: true,
    items: {type: 'integer', minimum: 0, maximum: Math.max(0, count - 1)}};
}
function compactNodeSchema(branches, task, extraRequired, extraProperties) {
  const properties = {grade: {type: 'string', enum: [...ROUTE_CLASSES]},
    scope: {type: 'string', enum: branches.map(branch => branch.properties.scope.const)},
    ...extraProperties};
  const required = [...extraRequired, 'grade', 'scope'];
  if (branches.some(branch => branch.properties.kind.const !== 'agent')) {
    properties.kind = {type: 'string', enum: [...new Set(branches.flatMap(branch =>
      branch.properties.kind.const ? [branch.properties.kind.const] : branch.properties.kind.enum))]};
    if (branches.every(branch => branch.properties.kind.const !== 'agent')) required.push('kind');
  }
  const writer = branches.find(branch => branch.properties.scope.const === 'workspace_write');
  if (writer) {
    properties.paths = writer.properties.owned_paths;
    if (branches.every(branch => branch.properties.scope.const === 'workspace_write')) required.push('paths');
  }
  if ((task.material_refs?.length ?? 0) > 0) { properties.refs = compactRefsSchema(task); required.push('refs'); }
  return {type: 'object', additionalProperties: false, required, properties};
}
/** The host selects the wire protocol before the call. The model never
 * supplies task identity or authorization, and this compiler does not adopt
 * its grade as quality proof. Full legacy candidate-choice plans stay full. */
export function buildCompactPlannerSchema(task, catalog, now = Date.now()) {
  if (task.mode === 'explicit_routing_test' && !explicitTierRouting(task, catalog))
    throw new RCCRuntimeError('planner_compact_legacy_explicit_forbidden');
  const branches = compactNodeBranches(task, catalog, now);
  if (task.mode === 'explicit_routing_test') {
    const originals = task.host_context?.explicit_routes ?? [], effective = effectiveExplicitRoutes(task);
    const ordinals = originals.map((route, index) => effective.includes(route) ? index + 1 : null).filter(Boolean);
    return {type: 'object', additionalProperties: false, required: ['source', 'nodes'], properties: {
      source: {type: 'string', const: 'routes'}, nodes: {type: 'array', minItems: ordinals.length,
        maxItems: ordinals.length, items: compactNodeSchema(branches, task,
          ['route'], {route: {type: 'integer', enum: ordinals}})}}};
  }
  const nodes = {type: 'array', minItems: 1, maxItems: 8,
      items: compactNodeSchema(branches, task, ['instruction', 'deps'], {
        instruction: {type: 'string', minLength: canCopyPlannerRequest(task) ? 0 : 1, maxLength: 12_000},
        deps: {type: 'array', maxItems: 8, uniqueItems: true, items: {type: 'integer', minimum: 0, maximum: 7}}})};
  const final = {type: 'integer', minimum: 0, maximum: 7};
  // One Auto envelope, not an optional union of request and DAG fields.
  // A single empty instruction copies the immutable original; genuine DAG
  // nodes carry their own nonempty instructions. No source discriminator or
  // root grade/scope can coexist ambiguously with a second set of node fields.
  return {type: 'object', additionalProperties: false, required: ['nodes'], properties: {nodes, final}};
}

/** JSON.parse alone accepts duplicate keys. Scan already-valid JSON to reject
 * ambiguous compact objects (including escaped duplicate keys), never repair
 * them or make another model call. No provider text is executed. */
function strictCompactJSON(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65_536)
    throw new RCCRuntimeError('planner_compact_json_invalid');
  let result;
  try { result = JSON.parse(text); } catch { throw new RCCRuntimeError('planner_compact_json_invalid'); }
  let at = 0;
  const whitespace = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  const string = () => {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') return JSON.parse(text.slice(start, at));
    }
    throw new RCCRuntimeError('planner_compact_json_invalid');
  };
  const value = depth => {
    if (depth > 32) throw new RCCRuntimeError('planner_compact_json_invalid');
    whitespace();
    if (text[at] === '"') { string(); return; }
    if (text[at] === '{') {
      at++; whitespace(); const seen = new Set();
      if (text[at] === '}') { at++; return; }
      while (at < text.length) {
        whitespace(); const key = string();
        if (seen.has(key)) throw new RCCRuntimeError('planner_compact_duplicate_key');
        seen.add(key); whitespace(); at++; value(depth + 1); whitespace();
        if (text[at++] === '}') return;
      }
    } else if (text[at] === '[') {
      at++; whitespace(); if (text[at] === ']') { at++; return; }
      while (at < text.length) { value(depth + 1); whitespace(); if (text[at++] === ']') return; }
    } else {
      const literal = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
      if (literal) { at += literal[0].length; return; }
    }
    throw new RCCRuntimeError('planner_compact_json_invalid');
  };
  value(0); whitespace();
  if (at !== text.length) throw new RCCRuntimeError('planner_compact_json_invalid');
  return result;
}
export function plannerResponseBinding(task) {
  return Object.freeze({task_id: task.task_id, request_sha256: task.request_sha256,
    source_fingerprint: task.source_fingerprint, policy_sha256: task.policy_sha256});
}
export function decodePlannerResponse(rawText, {task, catalog, protocol = fullPlannerProtocol,
  binding = plannerResponseBinding(task), signal, now = Date.now(), annotationNow = Date.now()} = {}) {
  const abort = () => { if (signal?.aborted) throw new RCCRuntimeError('planner_cancelled'); };
  abort();
  if (!plannerKeys(binding, ['task_id', 'request_sha256', 'source_fingerprint', 'policy_sha256']) ||
      Object.entries(binding).some(([key, value]) => task?.[key] !== value))
    throw new RCCRuntimeError('planner_response_binding_changed');
  if (protocol === fullPlannerProtocol) {
    const text = rawText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(text); abort(); return assertPlannerRouteChoice(task, parsed, catalog);
  }
  if (![COMPACT_PLANNER_PROTOCOL, legacyCompactPlannerProtocol].includes(protocol))
    throw new RCCRuntimeError('planner_protocol_invalid');
  const value = strictCompactJSON(rawText), branches = compactNodeBranches(task, catalog, now);
  const invalid = () => { throw new RCCRuntimeError('planner_compact_plan_invalid'); };
  const refs = task.material_refs ?? [];
  const offeredWriter = branches.find(b => b.properties.scope.const === 'workspace_write');
  // In v2's mixed-scope item grammar, paths is a known optional field even
  // on a read-only entry. It cannot create read-only ownership. Accept only
  // schema-valid paths one live offered writer row could own, then retain
  // ZERO owned paths for the read-only node. Never union separate grants or
  // accept this field when the host offered only read-only execution.
  const nonAdoptedReadPaths = entry => {
    const spec = offeredWriter?.properties.owned_paths, paths = entry.paths;
    if (protocol !== COMPACT_PLANNER_PROTOCOL || !Number.isSafeInteger(annotationNow) || annotationNow < 0 ||
        !spec || !Array.isArray(paths) ||
        paths.length < spec.minItems || paths.length > spec.maxItems ||
        paths.some(path => typeof path !== 'string' || !path || Buffer.byteLength(path) > 512 ||
          path.includes('\0') || (spec.items.enum && !spec.items.enum.includes(path)) ||
          (path !== '**' && (isAbsolute(path) || path.startsWith('~') || path.includes('\\') ||
            path.split('/').some(part => !part || part === '.' || part === '..'))))) return false;
    return catalog.candidates.some(row => row.scope === 'workspace_write' && row.permission_profile === 'workspace_write' &&
      !['chatgpt', 'gpt-chat'].includes(row.surface) && dispatchable(row, task, annotationNow) &&
      Array.isArray(row.allowed_paths) && (row.allowed_paths.includes('**') ||
        paths.every(path => row.allowed_paths.some(allowed => path === allowed || path.startsWith(allowed + '/')))));
  };
  const compile = (entry, {id, instruction, dependencies = []}) => {
    if (!ROUTE_CLASSES.includes(entry.grade)) invalid();
    const branch = branches.find(b => b.properties.scope.const === entry.scope);
    if (!branch) invalid();
    const kindSpec = branch.properties.kind, kind = kindSpec.const === 'agent' ? 'agent' : entry.kind;
    if (kindSpec.const ? kind !== kindSpec.const : !kindSpec.enum?.includes(kind)) invalid();
    let paths = [];
    if (entry.scope === 'workspace_write') {
      paths = entry.paths; const spec = branch.properties.owned_paths;
      if (!Array.isArray(paths) || paths.length < spec.minItems || paths.length > spec.maxItems ||
          paths.some(path => typeof path !== 'string' || !path || (spec.items.enum && !spec.items.enum.includes(path)))) invalid();
    } else if (Object.hasOwn(entry, 'paths') && !nonAdoptedReadPaths(entry)) invalid();
    let indices = [];
    if (refs.length > 0) {
      indices = entry.refs;
      if (!Array.isArray(indices) || indices.length > Math.min(128, refs.length) ||
          new Set(indices).size !== indices.length ||
          indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= refs.length)) invalid();
    }
    return {id, instruction, dependencies, kind, route_class: entry.grade, scope: entry.scope,
      owned_paths: paths, context_refs: indices.map(index => refs[index])};
  };
  const entryKeys = (entry, required, scope) => {
    const branch = branches.find(b => b.properties.scope.const === scope);
    if (!branch) return false;
    return plannerKeys(entry, [...required, 'grade', 'scope',
      ...(branch.properties.kind.const === 'agent' ? [] : ['kind']),
      ...(scope === 'workspace_write' ? ['paths'] : []), ...(refs.length ? ['refs'] : [])],
      protocol === COMPACT_PLANNER_PROTOCOL && scope === 'read_only' && offeredWriter ? ['paths'] : []);
  };
  let nodes, final;
  if (task.mode === 'explicit_routing_test') {
    if (!explicitTierRouting(task, catalog) || !plannerKeys(value, ['source', 'nodes']) || value.source !== 'routes' ||
        !Array.isArray(value.nodes)) invalid();
    const original = task.host_context?.explicit_routes ?? [], effective = effectiveExplicitRoutes(task);
    const active = original.map((route, index) => effective.includes(route) ? {route, index} : null).filter(Boolean);
    if (value.nodes.length !== active.length) invalid();
    nodes = value.nodes.map((entry, index) => {
      if (!entryKeys(entry, ['route'], entry?.scope) || entry.route !== active[index].index + 1) invalid();
      return compile(entry, {id: explicitRouteNodeID(active[index].index), instruction: active[index].route.instruction});
    });
  } else if (protocol === legacyCompactPlannerProtocol && value?.source === 'request') {
    if (!entryKeys(value, ['source'], value.scope) || !canCopyPlannerRequest(task)) invalid();
    nodes = [compile(value, {id: 'node_0', instruction: task.request})];
  } else if (protocol === COMPACT_PLANNER_PROTOCOL || value?.source === 'dag') {
    const uniform = protocol === COMPACT_PLANNER_PROTOCOL;
    if (!plannerKeys(value, uniform ? ['nodes'] : ['source', 'nodes'], ['final']) || !Array.isArray(value.nodes) ||
        value.nodes.length < (uniform || !canCopyPlannerRequest(task) ? 1 : 2) || value.nodes.length > 8) invalid();
    const count = value.nodes.length;
    nodes = value.nodes.map((entry, index) => {
      const copyOriginal = uniform && count === 1 && canCopyPlannerRequest(task);
      // The same indivisible-agent source lock used by full plans applies
      // here too. Its typed/bounded instruction is an annotation, not a new
      // task. Deterministic nodes cannot borrow that normalization to change
      // the operation they compute: those still need an exact copy spelling.
      const agent = branches.find(b => b.properties.scope.const === entry?.scope)?.properties.kind.const === 'agent' ||
        entry?.kind === 'agent';
      const copySpelling = entry?.instruction === '' || entry?.instruction === task.request ||
        (task.request.endsWith('\n') && entry?.instruction === task.request.slice(0, -1));
      if (!entryKeys(entry, ['instruction', 'deps'], entry?.scope) ||
          typeof entry.instruction !== 'string' ||
          (copyOriginal ? !(agent || copySpelling) : entry.instruction.length === 0) || entry.instruction.includes('\0') ||
          Buffer.byteLength(entry.instruction) > 12_000 ||
          !Array.isArray(entry.deps) || entry.deps.length > 8 || new Set(entry.deps).size !== entry.deps.length ||
          entry.deps.some(dep => !Number.isSafeInteger(dep) || dep < 0 || dep >= count || dep === index)) invalid();
      return compile(entry, {id: `node_${index}`, instruction: copyOriginal && !agent ? task.request : entry.instruction,
        dependencies: entry.deps.map(dep => `node_${dep}`)});
    });
    const visited = new Set(), visiting = new Set();
    const walk = index => { if (visiting.has(index)) invalid(); if (visited.has(index)) return;
      visiting.add(index); for (const dep of value.nodes[index].deps) walk(dep);
      visiting.delete(index); visited.add(index); };
    for (let i = 0; i < count; i++) walk(i);
    if (Object.hasOwn(value, 'final')) {
      if (!Number.isSafeInteger(value.final) || value.final < 0 || value.final >= count) invalid();
      final = `node_${value.final}`;
    }
  } else invalid();
  abort();
  const plan = {schema: 1, task_id: binding.task_id,
    request_sha256: binding.request_sha256, nodes, ...(final === undefined ? {} : {final_node_id: final})};
  return assertPlannerRouteChoice(task, protocol === COMPACT_PLANNER_PROTOCOL ?
    lockIndivisibleInstruction(plan, task).plan : plan, catalog);
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
  if (!['rcc-intent', 'rcc-catalog', 'rcc-adapter', 'rcc-stage', 'rcc-install-status',
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
 * conversation context, task identity or native source context is altered. */
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
const EXPLICIT_GRADED_PLAN_INSTRUCTIONS = 'RCC EXECUTION PLAN: preserve the original objective and supplied source. The owner named which surface runs each part (explicit_routes, each with an id). Return exactly one independent node per supplied route: id = that route\'s id, instruction = that route\'s instruction byte for byte, dependencies [], kind "agent"; never drop, merge, add, alias or rewrite a route. Grade each node with route_class: trivial = a short factual answer, lookup, arithmetic, formatting or one step; standard = normal coding, analysis or multi-step but routine work; deep = hard design, debugging a non-obvious failure, a proof, long-horizon work, or anything the owner flags as important or hard. Grade the node, not the user; between two grades choose the higher. route_class picks the reasoning tier: the host binds each node to the cheapest model and reasoning effort on its named surface expected to give the same result as that surface\'s strongest model at max reasoning, and re-runs a failed read-only answer once on that strongest route; never name a model, provider, account, effort or candidate. read_only nodes never write and have no owned_paths; a workspace_write node lists the paths it owns. No command, account or permission invention. Return only JSON {schema:1,task_id,request_sha256,nodes:[{id,instruction,dependencies,kind:"agent",route_class,scope,owned_paths,context_refs}]}.';
const GRADED_PLAN_INSTRUCTIONS = 'RCC EXECUTION PLAN: preserve the original objective and supplied source. Decompose only into genuinely separable parts and grade each node with route_class: trivial = a short factual answer, lookup, formatting or one step; standard = normal coding, analysis or multi-step but routine work; deep = hard design, debugging a non-obvious failure, a proof, long-horizon work, or anything the owner flags as important or hard. Grade the node, not the user: a short request can be deep and a long one trivial; between two grades choose the higher. route_class picks the reasoning tier: the host binds each node to the cheapest route (exact model, reasoning effort, surface and quota pool) expected to give the same result as the strongest model at max reasoning, and re-runs a failed read-only answer once on that strongest route; never name a model, provider, account, effort or candidate. availability lists only scopes that can run now. read_only nodes never write and have no owned_paths; a workspace_write node owns the whole workspace, owned_paths ["**"], unless the response schema allows narrower paths, and the host runs writers one at a time. Independent work may be parallel; dependent work must name dependencies. No command, account or permission invention. Return only JSON {schema:1,task_id,request_sha256,nodes:[{id,instruction,dependencies,kind:"agent",route_class,scope,owned_paths,context_refs}]}. For one indivisible task keep instruction equal to the original request. Integration, if actually needed, is an explicit dependent node, not a mandatory summarizer.';

/** A session authorization allowlist is host enforcement state, not material
 * the tools-free planner can retrieve. Project only the typed handoff field;
 * keep the original task/context (and its fingerprint) for native dispatch.
 * Unknown envelopes, literal text, invalid bindings and future formats remain
 * unchanged. This is not a policy summary or permission grant. */
export function plannerContextProjection(context) {
  if (typeof context !== 'string') return context;
  let envelope;
  try { envelope = JSON.parse(context); } catch { return context; }
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const uuid = value => typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
  if (!record(envelope) || envelope.format !== 'os1-session-handoff-v3' ||
      typeof envelope.transcript !== 'string' || !record(envelope.taskContext) ||
      !record(envelope.memoryPaging)) return context;
  const paging = envelope.memoryPaging, snapshot = paging.snapshot, ids = paging.allowedSessionIDs;
  if (!uuid(paging.conversationID) || !uuid(envelope.taskContext.conversationID) ||
      envelope.taskContext.conversationID.toLowerCase() !== paging.conversationID.toLowerCase() ||
      !record(snapshot) || snapshot.kind !== 'snapshot' || !uuid(snapshot.id) ||
      typeof snapshot.sha256 !== 'string' || !HASH.test(snapshot.sha256) ||
      typeof paging.projectID !== 'string' || !Number.isSafeInteger(paging.archivedMessages) ||
      paging.archivedMessages < 0 || !Array.isArray(ids) || ids.length > 4_096 || !ids.every(uuid) ||
      !ids.includes(paging.conversationID) ||
      Object.hasOwn(paging, 'allowedSessionScope')) return context;
  const binding = {kind: 'host_authorization_binding', count: ids.length,
    sha256: sha(Buffer.from(JSON.stringify(ids))), planner_retrieval_authority: false};
  // Avoid increasing small inputs. Order/case/duplicates stay bound by the hash;
  // no sorting or set normalization may silently change authorization identity.
  if (Buffer.byteLength(JSON.stringify(binding)) >= Buffer.byteLength(JSON.stringify(ids))) return context;
  const {allowedSessionIDs: _hostOnly, ...rest} = paging;
  return JSON.stringify({...envelope, memoryPaging: {...rest, allowedSessionScope: binding}});
}

export function plannerWireProtocol(task, catalog, feedback = {}) {
  // A repair must preserve existing node IDs and completed-child state. Never
  // reinterpret that stored full plan as a newly indexed compact DAG.
  return !Object.hasOwn(feedback, 'repair') && plannerRecord(catalog?.model_tiers) &&
    (task.mode !== 'explicit_routing_test' || explicitTierRouting(task, catalog)) ?
    COMPACT_PLANNER_PROTOCOL : fullPlannerProtocol;
}
function compactPlannerInstructions(base, explicit, copyOriginal) {
  // Replace only our old wire-format footer, never any owner policy bytes.
  const semantics = base.replace(/Return only JSON \{schema:1[^\n]*?\}\.[ ]*/, '');
  return semantics + '\nOS1 COMPACT PLAN v2. Return only the schema-constrained JSON, no fences. ' +
    'Task identity, original payloads and authority are bound by the host; never echo or override task_id, request_sha256, model or candidate_id. ' +
    (explicit ? 'Use source:"routes", nodes in exact original route order, each naming its original 1-based route ordinal, grade and scope. Do not repeat route instructions or add dependencies. ' :
      (copyOriginal ? 'For ANY unsplit original task you MUST use {"nodes":[{"instruction":"","grade":"trivial|standard|deep","scope":"read_only|workspace_write","deps":[]}]}; the empty instruction makes the host preserve the original request byte for byte. Do not repeat or rephrase the original. ' :
        'This original request exceeds the node instruction byte bound, so an empty copy instruction is unavailable. Keep its full source in the input; use bounded actual subtask instructions, never truncate source to make an atomic node fit. ') +
      'For genuine decomposition use the SAME nodes envelope with at least two genuinely separate nonempty subtask instructions and zero-based dependency indices; optional final is a node index. Never mix an empty copy instruction with a decomposition. Do not emit source or root-level grade/scope. Do not force an atomic task when decomposition is needed. ') +
    'An execution unit is not a reasoning step: keep an implementation, its routine checks and its completion report in the SAME worker. Do not create a separate completion-note or formatting worker unless it requires genuinely independent verification or external work. ' +
    'Include kind only if the schema requires a choice. Writers must supply paths exactly within the offered ownership schema; no implicit write grant. When materials exist, supply refs as the chosen zero-based indices in material_refs, including [] for an intentionally empty selection. Otherwise omit empty fields.';
}
export function buildBoundedPlannerInput({task, catalog, feedback = {}, policyText, now = Date.now(),
  wireProtocol = fullPlannerProtocol}) {
  const explicit = task.mode === 'explicit_routing_test';
  const gradedExplicit = explicitTierRouting(task, catalog);
  if (![fullPlannerProtocol, COMPACT_PLANNER_PROTOCOL].includes(wireProtocol))
    throw new RCCRuntimeError('planner_protocol_invalid');
  const compact = wireProtocol === COMPACT_PLANNER_PROTOCOL;
  const footer = gradedExplicit ? EXPLICIT_GRADED_PLAN_INSTRUCTIONS : explicit ? EXPLICIT_PLAN_INSTRUCTIONS : GRADED_PLAN_INSTRUCTIONS;
  const instructions = ROUTER_MODE_LOCK + '\n\n' + policyText + '\n\n' + ROUTER_MODE_LOCK + '\n\n' +
    (compact ? compactPlannerInstructions(footer, explicit, canCopyPlannerRequest(task)) : footer);
  // Only an explicit route test on an older catalog shows the planner the
  // candidate catalog. Otherwise it gets no candidate ID (feedback included):
  // a graded explicit test gets the named routes with their ids, anything
  // else what can run now.
  const original = task.host_context?.explicit_routes ?? [];
  const message = 'OS1_RCC_PLAN\n' + JSON.stringify(gradedExplicit ? {task_id: task.task_id,
    request_sha256: task.request_sha256, original_objective: task.objective,
    request: task.request, material_refs: task.material_refs,
    explicit_routes: original.map((route, index) => effectiveExplicitRoutes(task).includes(route) ?
      {id: explicitRouteNodeID(index), surface: route.surface, instruction: route.instruction} : null).filter(Boolean),
    context: plannerContextProjection(task.host_context.context)} : explicit ? {task_id: task.task_id,
    request_sha256: task.request_sha256, original_objective: task.objective,
    request: task.request, material_refs: task.material_refs,
    explicit_routes: effectiveExplicitRoutes(task) ?? [],
    context: task.host_context.context,
    candidate_catalog: compactCandidateCatalog(catalog), feedback} : {task_id: task.task_id,
    request_sha256: task.request_sha256, original_objective: task.objective,
    request: task.request, material_refs: task.material_refs,
    context: plannerContextProjection(task.host_context.context),
    availability: routingAvailability(task, catalog, now)});
  // Only our own visible prompt bytes are bounded here; OpenClaw's hidden
  // system overhead still requires an actual local-model context smoke.
  const responseFormat = compact ? buildCompactPlannerSchema(task, catalog, now) : buildRoutePlanSchema(task, catalog, now);
  if (Buffer.byteLength(instructions) + Buffer.byteLength(message) +
      Buffer.byteLength(JSON.stringify(responseFormat)) > MAX_PLANNER_OWN_INPUT_BYTES)
    throw new RCCRuntimeError('planner_input_budget_exceeded');
  return {instructions, message, responseFormat, ...(compact ? {wireProtocol} : {})};
}

/** The local planner grades nodes; it chooses a row only in an explicit
 * route test on an older catalog (no model_tiers), even if the model ignored
 * the response schema. */
export function assertPlannerRouteChoice(task, plan, catalog = null) {
  if ((task.mode !== 'explicit_routing_test' || explicitTierRouting(task, catalog)) && Array.isArray(plan?.nodes) &&
      plan.nodes.some(node => node !== null && typeof node === 'object' && Object.hasOwn(node, 'candidate_id')))
    throw new RCCRuntimeError('planner_candidate_choice_forbidden');
  return plan;
}

export function plannerCompletionRequest({instructions, message, responseFormat, signal}) {
  return {model: LOCAL_MODEL, messages: [{role: 'user', content: message}],
    systemPrompt: instructions, responseFormat,
    maxTokens: 4_096, temperature: 0, signal, purpose: 'os1.rcc.internal-route-plan'};
}

/** The local completion's own receipt: the pinned Ollama model answered
 * through the direct provider path and stopped normally. Shared by the
 * planner and the local execution surface, each with its own typed code. */
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
export function assertLocalPlannerCompletion(result) {
  return assertLocalModelCompletion(result, 'planner_local_model_receipt_invalid');
}

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
    if (Buffer.byteLength(instructions) + Buffer.byteLength(probe.model_input) > MAX_PLANNER_OWN_INPUT_BYTES)
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
// the SAME local model the planner uses, through the same OpenClaw completion
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
      // The local execution surface runs in the planner's service scope, on
      // the planner's model, and stops with the service.
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
        catalog: task => nativeOperation('rcc-catalog', task),
        plan: async ({ task, catalog, ...feedback }) => {
          const policyText = policy(task);
          const deterministic = deterministicExplicitArithmeticPlan(task, catalog);
          if (deterministic) return deterministic;
          const wireProtocol = plannerWireProtocol(task, catalog, feedback);
          const binding = plannerResponseBinding(task), invocationID = randomUUID();
          const plannerBoundAt = Date.now();
          const {instructions, message, responseFormat} = buildBoundedPlannerInput({task, catalog,
            feedback, policyText, wireProtocol, now: plannerBoundAt});
          const inputSHA256 = sha(Buffer.from(JSON.stringify({instructions, message, responseFormat, wireProtocol})));
          let response;
          try { response = await plannerScope.runInAsyncScope(() => api.runtime.llm.complete(
            plannerCompletionRequest({instructions, message, responseFormat,
              signal: plannerLifetime.signal})));
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
          const rawText = typeof response?.text === 'string' ? response.text : null;
          const stateRoot = process.env.OS1_RCC_STATE_ROOT;
          if (rawText !== null && isAbsolute(stateRoot ?? '') && Buffer.byteLength(rawText) <= 65_536) {
            await writeFile(join(stateRoot, `planner-output-${randomUUID()}.json`), JSON.stringify({
              schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
              policy_sha256: task.policy_sha256, model_requested: LOCAL_MODEL,
              source_fingerprint: binding.source_fingerprint, planner_invocation_id: invocationID,
              planner_wire_protocol: wireProtocol, planner_input_sha256: inputSHA256,
              provider_observed: response?.provider ?? null, model_observed: response?.model ?? null,
              response_model_observed: response?.responseModel ?? null,
              execution_mode_observed: response?.execution?.mode ?? null,
              stop_reason_observed: response?.stopReason ?? null,
              usage_observed: response?.usage ?? null,
              observed_at_ms: Date.now(), output_sha256: sha(Buffer.from(rawText)), text: rawText,
            }), { flag: 'wx', mode: 0o600 }).catch(() => {});
          }
          // The core's independent typed verifier checks objective binding, DAG,
          // permissions, scopes, catalogue and quota before any child dispatch.
          // The compact compiler binds only static host fields, never adopts
          // a grade as quality proof. A malformed compact response does not
          // fall back to full JSON, a retry, or another provider.
          return decodePlannerResponse(assertLocalPlannerCompletion(response), {task, catalog, protocol: wireProtocol,
            binding, signal: plannerLifetime.signal, now: plannerBoundAt});
        },
        execute: (ticket, signal) => local(ticket) ? executeLocal(ticket, signal) :
          nativeOperation('rcc-adapter', ticket, signal),
        // Same pinned native adapter and task owner. A typed, receipt-bound
        // continuation never asks the local planner to choose another route;
        // the local surface has no continuation and refuses one.
        executeContinuation: (ticket, signal) => local(ticket) ? executeLocal(ticket, signal) :
          nativeOperation('rcc-adapter', ticket, signal),
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
