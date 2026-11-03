#!/usr/bin/env node
/** OS-1 build 448 (small talk: build 449): the terminal public snapshots the REAL durable Core
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
 *  - small_talk_local / small_talk_no_pool / small_talk_hold (DESIGN-9
 *    section 4.8, build 449): owner question 12 (small talk, law F1) is a
 *    subjective request: the owner is the judge and the local row is
 *    admitted by the prior 'local accepted' (form o) on its first turn. On a
 *    catalog of the pool references and the local row it answers in one local
 *    dispatch; with every pool exhausted it still answers (its admission is
 *    evidence by itself), and an unsound (empty) draft is then held, the
 *    draft withheld (small_talk_hold, one local dispatch).
 *  - small_talk_later_turn / small_talk_later_turn_proposal / _hold: the same
 *    on a LATER turn (the host hands the conversation over in
 *    host_context.context, its own transcript blocks), after an OS-1 turn that
 *    neither asks nor proposes, and after OS-1's proposal ("지금 푸시할까요?"):
 *    the reader and the local worker are context-free (round 4 of the 448
 *    review, decision 1), so a reference answers (it sees the turn); pools
 *    exhausted: held, nothing dispatched.
 *  - small_talk_writer_lane: small talk in a writer lane (owner scope
 *    workspace_write, request class writer, writer rows offered): it needs no
 *    tool and no write and the local row has evidence on its first turn (the
 *    owner as judge), so its node runs read-only (a permission only narrows)
 *    and the local row answers. */
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

