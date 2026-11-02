// Build 447 (DESIGN-8 step 6, lead correction 3): the paired-audit harness's
// PAID dispatcher, for the lead's audit run after the zero-quota review. Never
// called by a test, the replay or the plan: `routing-law-audit.mjs run`
// imports it only with `--dispatcher` and refuses a paid dispatcher without
// `--confirm-paid yes`, outside the weekly cap, or without frozen checklists.
//
// Build 448: the local model's arm runs on the local Ollama (dispatchLocal).
// The family audits of routing-law-audit.mjs (a cloud cell against its
// reference): one answer-shaped call per arm on the exact (surface, model,
// effort), with no tools, no MCP servers, no session persistence and the
// user's own config and customizations off, so both arms run the same bare
// harness (a model comparison; the F1 checklist audit's reference arm runs
// OS-1's own, below):
//  - Codex:  codex exec --skip-git-repo-check --ephemeral --ignore-user-config
//            --sandbox read-only -m <model> -c model_reasoning_effort="<effort>"
//            --json -o <last message file> -  (the request on stdin)
//  - Claude: claude --print --safe-mode --model <model> [--effort <effort>]
//            --tools "" --strict-mcp-config --mcp-config {"mcpServers":{}}
//            --no-session-persistence --output-format json  (request on stdin)
// The draw is priced the way the law prices quota: the call's API-equivalent
// list cost (Resources/model-price-table.json; Claude reports it, Codex is
// priced from the token counts it reports) times the measured pool % per
// dollar of the committed quota snapshot (scripts/routing-law-quota-*.json).
//
// Round 5 of the 448 review: the F1 checklist audit's REFERENCE arm
// (`via: 'os1'`) runs through OS-1 itself, the harness the owner's reference
// answer gets (the delegated envelope, the executor instructions and its
// signed ticket, HarnessProfile.current), not the bare one above: `os1 run
// --prompt <request> --output-format json --max-native-dispatches 1` on a
// fresh empty workspace (a first turn), with the binary's version required to
// be this source's (so its harness is this source's pinned profile). The run
// must have bound exactly the plan's reference row (the law's F1 argmin at
// the planned pools; anything else is no reference answer and stops the
// audit); its output is the answer, its draw the routing ledger's usage of
// that task priced as above. The cell arm is the production local ticket
// (dispatchLocal), so both arms are what the owner would get.
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const paid = true;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRICES = JSON.parse(readFileSync(join(ROOT, 'Resources/model-price-table.json'), 'utf8')).models;
const QUOTA = JSON.parse(readFileSync(join(ROOT, 'scripts/routing-law-quota-20261030.json'), 'utf8')).conversions;
const codexConversion = model => model === 'gpt-6-astra' ? QUOTA.openai_codex['gpt-6-astra'] :
  /sol/.test(model) ? QUOTA.openai_codex.sol_family : QUOTA.openai_codex.luna_terra;

function run(command, args, input, timeoutMs = 900_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(command + ' timed out')); }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`${command} exit ${code}: ${stderr.slice(-400)}`)); });
    child.stdin.end(input);
  });
}

/** Build 448: the local model's arm of a local (c) audit, exactly as the
 * production local worker answers an Auto node (rcc-plugin's request: the
 * conversational system prompt, its 512-token cap, temperature 0, no
 * reasoning) on the local Ollama; it draws no pool quota. */
async function dispatchLocal({model, request, style = 'conversational'}) {
  const plugin = await import('../Resources/openclaw-os1-bridge/rcc-plugin.mjs');
  const runtime = await import('../Resources/openclaw-os1-bridge/resource-usage.mjs');
  runtime.configureLocalModel(model);
  // Round 4 of the 448 review (lead decision 3): the F1 audit's local arm gets
  // the prompt the runtime gives the local ticket (small talk's own, or the
  // conversational one).
  if (!['conversational', 'small_talk'].includes(style)) throw new Error('local audit style ' + style);
  const built = plugin.localWorkerCompletionRequest({instruction: request, style});
  const response = await fetch((process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434') + '/api/chat', {method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({model: built.model.replace(/^ollama\//, ''), stream: false, think: false,
      messages: [{role: 'system', content: built.systemPrompt}, ...built.messages],
      options: {temperature: built.temperature, num_predict: built.maxTokens}})});
  if (!response.ok) throw new Error('local model HTTP ' + response.status);
  const body = await response.json();
  return {output: plugin.normalizeLocalOutput(String(body?.message?.content ?? '')), draw: {pool: 'none', units: 0}};
}

/** This source's runtime version string (SelfUpdateCommands.swift) and
 * shipped harness (HarnessProfile.current). */
