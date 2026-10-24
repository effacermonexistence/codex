import {createHash} from 'node:crypto';

// P1 only: pure decoding/compilation, NOT a route, permission, quality or
// execution gate. Only Core-owned code may supply host/expectedBinding. A
// matching caller-authored hash or boolean cannot turn model output into an
// authority. Native admission must still recheck filesystem/capability facts.
export const LOCAL_PLAN_PROPOSAL_LIMITS = Object.freeze({bytes: 262144, nodes: 8, depth: 12});
const PID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/;
const CORE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const SCOPE = new Set(['read_only', 'workspace_write']);
const NODE_KEYS = ['proposal_node_id', 'instruction', 'requirement_refs', 'dependencies',
  'material_refs', 'proposed_candidate_id', 'proposed_scope', 'proposed_owned_paths',
  'required_output', 'check_refs', 'reason_code'];
const BINDING_KEYS = ['task_id', 'request_sha256', 'source_fingerprint', 'policy_sha256', 'catalog_sha256', 'nonce'];
const HOST_KEYS = ['binding', 'request', 'objective', 'scope', 'allowed_owned_paths',
  'requirement_ids', 'material_aliases', 'candidate_ids', 'check_ids'];
const own = (x, key) => Object.hasOwn(x, key);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length &&
  keys.every(k => own(x, k)) && Object.keys(x).every(k => keys.includes(k));
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const text = (x, bytes) => typeof x === 'string' && x.trim().length > 0 &&
  !/[\u0000\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(x) &&
  !x.includes('\0') && Buffer.byteLength(x, 'utf8') <= bytes;
const ids = (x, limit = 128, re = PID) => Array.isArray(x) && x.length <= limit &&
  new Set(x).size === x.length && x.every(s => typeof s === 'string' && re.test(s));
const pathHint = x => text(x, 1024) && !/[\x00-\x1f\x7f\\:*?\[\]{}]/u.test(x) &&
  !x.startsWith('/') && !x.startsWith('~') &&
  x.split('/').every(p => p !== '' && p !== '.' && p !== '..');
function need(ok, code) { if (!ok) throw new LocalPlanProposalError(code); }
export class LocalPlanProposalError extends Error {
  constructor(code) { super(code); this.name = 'LocalPlanProposalError'; this.code = code; }
}
function freeze(x) {
  if (x && typeof x === 'object') { for (const value of Object.values(x)) freeze(value); Object.freeze(x); }
  return x;
}

/**
 * Extract a CLOSED owner-authored parallel partition, not a model proposal.
 * The caller must be Core and supply its current effective read-only scope.
 * Unsupported/ambiguous text returns null and keeps the existing whole-request
 * route. This grammar neither interprets arbitrary prose nor grants a tool,
 * scope, candidate, quality result, or permission to execute.
 */
export function deriveExplicitParallelOwnerContract(request, options = {}) {
  try {
    if (!plain(options) || Object.keys(options).some(k => !['scope', 'maxNodes'].includes(k)) ||
        Object.values(Object.getOwnPropertyDescriptors(options)).some(d => !own(d, 'value')) ||
        options.scope !== 'read_only' || !text(request, 12000)) return null;
    const maximum = own(options, 'maxNodes') ? options.maxNodes : 4;
    if (!Number.isSafeInteger(maximum) || maximum < 2 || maximum > 4) return null;
    // An owner directive cannot be recovered by interpreting quoted/data/code
    // headers as commands. We deliberately abstain on these unsupported forms.
    if (/```|~~~|^[ \t]*>|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/m.test(request)) return null;
    // A section-shaped line inside a multiline or unterminated quotation is
    // data, not a second owner unit. Closed inline quotations remain data in
    // the exact section. Do not attempt to reinterpret an unsupported span.
    for (const line of request.split(/\r?\n/)) {
      let closing = null, escaped = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (closing !== null) { if (ch === closing) closing = null; continue; }
        if (ch === '"' || ch === '“' || ch === '‘') closing = ch === '“' ? '”' : ch === '‘' ? '’' : ch;
        else if (ch === "'" && !(i > 0 && /[\p{L}\p{N}]/u.test(line[i - 1]) && /[\p{L}\p{N}]/u.test(line[i + 1] ?? ''))) closing = ch;
      }
      if (closing !== null) return null;
    }
    const headers = [...request.matchAll(/^([A-Za-z]|[1-9])[ \t]*(?:—|–|:|\)|\.)(?:[ \t]+|(?=\r?$))/gm)];
    if (headers.length < 2 || headers.length > maximum || headers[0].index === 0 ||
        new Set(headers.map(h => h[1].toLowerCase())).size !== headers.length) return null;
    const prefix = request.slice(0, headers[0].index), view = prefix.normalize('NFC');
    if (/["“”`]|(?:^|\s)'[^'\n]+'|‘[^’\n]+’/.test(view) || /[?？]/.test(view) ||
        /\b(?:quote|quoted|example|sample|transcript|citation|reported|said|says|wrote|describe|explain|definition|translate|summari[sz]e|proofread)\b|예시|예문|인용|대화\s*기록|전사|번역|요약|설명(?:해|하|해줘)/i.test(view)) return null;
    // Do not turn an unresolved conditional owner instruction into an
    // unconditional execution partition. Leave it with the original route.
    if (/\b(?:if|unless|provided|assuming|approval|permission|authorization|authorisation|consent|approve|approved)\b|\bonly\s+(?:after|once|when)\b|승인|허락|허가|(?:받은|완료된)\s*(?:뒤|후)에만/i.test(view)) return null;
    const parallel = /\b(?:parallel|concurrent(?:ly)?|simultaneous(?:ly)?)\b|병렬|동시/i;
    const independent = /\b(?:independent|separate)\s+(?:tasks?|work(?:ers?|items?)?|units?|requests?|subtasks?)\b|\b(?:tasks?|work|units?|requests?)\b[^.!?\n]{0,64}\bindependent(?:ly)?\b|서로\s*독립|독립(?:된|적인|적|으로)?\s*(?:작업|요청|태스크)|각각\s*(?:별도|따로)\s*(?:하위\s*)?(?:작업|요청|태스크)/i;
    const directive = /\b(?:run|process|handle|execute|perform|do)\b|(?:처리|수행|진행)(?:해|하|합시다)|나눠|분리해/i;
    const negativeParallel = /\b(?:do\s+not|don't|never|avoid|without|no)\b[^.!?\n]{0,64}\b(?:parallel|concurrent(?:ly)?|simultaneous(?:ly)?)\b|(?:병렬|동시)[^.!?\n]{0,40}(?:하지\s*마|금지|말고|않)|\b(?:sequentially|serially)\b|one\s+at\s+a\s+time|순차(?:로|적으로)?\s*(?:실행|처리|수행)|직렬/i;
    const negativeIndependent = /\b(?:not|no|never)\s+(?:mutually\s+)?independent\b|독립[^.!?\n]{0,24}(?:아니|않)|서로\s*의존|\bdepend(?:ent|s|ing)?\s+on\b/i;
    if (!parallel.test(view) || !independent.test(view) || !directive.test(view) ||
        negativeParallel.test(view) || negativeIndependent.test(view)) return null;
    // Require an explicit label enumeration agreeing with EVERY section, in
    // source order. A prefix naming A/B cannot silently authorize extra C/D
    // headers embedded in supplied data; conflicting enumerations abstain.
    const separator = '[ \\t]*(?:,|/|&|\\+|\\band\\b|\\bplus\\b|와|과|및|하고|그리고)[ \\t]*';
    const lists = [...view.matchAll(new RegExp('(?<![A-Za-z0-9_])(?:[A-Za-z]|[1-9])(?:' + separator + '(?:[A-Za-z]|[1-9])){1,7}(?![A-Za-z0-9_])', 'g'))];
    const labels = headers.map(h => h[1]);
    if (lists.length === 0 || lists.some(list => {
      const values = list[0].split(new RegExp(separator, 'g')).filter(Boolean);
      return values.length !== labels.length || values.some((value, i) => value !== labels[i]);
    })) return null;
    // Mixed effectful directives are outside this small read-only grammar.
    // Recognize closed negative constraints, not a negative phrase followed by
    // an unresolved exception/additional command. Native scope checks remain
    // mandatory even when this conservative source extraction succeeds.
    for (const raw of request.split(/[!?;\n]|\.(?=\s|$)/)) {
      const clause = raw.normalize('NFC').trim();
      const effect = /\b(?:create|generate|implement|write|edit|modify|delete|remove|rename|move|copy|overwrite|save|patch|update)\b[^!?;\n]{0,80}(?:\b(?:files?|folders?|directories|directory|repos?|repository|workspace|branch)\b|\b[\w-]+\.[A-Za-z0-9]{1,12}\b)|\b(?:deploy|install|commit|push)\b|(?:파일|폴더|디렉터리|저장소|작업\s*공간|[\w-]+\.[A-Za-z0-9]{1,12})[^!?;\n]{0,40}(?:수정|변경|삭제|작성|생성|저장|고쳐|바꿔|이동|복사)|(?:배포|설치|커밋|푸시)(?:해|하라|하세요|하시오)/i;
      if (!effect.test(clause)) continue;
      const negative = /^(?:do\s+not|don't|never|no)\b/i.test(clause) || /하지\s*(?:마|않)|금지/.test(clause);
      if (!negative || /[,]|\b(?:but|except|instead|then)\b|말고|대신|그리고|한\s*후|한\s*뒤/i.test(clause)) return null;
    }
    const span = (start, end) => ({start_utf16: start, end_utf16: end,
      start_utf8: Buffer.byteLength(request.slice(0, start), 'utf8'),
      end_utf8: Buffer.byteLength(request.slice(0, end), 'utf8')});
    const units = headers.map((h, i) => {
      const end = headers[i + 1]?.index ?? request.length;
      if (request.slice(h.index + h[0].length, end).trim().length === 0) return null;
      return {id: `owner_parallel_${i}`, label: h[1],
        exact_instruction: request.slice(h.index, end), source_span: span(h.index, end)};
    });
    if (units.some(unit => unit === null)) return null;
    // Recognized cross-unit dependence contradicts an independent partition.
    // This is a closed syntax refusal, not a semantic dependency proof.
    const label = '(?:' + labels.join('|') + ')';
    const dependency = new RegExp('(?:[Aa]fter|[Oo]nce|[Ww]hen)\\s+(?:(?:task|unit|step|section)\\s+)?' + label +
      '\\s+(?:completes?|finishes?|returns?|is\\s+(?:complete|finished|done))\\b|' +
      '(?:[Uu]se|[Uu]sing|[Cc]onsume|[Bb]ased\\s+on)\\s+(?:the\\s+)?' + label + "(?:'s|’s)?\\s+(?:result|output)\\b|" +
      '(?:[Uu]se|[Uu]sing|[Cc]onsume)\\s+(?:the\\s+)?(?:result|output)\\s+(?:from|of)\\s+' + label + '(?![A-Za-z0-9_])|' +
      label + '(?:가|이)?\\s*(?:끝나|끝난|완료|종료|반환)|' + label + '(?:의)?\\s*(?:결과|출력)[^.!?\\n]{0,24}(?:사용|이용|받아|기반)');
    if (units.some(unit => dependency.test(unit.exact_instruction))) return null;
    return freeze({schema: 1, kind: 'owner_explicit_parallel_contract', request_sha256: sha(request),
      scope: 'read_only', global_prefix: {text: prefix, source_span: span(0, headers[0].index)}, units,
      final_output: {mode: 'ordered_collection', unit_ids: units.map(unit => unit.id)},
      execution_authorized: false});
  } catch { return null; }
}

// A JSON-only parser with depth/duplicate-key checks. JSON.parse alone silently
// overwrites duplicate keys. Never accept fences, commentary or a JS object
// with accessors/prototypes as a model reply.
function parse(raw) {
  need(typeof raw === 'string' && raw.length > 0 && Buffer.byteLength(raw) <= LOCAL_PLAN_PROPOSAL_LIMITS.bytes,
    'proposal_bytes');
  let at = 0;
  const ws = () => { while (at < raw.length && /[\t\n\r ]/.test(raw[at])) at++; };
  function string() {
    const start = at++;
    while (at < raw.length) {
      const ch = raw[at++];
      if (ch === '\\') { at++; continue; }
      if (ch === '"') { try { return JSON.parse(raw.slice(start, at)); } catch { break; } }
    }
    throw new LocalPlanProposalError('proposal_json');
  }
  function value(depth) {
    need(depth <= LOCAL_PLAN_PROPOSAL_LIMITS.depth, 'proposal_depth'); ws();
    const ch = raw[at];
    if (ch === '"') return string();
    if (ch === '{') {
      at++; ws(); const result = Object.create(null), keys = new Set();
      if (raw[at] === '}') { at++; return result; }
      while (at < raw.length) {
        ws(); need(raw[at] === '"', 'proposal_json'); const key = string();
        need(!keys.has(key), 'proposal_duplicate_key'); keys.add(key);
        ws(); need(raw[at++] === ':', 'proposal_json'); result[key] = value(depth + 1); ws();
        const end = raw[at++]; if (end === '}') return result; need(end === ',', 'proposal_json');
      }
    } else if (ch === '[') {
      at++; ws(); const result = []; if (raw[at] === ']') { at++; return result; }
      while (at < raw.length) {
        result.push(value(depth + 1)); ws(); const end = raw[at++];
        if (end === ']') return result; need(end === ',', 'proposal_json');
      }
    } else {
      const token = raw.slice(at).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
      need(token, 'proposal_json'); at += token.length;
      const result = JSON.parse(token); need(typeof result !== 'number' || Number.isFinite(result), 'proposal_json');
      return result;
    }
    throw new LocalPlanProposalError('proposal_json');
  }
  const result = value(0); ws(); need(at === raw.length, 'proposal_json'); return result;
}

/** Decode strict v2 data. All references remain UNTRUSTED until host matching. */
export function decodeLocalPlanProposal(raw) {
  const p = parse(raw);
  need(exact(p, ['schema', 'kind', 'nodes', 'final_output_proposal']) && p.schema === 2 &&
    p.kind === 'untrusted_local_plan_proposal', 'proposal_shape');
  need(Array.isArray(p.nodes) && p.nodes.length > 0 && p.nodes.length <= LOCAL_PLAN_PROPOSAL_LIMITS.nodes, 'node_count');
  const byID = new Map();
  for (const n of p.nodes) {
    need(exact(n, NODE_KEYS), 'proposal_node_unknown_or_missing_field');
    need(typeof n.proposal_node_id === 'string' && PID.test(n.proposal_node_id) && !byID.has(n.proposal_node_id), 'node_identity');
    // Native Core limits text in UTF-8 bytes, stricter than JSON schema chars.
    need(text(n.instruction, 12000) && text(n.required_output, 4000) && text(n.reason_code, 96), 'node_text');
    need(ids(n.requirement_refs) && n.requirement_refs.length > 0, 'requirement_shape');
    need(ids(n.material_refs) && ids(n.check_refs) && ids(n.dependencies, 8), 'reference_shape');
    need(n.proposed_candidate_id === null || (typeof n.proposed_candidate_id === 'string' && PID.test(n.proposed_candidate_id)), 'candidate_shape');
    need(SCOPE.has(n.proposed_scope), 'scope_invalid');
    need(Array.isArray(n.proposed_owned_paths) && n.proposed_owned_paths.length <= 128 &&
      new Set(n.proposed_owned_paths).size === n.proposed_owned_paths.length && n.proposed_owned_paths.every(pathHint), 'path_hint_invalid');
    need(n.proposed_scope === 'read_only' ? n.proposed_owned_paths.length === 0 : n.proposed_owned_paths.length > 0, 'scope_paths');
    byID.set(n.proposal_node_id, n);
  }
  for (const n of p.nodes) need(n.dependencies.every(id => byID.has(id) && id !== n.proposal_node_id), 'dependency_ref');
  const done = new Set(), visiting = new Set();
  function visit(id) {
    if (done.has(id)) return; need(!visiting.has(id), 'plan_cycle'); visiting.add(id);
    for (const dep of byID.get(id).dependencies) visit(dep);
    visiting.delete(id); done.add(id);
  }
  for (const id of byID.keys()) visit(id);
  const f = p.final_output_proposal;
  need(plain(f) && ['mode', 'node_ids'].every(k => own(f, k)) &&
    Object.keys(f).every(k => ['mode', 'node_ids', 'host_finalizer_candidate_id'].includes(k)) &&
    (!own(f, 'host_finalizer_candidate_id') || f.host_finalizer_candidate_id === null ||
      typeof f.host_finalizer_candidate_id === 'string' && PID.test(f.host_finalizer_candidate_id)) &&
    ['direct_child', 'ordered_collection', 'integration_node'].includes(f.mode) &&
    ids(f.node_ids, 8) && f.node_ids.length > 0 && f.node_ids.every(id => byID.has(id)), 'final_shape');
  if (f.mode === 'ordered_collection') {
    need(p.nodes.every(n => n.dependencies.length === 0) && f.node_ids.length === p.nodes.length &&
      f.node_ids.every((id, i) => id === p.nodes[i].proposal_node_id), 'collection_requires_all_independent_in_host_order');
  } else need(f.node_ids.length === 1, 'final_cardinality');
  const closure = new Set();
  function cover(id) { if (closure.has(id)) return; closure.add(id); for (const dep of byID.get(id).dependencies) cover(dep); }
  for (const id of f.node_ids) cover(id);
  need(closure.size === byID.size, 'final_uncovered_node');
  return freeze(p);
}

function validateBinding(b) {
  need(exact(b, BINDING_KEYS) && CORE_ID.test(b.task_id ?? '') && CORE_ID.test(b.nonce ?? '') &&
    BINDING_KEYS.filter(k => k !== 'task_id' && k !== 'nonce').every(k => typeof b[k] === 'string' && HASH.test(b[k])), 'host_binding_invalid');
}
function hostCopy(host, expected) {
  need(exact(host, HOST_KEYS), 'host_projection_invalid'); validateBinding(host.binding); validateBinding(expected);
  need(BINDING_KEYS.every(k => host.binding[k] === expected[k]), 'host_binding_stale_or_mismatched');
  need(text(host.request, 12000) && sha(host.request) === host.binding.request_sha256 && text(host.objective, 8192), 'host_original_request_invalid');
  need(SCOPE.has(host.scope) && ids(host.requirement_ids) && host.requirement_ids.length > 0 &&
    ids(host.check_ids) && ids(host.candidate_ids, 4096, CORE_ID), 'host_projection_ids_invalid');
  need(Array.isArray(host.allowed_owned_paths) && host.allowed_owned_paths.length <= 128 &&
    new Set(host.allowed_owned_paths).size === host.allowed_owned_paths.length && host.allowed_owned_paths.every(pathHint) &&
    (host.scope !== 'read_only' || host.allowed_owned_paths.length === 0), 'host_owned_paths_invalid');
  need(plain(host.material_aliases) && Object.keys(host.material_aliases).length <= 128 &&
    Object.entries(host.material_aliases).every(([alias, actual]) => PID.test(alias) && text(actual, 1024)) &&
    new Set(Object.values(host.material_aliases)).size === Object.keys(host.material_aliases).length, 'host_material_aliases_invalid');
  // Copy through known keys, never object-spread an untrusted proposal.
  return {binding: Object.fromEntries(BINDING_KEYS.map(k => [k, host.binding[k]])),
    request: host.request, objective: host.objective, scope: host.scope,
    paths: new Set(host.allowed_owned_paths), requirements: new Set(host.requirement_ids),
    checks: new Set(host.check_ids), candidates: new Set(host.candidate_ids),
    materials: new Map(Object.entries(host.material_aliases))};
}

/**
 * Compile new HOST UNBOUND nodes. This cannot execute and must NOT be passed
 * as an already-bound plan. Core must independently bind EVERY node through
 * current route admission, then validate the resulting plan and native ticket.
 * expectedBinding must be obtained afresh from Core-owned state, not the model.
 * Path matching is lexical exact-subset only; native filesystem resolution,
 * symlink/case/resource ownership checks are intentionally still required.
 */
export function compileLocalPlanProposal(raw, hostProjection, expectedBinding) {
  const h = hostCopy(hostProjection, expectedBinding), p = decodeLocalPlanProposal(raw);
  const nodeIDs = new Map(p.nodes.map((n, i) => [n.proposal_node_id, `node_${i}`]));
  const mappedRequirements = new Set();
  const preferences = [], obligations = [];
  const nodes = p.nodes.map(n => {
    need(n.requirement_refs.every(id => h.requirements.has(id)), 'unknown_requirement');
    need(n.material_refs.every(id => h.materials.has(id)), 'unknown_material_alias');
    need(n.check_refs.every(id => h.checks.has(id)), 'unknown_check');
    need(n.proposed_candidate_id === null || h.candidates.has(n.proposed_candidate_id), 'unknown_candidate_hint');
    need(!(h.scope === 'read_only' && n.proposed_scope === 'workspace_write'), 'scope_upgrade');
    need(n.proposed_owned_paths.every(path => h.paths.has(path)), 'owned_path_not_host_allowed');
    for (const id of n.requirement_refs) mappedRequirements.add(id);
    const id = nodeIDs.get(n.proposal_node_id);
    preferences.push({node_id: id, proposed_candidate_id: n.proposed_candidate_id});
    obligations.push({node_id: id, proposal_node_id: n.proposal_node_id,
      requirement_refs: [...n.requirement_refs], check_refs: [...n.check_refs],
      required_output: n.required_output, reason_code: n.reason_code});
    return {id, instruction: n.instruction, dependencies: n.dependencies.map(d => nodeIDs.get(d)),
      kind: 'agent', scope: n.proposed_scope, owned_paths: [...n.proposed_owned_paths],
      context_refs: n.material_refs.map(alias => h.materials.get(alias))};
  });
  need([...h.requirements].every(id => mappedRequirements.has(id)), 'requirement_unmapped');
  need(!own(p.final_output_proposal, 'host_finalizer_candidate_id') ||
    p.final_output_proposal.host_finalizer_candidate_id === null ||
    h.candidates.has(p.final_output_proposal.host_finalizer_candidate_id), 'unknown_host_finalizer_candidate');
  const byID = new Map(nodes.map(n => [n.id, n]));
  const depends = (node, id) => node.dependencies.some(d => d === id || depends(byID.get(d), id));
  const writers = nodes.filter(n => n.scope === 'workspace_write');
  for (let i = 0; i < writers.length; i++) for (let j = i + 1; j < writers.length; j++) {
    const a = writers[i], b = writers[j];
    const overlap = a.owned_paths.some(x => b.owned_paths.some(y => x === y || x.startsWith(y + '/') || y.startsWith(x + '/')));
    need(!overlap || depends(a, b.id) || depends(b, a.id), 'unordered_writer_overlap');
  }
  return freeze({
    provenance: 'host_unbound_plan', binding: h.binding,
    original_objective: {request: h.request, objective: h.objective, request_sha256: h.binding.request_sha256},
    plan: {schema: 1, task_id: h.binding.task_id, request_sha256: h.binding.request_sha256, nodes,
      final_node_id: p.final_output_proposal.mode === 'ordered_collection' ? null : nodeIDs.get(p.final_output_proposal.node_ids[0])},
    candidate_preferences: preferences, node_obligations: obligations,
    // Untrusted separate hint only: never a model-owned writer node,
    // bound candidate_id, filesystem grant or native ticket. Core must check
    // writer-owner scope and current exact catalog again before using it.
    ...(own(p.final_output_proposal, 'host_finalizer_candidate_id') ? {host_finalizer_preference: {
      proposed_candidate_id: p.final_output_proposal.host_finalizer_candidate_id}} : {}),
    coverage: {status: 'interpretation_inferred', structurally_mapped_requirement_ids: [...h.requirements],
      semantic_coverage_verified: false},
    execution_authorized: false, quality_parity_verified: false,
  });
}