function runtimeTask(q, catalog, workspace, context = null) {
  const policyText = 'fixture policy';
  const host = {workspace, context, provider_preference: 'auto',
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
export async function runFlow(q, catalog, execute, {context = null} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-law-host-')); await chmod(dir, 0o700);
  const workspace = await mkdtemp(join(tmpdir(), 'os1-law-host-workspace-')); await chmod(workspace, 0o700);
  const tickets = [];
  const task = runtimeTask(q, catalog, workspace, context);
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
const smallTalkLocal = catalog => {
  const references = new Set(['claude-fable-5-1', 'gpt-6-astra']);
  return {...catalog, candidates: catalog.candidates.map(row => row.surface === 'local' || references.has(row.model) ? row :
    {...row, availability: 'unavailable'})};
};
// A later turn: the host hands the recent conversation over (Swift
// SessionHandoff, os1-session-handoff-v3 with prior messages, the host's
// own transcript blocks "SPEAKER:\ntext" joined by blank lines). Review of
// round 3: small talk keeps the local start on a later turn only after an
// OS-1 turn that neither asks nor proposes (LATER_TURN); after OS-1's
// proposal (LATER_PROPOSAL) the context-free local reply would drop it, so a
// reference (which sees the turn) answers.
const LATER_TURN = JSON.stringify({format: 'os1-session-handoff-v3', transcript: 'USER:\n안녕\n\nOS-1:\n안녕하세요! 반가워요.',
  priorMessageCount: 2});
const LATER_PROPOSAL = JSON.stringify({format: 'os1-session-handoff-v3',
  transcript: 'USER:\n테스트 돌려봐\n\nOS-1:\n테스트 통과했어요. 지금 푸시할까요?', priorMessageCount: 2});
// A writer lane: the owner's grant is workspace_write and the host offers
// the writer rows beside the read-only ones (request class writer).
const writerLane = catalog => {
  const pool = catalog.candidates.filter(row => row.surface !== 'local' && row.surface !== 'claude-chat' && row.scope === 'read_only');
  const writers = pool.map(row => ({...row, scope: 'workspace_write', permission_profile: 'workspace_write', allowed_paths: ['**'],
    tools: ['read', 'write', 'execute'], id: 'w' + row.id.slice(1), configuration_sha256: sha('writer:' + row.configuration_sha256)}));
  return {...catalog, owner_scope: 'workspace_write', request_class: 'writer', chat_lane_eligible: false,
    candidates: [...catalog.candidates.filter(row => row.surface !== 'claude-chat'), ...writers]};
};
const routesOf = tickets => tickets.map(t => `${t.selected_config.surface}:${t.selected_config.model}@${t.selected_config.effort}`);
// Round 2 of the 448 review (B): every pool exhausted, as the host observes it
// (each pool's weekly window 100% used; its rows listed, none dispatchable).
const poolsExhausted = catalog => {
  const at = Math.max(...catalog.candidates.map(c => c.availability_observed_at_ms ?? 0));
  const spent = (ttr) => ({observed_at_ms: at, valid_until_ms: at + 600000,
    windows: [{used_percent: 100, resets_at_ms: at + Math.round(ttr * 604800000), window_minutes: 10080}]});
  return {...catalog, routing_law: {...catalog.routing_law, pools: {anthropic_shared: spent(0.2), openai_codex: spent(0.6)}},
    candidates: catalog.candidates.map(row => row.surface === 'local' ? row : {...row, availability: 'unavailable'})};
};
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
  async small_talk_local() {
    const q = question(12);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q, smallTalkLocal), ticket =>
      completed(ticket, {output: '오늘 하루 정말 고생 많으셨어요. 무슨 일 있으셨어요? 푹 쉬세요!'}));
    return {flow: 'small_talk_local', dispatches: tickets.length, snapshot, routes: routesOf(tickets),
      law_family: tickets[0]?.law_family ?? null};
  },
  async small_talk_no_pool() {
    const q = question(12);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q, poolsExhausted), ticket =>
      completed(ticket, {output: '오늘 하루 정말 고생 많으셨어요. 무슨 일 있으셨어요? 푹 쉬세요!'}));
    return {flow: 'small_talk_no_pool', dispatches: tickets.length, snapshot, routes: routesOf(tickets)};
  },
  async small_talk_hold() {
    const q = question(12);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q, poolsExhausted), ticket =>
      completed(ticket, {output: ''}));
    return {flow: 'small_talk_hold', dispatches: tickets.length, snapshot, routes: routesOf(tickets)};
  },
  async small_talk_later_turn() {
    const q = question(12);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q), ticket =>
      completed(ticket, {output: '오늘 하루 정말 고생 많으셨어요. 무슨 일 있으셨어요? 푹 쉬세요!'}), {context: LATER_TURN});
    return {flow: 'small_talk_later_turn', dispatches: tickets.length, snapshot, routes: routesOf(tickets)};
  },
  async small_talk_later_turn_proposal() {
    const q = question(12);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q), ticket =>
      completed(ticket, {output: '피곤하셨군요. 푸시는 지금 진행할까요, 아니면 쉬고 나서 할까요?'}), {context: LATER_PROPOSAL});
    return {flow: 'small_talk_later_turn_proposal', dispatches: tickets.length, snapshot, routes: routesOf(tickets)};
  },
  async small_talk_later_turn_hold() {
    const q = question(12);
    const {snapshot, tickets} = await runFlow(q, freshCatalog(q, poolsExhausted), ticket =>
      completed(ticket, {output: 'never dispatched'}), {context: LATER_PROPOSAL});
    return {flow: 'small_talk_later_turn_hold', dispatches: tickets.length, snapshot, routes: routesOf(tickets)};
  },
  async small_talk_writer_lane() {
    const q = question(12);
    const {snapshot, tickets, saved} = await runFlow(q, freshCatalog(q, writerLane), ticket =>
      completed(ticket, {output: '오늘 하루 정말 고생 많으셨어요. 무슨 일 있으셨어요? 푹 쉬세요!'}));
    return {flow: 'small_talk_writer_lane', dispatches: tickets.length, snapshot, routes: routesOf(tickets),
      scope: saved?.plan?.nodes?.[0]?.scope ?? null};
  },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const flow = FLOWS[process.argv[2]];
  if (!flow) { process.stderr.write('usage: routing-law-host-snapshots.mjs <' + Object.keys(FLOWS).join('|') + '>\n'); process.exit(2); }
  process.stdout.write(JSON.stringify(await flow()));
}