export function sourceIdentity() {
  const version = /^let os1RuntimeVersionString = "([^"]+)"$/m.exec(readFileSync(join(ROOT, 'Sources/OS1/SelfUpdateCommands.swift'), 'utf8'))?.[1];
  if (!version) throw new Error('no runtime version in the source');
  return {version};
}
/** The routing ledger's usage of one task, priced in its pool's units. */
export function ledgerDraw(ledgerText, taskID) {
  let usd = 0, pool = null, seen = 0, model = null;
  for (const line of String(ledgerText).split('\n')) {
    if (!line.includes(taskID)) continue;
    let record; try { record = JSON.parse(line); } catch { continue; }
    if (record.task_id !== taskID || !record.usage) continue;
    const price = PRICES[record.model];
    if (!price) return null;
    const u = record.usage, write = u.cache_write_tokens ?? 0, read = u.cache_read_tokens ?? 0;
    // OS-1's native usage counts cache writes inside input_tokens.
    usd += (Math.max(0, (u.input_tokens ?? 0) - write) * price.input + write * (price.cache_write ?? price.input) +
      read * price.cached_input + (u.output_tokens ?? 0) * price.output) / 1e6;
    pool = record.quota_pool; model = record.model; seen++;
  }
  if (!seen || !pool) return null;
  const units = pool === 'anthropic_shared' ? usd * QUOTA.anthropic_shared.all : pool === 'openai_codex' ? usd * codexConversion(model) : null;
  return units === null ? null : {pool, units};
}
async function dispatchOS1({surface, model, effort, request}) {
  const bin = process.env.OS1_BIN ?? 'os1';
  const expected = sourceIdentity().version;
  const version = (await run(bin, ['--version'], '', 60_000)).trim();
  if (version !== expected) throw new Error(`os1 is ${version}, not this source's ${expected}`);
  const workspace = mkdtempSync(join(tmpdir(), 'os1-f1-audit-'));
  try {
    const stdout = await run(bin, ['run', '--workspace', workspace, '--prompt', request, '--output-format', 'json',
      '--max-native-dispatches', '1'], '');
    const summary = JSON.parse(stdout);
    const snapshot = summary.rccRuntime ?? null;
    const done = (snapshot?.children ?? []).filter(child => child.state === 'completed');
    const ran = done.map(child => child.selected_config).filter(Boolean)
      .map(c => `${c.surface}:${c.model}@${c.effort}`);
    const route = ran.length === 1 ? ran[0] : ran.join('+') || 'none';
    const ledger = join(homedir(), '.os1/rcc-runtime/routing-ledger/routing-ledger.jsonl');
    const draw = snapshot?.task_id && existsSync(ledger) ? ledgerDraw(readFileSync(ledger, 'utf8'), snapshot.task_id) : null;
    return {output: String(snapshot?.result?.output ?? ''), route, task_id: snapshot?.task_id ?? null, draw,
      expected: `${surface}:${model}@${effort}`, version};
  } finally { rmSync(workspace, {recursive: true, force: true}); }
}

export async function dispatch({surface, model, effort, request, style, via}) {
  if (via === 'os1') {
    const result = await dispatchOS1({surface, model, effort, request});
    const {harnessPin} = await import('./routing-law-table.mjs');
    return {...result, harness: harnessPin()};
  }
  if (surface === 'local') return dispatchLocal({model, request, style});
  if (surface === 'codex') {
    const dir = mkdtempSync(join(tmpdir(), 'os1-audit-'));
    try {
      const last = join(dir, 'last.txt');
      const stdout = await run('codex', ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
        '-m', model, '-c', `model_reasoning_effort="${effort}"`, '--json', '-o', last, '-'], request);
      let usage = null;
      for (const line of stdout.split('\n')) {
        try { usage = JSON.parse(line)?.payload?.info?.total_token_usage ?? JSON.parse(line)?.usage ?? usage; } catch { /* not JSON */ }
      }
      const price = PRICES[model];
      const cached = usage?.cached_input_tokens ?? 0, input = Math.max(0, (usage?.input_tokens ?? 0) - cached);
      const usd = price && usage ? (input * price.input + cached * price.cached_input + (usage.output_tokens ?? 0) * price.output) / 1e6 : null;
      return {output: readFileSync(last, 'utf8'), draw: {pool: 'openai_codex', units: usd === null ? null : usd * codexConversion(model)}};
    } finally { rmSync(dir, {recursive: true, force: true}); }
  }
  if (surface === 'claude' || surface === 'claude-chat') {
    const stdout = await run('claude', ['--print', '--safe-mode', '--model', model, ...(effort && effort !== 'none' ? ['--effort', effort] : []),
      '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence',
      '--output-format', 'json'], request);
    const result = JSON.parse(stdout);
    const usd = Number.isFinite(result.total_cost_usd) ? result.total_cost_usd : null;
    return {output: String(result.result ?? ''), draw: {pool: 'anthropic_shared', units: usd === null ? null : usd * QUOTA.anthropic_shared.all}};
  }
  throw new Error('no audit dispatcher for surface ' + surface);
}
