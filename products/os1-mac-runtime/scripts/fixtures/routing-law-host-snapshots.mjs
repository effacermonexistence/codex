#!/usr/bin/env node
/** OS-1 build 448: the terminal public snapshots the REAL durable Core
 * (Resources/openclaw-os1-bridge/rcc-runtime.mjs) hands the host for routing
 * law flows, produced for the host-side regression fixture
 * (Tests/OS1ContextTests/RCCAskBackHostFixture.swift), which decodes each one
 * through RCCRuntimeContract.decodeSnapshot exactly as `os1 run` does
 * (main.swift runOpenClawRCCTask). Live q1 on build 447: Core built the
 * ask-back with zero dispatch and the host rejected its snapshot
 * (invalidSnapshot -> rcc_transport_preserved); every Core fixture passed
 * because none passed Core's snapshot through the host contract.
 *
 * Offline and zero quota: temporary SQLite state, the committed owner fixture's
 * recorded catalogs, a fake executor (no provider, model, network or real HOME).
 *
 *   node scripts/fixtures/routing-law-host-snapshots.mjs <flow>
 *
 * Flows:
 *  - ask_back: owner question 8 (a self-test with no task); the executor throws
 *    if called. Prints {flow, dispatches, snapshot}.
 *  - verified_pass / verified_repair: a law local verified start (build 448)
 *    whose REVAS check passes (the local draft is delivered) or fails (repair
 *    mode at the next frontier step). Prints {flow, dispatches, snapshot}.
 *  - det_pass / det_reread / det_full: owner question 12 (small talk, law F1)
 *    on the local row admitted by Core's deterministic verifier (build 448,
 *    DESIGN-8 step 2 (a), no_claim_reply_v2), on a catalog where its start is
 *    the argmin (every row unavailable but the pool references, the local row
 *    and the F2 judge; the full catalog's argmin is a cloud row the verifier
 *    admits): its pass delivers the draft after one dispatch; a factual claim
 *    (the real local Q12 draft) re-reads it as F2 (the judge checks the draft
 *    and passes it); any other failure (a refusal) is the full answer at the
 *    next step. */
import {createHash} from 'node:crypto';
import {chmod, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lawCatalog} from '../routing-law-replay.mjs';
import {createRCCRuntime, hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = text => createHash('sha256').update(text).digest('hex');
const OWNER = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/routing-law-owner-questions.json'), 'utf8'));
const question = n => OWNER.questions.find(q => q.n === n);

function runtimeTask(q, catalog, workspace) {
  const policyText = 'fixture policy';
  const host = {workspace, context: null, provider_preference: 'auto',
    codex_session_id: null, claude_session_id: null, require_read_only: false, owner_policy: null};
  return {schema: 1, task_id: catalog.task_id, request: q.request, request_sha256: catalog.request_sha256, objective: q.request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60000, max_native_dispatches: 16},
    host_context: host, policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText},
    routing_intent_policy_version: catalog.routing_intent_v2.version};
}
function completed(ticket, patch = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
    task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'fixture answer',
    native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: null, native_turn_terminated: true, ...patch};
}
/** The catalog the host builds for owner question q, observed now. */
export function freshCatalog(q, mutate = catalog => catalog) {
  const catalog = mutate(lawCatalog(q, q.intent));
  const now = Date.now();
  return {...catalog, candidates: catalog.candidates.map(row => ({...row,
    ...(row.availability_observed_at_ms === null ? {} : {availability_observed_at_ms: now, availability_valid_until_ms: now + 600000}),
    ...(row.quota_observed_at_ms === null ? {} : {quota_observed_at_ms: now, quota_valid_until_ms: now + 600000})}))};
}
/** Run owner question q through a real durable Core; returns the terminal
 * public snapshot (what the gateway hands the host) and every ticket. */
export async function runFlow(q, catalog, execute) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-law-host-')); await chmod(dir, 0o700);
  const workspace = await mkdtemp(join(tmpdir(), 'os1-law-host-workspace-')); await chmod(workspace, 0o700);
  const tickets = [];
  const task = runtimeTask(q, catalog, workspace);
  const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => catalog,
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); }});
  try {
    await runtime.submit(task);
    const snapshot = await runtime.wait({schema: 1, task_id: task.task_id}, {timeoutMs: 8000});
    return {snapshot, tickets, saved: runtime._load(task.task_id)};
  } finally {
    await runtime.close();
    await rm(dir, {recursive: true, force: true}); await rm(workspace, {recursive: true, force: true});
  }
}

