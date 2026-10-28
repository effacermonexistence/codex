#!/usr/bin/env node
/** OS-1 build 442 (owner order 2026-10-27, DESIGN-3): the capability table.
 *
 * Deterministic and offline: reads only the files it is named, never the
 * network, a provider or a model. It applies the owner's qualification rule
 * at tolerance delta = 0 to the reconciled first-party benchmark rows
 * (scripts/capability-evidence-20261027.json, a verbatim transcription of the
 * reconciliation's out.json) and the compiled list prices
 * (Resources/model-price-table.json), and prints the compiled table whose
 * bytes Resources/model-capability-table.json and
 * Sources/OS1Context/ModelCapabilityTable.swift carry.
 *
 *   node scripts/capability-table.mjs compile --evidence <file> --prices <file> [--out <new file>]
 *   node scripts/capability-table.mjs check --evidence <file> --prices <file> --table <file>
 *
 * The rule (DESIGN-3 "Qualification rule"). Per pool (provider) and category,
 * against that pool's reference model at its max effort, or at its top
 * published effort where max is not published for a benchmark, a (model,
 * effort) QUALIFIES when all three hold:
 *  1. it has at least one CONFIRMED first-party score on a benchmark (and
 *     variant: each variant is its own benchmark row) whose reference score
 *     is confirmed too;
 *  2. on EVERY such shared benchmark it is >= the reference (a lower-is-
 *     better metric is inverted), with no tolerance;
 *  3. it is strictly cheaper than the reference by the price table's typical
 *     call, and on every shared benchmark where both publish a per-task cost
 *     in the same unit its per-task cost is strictly lower.
 * Single-source, disputed and unpublished scores never qualify anything: a
 * benchmark whose reference score is not confirmed is not shared, and a
 * candidate's unconfirmed score is not a score. A score whose effort is not a
 * dispatchable effort ("unspecified", "best of any effort", a fixed thinking
 * budget) is not a score of any (model, effort). The reference itself and its
 * own lower efforts are never cheaper by the typical call (the call shape
 * does not depend on effort), so they never qualify.
 *
 * Two BLOCKERS (build 442 implementation, reported to the lead) keep delta = 0
 * strict where the three conditions alone would admit a row the evidence
 * argues against. They only ever remove a row; nothing is qualified by them:
 *  A. an unconfirmed (single-source or disputed) own score on a shared
 *     benchmark blocks when EVERY value reported for it is below the
 *     reference (Sonnet 5.5 @xhigh GDPval-AA: 1731 or 1725, both < 1735);
 *  B. on a benchmark where the tuple has no confirmed score of its own, a
 *     confirmed score of the SAME model at a HIGHER effort below the
 *     reference blocks it (Opus 5.5 @max is below Fable on OfficeQA, so
 *     Opus @xhigh, unpublished there, is not admitted for writing).
 * With both, the compiled verdicts equal DESIGN-3's evidence table; the
 * literal three conditions (`blockers: false`) would add Sonnet @xhigh to
 * coding and writing and Opus @xhigh to writing.
 *
 * Order of a pool's qualifying list ("ordered by price"): the typical-call
 * USD, then the effort (lower first), then the model name. Within one model
 * the effort order is checked against the evidence: on every benchmark where
 * two qualifying efforts of that model both publish a per-task cost, the
 * lower effort costs no more (compileTable throws otherwise).
 *
 * Never a quality claim about one answer: the table says only what the
 * providers' own benchmarks say. Core labels a capability route "quality
 * unverified". */
import {createHash} from 'node:crypto';
import {closeSync, constants, openSync, readFileSync, writeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const POLICY = 'capability_delta0_v1';
export const TOLERANCE = 0;
/** Dispatchable efforts a benchmark row can be attributed to, in order. */
export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
/** The typical OS-1 delegated call ModelPriceTable.callUSD prices. */
export const TYPICAL_CALL = Object.freeze({uncached_input: 10_000, cached_input: 20_000, output: 1_500});
export const POOLS = Object.freeze({openai: 'openai_codex', anthropic: 'anthropic_shared'});
/** The classifier's domains (LocalRequestClassifier v3) and the evidence's
 * benchmark categories they name. `general` names none: no capability route. */
export const DOMAINS = Object.freeze({
  knowledge: 'explain/knowledge',
  science: 'science/reasoning',
  math: 'math',
  coding: 'coding/agentic',
  writing: 'writing/deliverables',
  tool_use: 'tool-use/web',
});
/** A reference row's per-task cost published in another unit than its
 * candidates' (row note: "cost per solved task"): never compared. Keyed by
 * provider, benchmark, model and reasoning level, exactly as the evidence. */
export const COST_UNIT_OVERRIDES = Object.freeze({
  'anthropic\nSWE-bench Pro subset (Anthropic 478-problem harness, docs)\nclaude-fable-5-1\nhigh (API default; only level published)':
    'usd_per_solved_task',
});
const EPSILON = 1e-9;

/** The dispatchable effort a reported level names, or null ("unspecified",
 * "best of any effort", a fixed budget...). "max (card standard config)" and
 * "medium (API default)" name max and medium; "ultra (Codex)" names ultra. */
export function effortOf(level) {
  if (typeof level !== 'string') return null;
  const base = level.split(' (')[0].split(' /')[0].trim();
  return EFFORTS.includes(base) ? base : null;
}
/** USD of one typical call on `model` from a ModelPriceTable JSON object
 * (same arithmetic as ModelPriceTable.callUSD), or null when unpriced. */
export function typicalCallUSD(prices, model) {
  const price = prices?.models?.[model];
  if (!price) return null;
  return (TYPICAL_CALL.uncached_input * price.input + TYPICAL_CALL.cached_input * price.cached_input +
    TYPICAL_CALL.output * price.output) / 1_000_000;
}
const round6 = value => Math.round(value * 1e6) / 1e6;
function costUnit(row) {
  return COST_UNIT_OVERRIDES[[row.provider, row.benchmark, row.model, row.reasoning_level].join('\n')] ?? 'usd_per_task';
}

/** The reference row of one (provider, benchmark): the reference model's
 * confirmed row at max; with no max row, its top published row (ultra, then a
 * non-effort top label, then xhigh, high, medium, low). A max (or top) row
 * that is not confirmed, or two confirmed rows that disagree, leaves no
 * confirmed reference: the benchmark is not shared. Returns
 * {row, effort} or {row: null, reason}. */
export function referenceRow(rows, reference) {
  const own = rows.filter(row => row.model === reference);
  if (!own.length) return {row: null, reason: 'reference_unpublished'};
  const at = effort => own.filter(row => effortOf(row.reasoning_level) === effort);
  const pick = (candidates, effort) => {
    const confirmed = candidates.filter(row => row.status === 'confirmed');
    if (!confirmed.length) return {row: null, reason: 'reference_' + candidates[0].status};
    if (new Set(confirmed.map(row => row.score)).size !== 1) return {row: null, reason: 'reference_ambiguous'};
    return {row: confirmed[0], effort};
  };
  if (at('max').length) return pick(at('max'), 'max');
  if (at('ultra').length) return pick(at('ultra'), 'ultra');
  const top = own.filter(row => effortOf(row.reasoning_level) === null);
  if (top.length) return pick(top, null);
  for (const effort of ['xhigh', 'high', 'medium', 'low'])
    if (at(effort).length) return pick(at(effort), effort);
  return {row: null, reason: 'reference_unpublished'};
}

/** The rule for one pool and one evidence category. `rows`: the evidence rows
 * of that provider; `reference`: the pool's reference model; `prices`: a
 * ModelPriceTable JSON object; `blockers` (default true): blockers A and B.
 * Returns {reference, qualifying, rejected}. */
export function qualifyCategory(rows, {category, reference, prices, blockers = true}) {
  const inCategory = rows.filter(row => row.category === category);
  const benchmarks = [...new Set(inCategory.map(row => row.benchmark))];
  const references = new Map();
  for (const benchmark of benchmarks) {
    const found = referenceRow(inCategory.filter(row => row.benchmark === benchmark), reference);
    if (found.row) references.set(benchmark, found);
  }
  const referenceUSD = typicalCallUSD(prices, reference);
  // Every (model, effort) the evidence attributes a score to.
  const tuples = new Map();
  for (const row of inCategory) {
    const effort = effortOf(row.reasoning_level);
    if (effort === null) continue;
    const key = row.model + '\n' + effort;
    if (!tuples.has(key)) tuples.set(key, {model: row.model, effort});
  }
  const qualifying = [], rejected = [];
  for (const {model, effort} of tuples.values()) {
    const shared = [];
    let below = null, blocked = null;
    for (const [benchmark, ref] of references) {
      if (model === reference && effort === ref.effort) continue; // the reference row itself
      const lowerBetter = ref.row.lower_better === true;
      const atOrAbove = score => (lowerBetter ? ref.row.score - score : score - ref.row.score) >= -EPSILON;
      const mine = inCategory.filter(row => row.benchmark === benchmark && row.model === model);
      const own = mine.filter(row => effortOf(row.reasoning_level) === effort && row.status === 'confirmed');
      if (blockers && blocked === null) {
        const unconfirmed = mine.filter(row => effortOf(row.reasoning_level) === effort && row.status !== 'confirmed');
        if (!own.length && unconfirmed.length && unconfirmed.every(row => !atOrAbove(row.score)))
          blocked = 'unconfirmed_below_reference:' + benchmark;
        const higher = mine.find(row => row.status === 'confirmed' && effortOf(row.reasoning_level) !== null &&
          EFFORTS.indexOf(effortOf(row.reasoning_level)) > EFFORTS.indexOf(effort) && !atOrAbove(row.score));
        if (!own.length && higher && blocked === null)
          blocked = 'below_reference_at_higher_effort:' + benchmark + '@' + effortOf(higher.reasoning_level);
      }
      if (!own.length) continue;
      // Two confirmed values for one tuple: the worse one stands (never in the 2026-10-27 evidence).
      const score = lowerBetter ? Math.max(...own.map(row => row.score)) : Math.min(...own.map(row => row.score));
      const row = own.find(item => item.score === score);
      const delta = lowerBetter ? ref.row.score - score : score - ref.row.score;
      const entry = {benchmark, category, score, reference_score: ref.row.score,
        reference_effort: ref.effort ?? ref.row.reasoning_level, delta: round6(delta), lower_is_better: lowerBetter,
        unit: row.unit, cost: row.cost ?? null, reference_cost: ref.row.cost ?? null,
        cost_comparable: row.cost != null && ref.row.cost != null && costUnit(row) === costUnit(ref.row),
        sources: [...new Set([...row.sources, ...ref.row.sources])].sort()};
      shared.push(entry);
      if (delta < -EPSILON && below === null) below = entry;
    }
    const usd = typicalCallUSD(prices, model);
    const costlier = shared.find(entry => entry.cost_comparable && !(entry.cost < entry.reference_cost - EPSILON));
    const reason = !shared.length ? 'no_shared_confirmed_benchmark' : below ? 'below_reference:' + below.benchmark :
      blocked !== null ? blocked :
      usd === null || referenceUSD === null ? 'unpriced' : !(usd < referenceUSD - EPSILON) ? 'not_cheaper_typical_call' :
        costlier ? 'per_task_cost_not_lower:' + costlier.benchmark : null;
    if (reason !== null) { rejected.push({model, effort, reason, shared: shared.length}); continue; }
    qualifying.push({model, effort, typical_call_usd: round6(usd),
      benchmarks: shared.sort((a, b) => a.benchmark < b.benchmark ? -1 : a.benchmark > b.benchmark ? 1 : 0)});
  }
  qualifying.sort((a, b) => (a.typical_call_usd - b.typical_call_usd) ||
    (EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(b.effort)) || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
  // The effort order within one model must agree with every first-party
  // per-task cost the evidence publishes for both efforts on one benchmark.
  for (const low of qualifying) for (const high of qualifying) {
    if (low.model !== high.model || EFFORTS.indexOf(low.effort) >= EFFORTS.indexOf(high.effort)) continue;
    for (const benchmark of new Set(inCategory.map(row => row.benchmark))) {
      const cost = effort => inCategory.find(row => row.benchmark === benchmark && row.model === low.model &&
        effortOf(row.reasoning_level) === effort && row.status === 'confirmed' && row.cost != null)?.cost;
      const [a, b] = [cost(low.effort), cost(high.effort)];
      if (a !== undefined && b !== undefined && a > b + EPSILON)
        throw new Error(`capability_effort_order_contradicted:${low.model}:${benchmark}`);
    }
  }
  rejected.sort((a, b) => a.model < b.model ? -1 : a.model > b.model ? 1 : EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(b.effort));
  return {reference: {model: reference, effort: 'max', typical_call_usd: referenceUSD === null ? null : round6(referenceUSD),
    shared_benchmarks: [...references.keys()].sort()}, qualifying, rejected};
}

/** Canonical bytes: sorted keys, no whitespace, a final newline (the same
 * shape as Resources/model-price-table.json). */
export function canonical(value) {
  const sort = item => Array.isArray(item) ? item.map(sort) : item !== null && typeof item === 'object' ?
    Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value)) + '\n';
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The compiled table from the evidence document and the price table JSON
 * (both as bytes, so their hashes are recorded). Pure. */
export function compileTable(evidenceBytes, pricesBytes, {blockers = true} = {}) {
  const evidence = JSON.parse(Buffer.from(evidenceBytes).toString('utf8'));
  const prices = JSON.parse(Buffer.from(pricesBytes).toString('utf8'));
  if (evidence?.schema !== 1 || !Array.isArray(evidence.rows) || !evidence.references ||
      prices?.schema !== 1 || prices.unit !== 'per_1m_tokens' || prices.currency !== 'USD')
    throw new Error('capability_table_input_invalid');
  const categories = {};
  for (const [domain, category] of Object.entries(DOMAINS)) {
    const pools = {};
    for (const [provider, pool] of Object.entries(POOLS)) {
      const reference = evidence.references[provider];
      const result = qualifyCategory(evidence.rows.filter(row => row.provider === provider),
        {category, reference, prices, blockers});
      // A row only a blocker removed: what the three conditions alone would add.
      const blocked = result.rejected.filter(row => /^(?:unconfirmed_below_reference|below_reference_at_higher_effort):/
        .test(row.reason)).map(({model, effort, reason}) => ({model, effort, reason}));
      pools[pool] = {reference: result.reference, qualifying: result.qualifying, blocked,
        rejected_count: result.rejected.length};
    }
    categories[domain] = {evidence_category: category, pools};
  }
  return {schema: 1, policy: POLICY, tolerance: TOLERANCE, compiled_on: evidence.retrieved_on,
    blockers: blockers ? ['unconfirmed_below_reference', 'below_reference_at_higher_effort'] : [],
    evidence_sha256: sha256(evidenceBytes), price_table_sha256: sha256(pricesBytes), typical_call: TYPICAL_CALL,
    basis: 'first_party_benchmarks_delta0_not_an_answer_check', categories};
}

function argumentsOf(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!['--evidence', '--prices', '--out', '--table'].includes(key) || typeof value !== 'string')
      throw new Error('usage: compile|check --evidence <file> --prices <file> [--out <new file>|--table <file>]');
    options[key.slice(2)] = value;
  }
  return {command, options};
}
export function main(argv = process.argv.slice(2)) {
  const {command, options} = argumentsOf(argv);
  if (!['compile', 'check'].includes(command) || !options.evidence || !options.prices)
    throw new Error('usage: compile|check --evidence <file> --prices <file> [--out <new file>|--table <file>]');
  const bytes = canonical(compileTable(readFileSync(options.evidence), readFileSync(options.prices)));
  if (command === 'check') {
    if (!options.table) throw new Error('check needs --table <file>');
    const same = readFileSync(options.table).toString('utf8') === bytes;
    process.stdout.write(same ? 'capability table: compiled = script output\n' : 'capability table: DIFFERS from the script output\n');
    return same ? 0 : 1;
  }
  if (options.out) {
    const fd = openSync(options.out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    try { writeSync(fd, bytes); } finally { closeSync(fd); }
  } else process.stdout.write(bytes);
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(String(error.message ?? error) + '\n'); process.exitCode = 64; }
}