// Live q2 on 447: the local draft's factual error (a tuple IS indexed).
const Q2_DRAFT = '리스트는 변형이 가능하지만 튜플은 한 번 생성되면 수정할 수 없습니다. 또한 리스트는 배열처럼 인덱스를 통해 ' +
  '접근하는 반면, 튜플은 주로 고정된 데이터 집합을 표현하는 데 사용됩니다.';
const Q2_REPAIRED = '리스트와 튜플 모두 인덱스와 슬라이싱으로 접근합니다. 차이는 변경 가능성입니다.';
// Owner question 12: qwen3.5:9b's real local reply (local Ollama, production
// local chat prompt, temperature 0, 2026-10-31): a self-disclaimer and claims.
const Q12_LOCAL_DRAFT = '안녕하세요! 저는 오늘도 정상적으로 작동하고 있습니다. 하지만 저는 감정이나 피로를 느끼지 못해요. ' +
  '혹시 너무 지치셨다면 잠시 쉬어가시는 게 좋겠습니다.';
const SMALL_TALK_LOCAL = new Set(['claude-chat:claude-opus-5-5@max']);
const smallTalkLocal = catalog => {
  const references = new Set(['claude-fable-5-1', 'gpt-6-astra']);
  return {...catalog, candidates: catalog.candidates.map(row => row.surface === 'local' || references.has(row.model) ||
    SMALL_TALK_LOCAL.has(`${row.surface}:${row.model}@${row.effort}`) ? row : {...row, availability: 'unavailable'})};
};
const routesOf = tickets => tickets.map(t => `${t.selected_config.surface}:${t.selected_config.model}@${t.selected_config.effort}`);
export const FLOWS = {
  async ask_back() {
    const q = question(8);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q), () => { throw new Error('never dispatched'); });
    return {flow: 'ask_back', dispatches: tickets.length, snapshot};
  },
  // Owner question 11 (the live q2 request) as a REVAS verified start of the local row.
  async verified_pass() {
    const q = question(11);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q), (ticket, n) =>
      completed(ticket, {output: n === 1 ? 'a correct local answer' : 'REVAS: PASS'}));
    return {flow: 'verified_pass', dispatches: tickets.length, snapshot,
      routes: tickets.map(t => `${t.selected_config.surface}:${t.selected_config.model}@${t.selected_config.effort}`)};
  },
  async verified_repair() {
    const q = question(11);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q), (ticket, n) =>
      completed(ticket, {output: n === 1 ? Q2_DRAFT : n === 2 ? 'REVAS: FAIL\n1. a tuple is indexed like a list' : Q2_REPAIRED}));
    return {flow: 'verified_repair', dispatches: tickets.length, snapshot,
      routes: tickets.map(t => `${t.selected_config.surface}:${t.selected_config.model}@${t.selected_config.effort}`)};
  },
  async det_pass() {
    const q = question(12);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q, smallTalkLocal), ticket =>
      completed(ticket, {output: '오늘 하루 정말 고생 많으셨어요. 무슨 일 있으셨어요? 푹 쉬세요!'}));
    return {flow: 'det_pass', dispatches: tickets.length, snapshot, routes: routesOf(tickets)};
  },
  async det_reread() {
    const q = question(12);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q, smallTalkLocal), (ticket, n) =>
      completed(ticket, {output: n === 1 ? Q12_LOCAL_DRAFT : 'REVAS: PASS'}));
    return {flow: 'det_reread', dispatches: tickets.length, snapshot, routes: routesOf(tickets)};
  },
  async det_full() {
    const q = question(12);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q, smallTalkLocal), (ticket, n) =>
      completed(ticket, {output: n === 1 ? '죄송하지만 답변해 드릴 수 없습니다.' : '오늘 하루 고생 많으셨어요. 저는 하루를 보내진 않지만, 이야기 들려주시면 좋겠어요.'}));
    return {flow: 'det_full', dispatches: tickets.length, snapshot, routes: routesOf(tickets)};
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const flow = FLOWS[process.argv[2]];
  if (!flow) { process.stderr.write('usage: routing-law-host-snapshots.mjs <' + Object.keys(FLOWS).join('|') + '>\n'); process.exit(2); }
  process.stdout.write(JSON.stringify(await flow()));
}
