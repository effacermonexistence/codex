#!/usr/bin/env node
/** OS-1 build 447, lead correction 2 (DESIGN-8, 2026-10-29): each quota
 * pool's rate-limit state, read only from local files, for the routing law's
 * derived pool exchange (Core lawPoolPrice) and the corpus replay at the
 * pools' real headroom. Zero quota: no network, provider or model.
 *
 *   node scripts/routing-law-pools.mjs [--codex-sessions <dir>] [--claude-quota <file>] [--backend-health <file>]
 *     [--days 3] [--now <ISO>] [--out <file>]
 *
 * Read, and nothing else:
 *  - Codex: the `token_count` events of the rollouts under ~/.codex/sessions
 *    (the last `--days` day directories): payload.rate_limits only (limit id,
 *    plan type, window length, used percent, reset time). Each account-week is
 *    a (limit id, plan, reset time within 120 s) cluster; the ACTIVE account is
 *    the one with the latest observation (OS-1 dispatches through the active
 *    account). No account id, credit balance or text is read into the output.
 *  - Claude: OS-1's shared Claude quota observation (Application
 *    Support/OS-1/claude-quota.json, `snapshot.windows`; else
 *    backend-health.json `claude.quota.windows`): the general windows (no
 *    model or surface scope), their used percent and reset; window length by
 *    the provider's bucket (session = 5 h, weekly_* = 7 d). The account id is
 *    never copied.
 *
 * Output, per pool, the routing_law.pools shape Core reads: {observed_at_ms,
 * valid_until_ms, windows: [{used_percent, resets_at_ms, window_minutes}]},
 * plus the price lawPoolPrice derives at `now` and, for Codex, every
 * account-week seen. valid_until_ms is the host's retained-observation bound
 * (observed + 600 s, never past a reset): older data is stale and Core falls
 * back conservatively (lawPoolPrice). */
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const RETAINED_MS = 600_000; // BackendHealth.QuotaSnapshot.retainedMaximumAge
const CLAUDE_WINDOW_MINUTES = {session: 300, weekly_all: 10080};

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || argv[i + 1] === undefined) throw new Error('bad argument ' + argv[i]);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

/** Every rate_limits observation in the rollouts of the last `days` day directories. */
export function codexObservations(sessionsDir, days, now) {
  const observations = [];
  for (let back = 0; back <= days; back++) {
    const day = new Date(now - back * 86_400_000);
    const dir = join(sessionsDir, String(day.getUTCFullYear()), String(day.getUTCMonth() + 1).padStart(2, '0'),
      String(day.getUTCDate()).padStart(2, '0'));
    // Local and UTC day directories differ near midnight: read both.
    const local = join(sessionsDir, String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0'));
    for (const directory of new Set([dir, local])) {
      if (!existsSync(directory)) continue;
      for (const name of readdirSync(directory)) {
        if (!/^rollout-.*\.jsonl$/.test(name)) continue;
        for (const line of readFileSync(join(directory, name), 'utf8').split('\n')) {
          if (!line.includes('"token_count"') || !line.includes('"rate_limits"')) continue;
          let record;
          try { record = JSON.parse(line); } catch { continue; }
          const limits = record?.payload?.rate_limits;
          const at = Date.parse(record?.timestamp ?? '');
          if (!limits || !Number.isFinite(at) || at > now) continue;
          const windows = ['primary', 'secondary'].map(key => limits[key]).filter(w => w && Number.isFinite(w.used_percent) &&
            Number.isFinite(w.resets_at) && Number.isFinite(w.window_minutes) && w.window_minutes > 0)
            .map(w => ({used_percent: Math.min(100, Math.max(0, w.used_percent)), resets_at_ms: Math.round(w.resets_at * 1000),
              window_minutes: w.window_minutes}));
          if (!windows.length) continue;
          observations.push({at, limit_id: String(limits.limit_id ?? 'codex'), plan: String(limits.plan_type ?? 'unknown'), windows});
        }
      }
    }
  }
  // A rollout read twice (both day directories) adds nothing.
  const seen = new Set();
  return observations.filter(o => { const key = JSON.stringify(o); if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((a, b) => a.at - b.at);
}

/** Account-weeks: (limit id, plan, first window's reset within 120 s). */
export function accountWeeks(observations) {
  const weeks = [];
  for (const o of observations) {
    const reset = o.windows[0].resets_at_ms;
    let week = weeks.find(w => w.limit_id === o.limit_id && w.plan === o.plan && Math.abs(w.reset - reset) <= 120_000);
    if (!week) { week = {limit_id: o.limit_id, plan: o.plan, reset, first_at: o.at, last: o}; weeks.push(week); }
    if (o.at >= week.last.at) week.last = o;
  }
  return weeks;
}

export function codexPool(sessionsDir, days, now) {
  const observations = codexObservations(sessionsDir, days, now);
  if (!observations.length) return {pool: null, weeks: [], observations: 0};
  const weeks = accountWeeks(observations);
  const latest = observations[observations.length - 1];
  const active = weeks.find(w => w.last === latest);
  const pool = {observed_at_ms: latest.at,
    valid_until_ms: Math.min(latest.at + RETAINED_MS, ...latest.windows.map(w => w.resets_at_ms)),
    windows: latest.windows};
  return {pool, observations: observations.length, active: {limit_id: active.limit_id, plan: active.plan},
    weeks: weeks.map(w => ({limit_id: w.limit_id, plan: w.plan, resets_at: new Date(w.last.windows[0].resets_at_ms).toISOString(),
      window_minutes: w.last.windows[0].window_minutes, last_used_percent: w.last.windows[0].used_percent,
      last_observed_at: new Date(w.last.at).toISOString(), open_at_now: w.last.windows[0].resets_at_ms > now,
      active: w === active}))};
}

export function claudePool(quotaFile, healthFile) {
  let snapshot = null, source = null;
  try { snapshot = JSON.parse(readFileSync(quotaFile, 'utf8'))?.snapshot ?? null; source = 'claude-quota.json snapshot'; } catch { /* absent */ }
  if (!snapshot?.windows) {
    try { snapshot = JSON.parse(readFileSync(healthFile, 'utf8'))?.claude?.quota ?? null; source = 'backend-health.json claude.quota'; } catch { /* absent */ }
  }
  if (!snapshot?.windows || !snapshot.observedAt) return {pool: null, source: null};
  const observed = Date.parse(snapshot.observedAt);
  const windows = snapshot.windows.filter(w => !w.model && !w.surface && Object.hasOwn(CLAUDE_WINDOW_MINUTES, w.bucket) &&
    Number.isFinite(w.usedPercent) && w.resetsAt).map(w => ({used_percent: Math.min(100, Math.max(0, w.usedPercent)),
    resets_at_ms: Date.parse(w.resetsAt), window_minutes: CLAUDE_WINDOW_MINUTES[w.bucket], bucket: w.bucket}));
  if (!Number.isFinite(observed) || !windows.length) return {pool: null, source};
  return {source, scoped_skipped: snapshot.windows.filter(w => w.model || w.surface).map(w => ({bucket: w.bucket, model: w.model ?? null,
      used_percent: w.usedPercent, resets_at: w.resetsAt})),
    pool: {observed_at_ms: observed, valid_until_ms: Math.min(observed + RETAINED_MS, ...windows.map(w => w.resets_at_ms)),
      windows: windows.map(({bucket, ...w}) => w)}, buckets: windows.map(w => w.bucket)};
}

export async function readPools({codexSessions = join(homedir(), '.codex/sessions'),
  claudeQuota = join(homedir(), 'Library/Application Support/OS-1/claude-quota.json'),
  backendHealth = join(homedir(), 'Library/Application Support/OS-1/backend-health.json'), days = 3, now = null} = {}) {
  const core = await import(pathToFileURL(join(fileURLToPath(new URL('..', import.meta.url)), 'Resources/openclaw-os1-bridge/rcc-runtime.mjs')).href);
  const codex = codexPool(codexSessions, days, now ?? Date.now());
  const claude = claudePool(claudeQuota, backendHealth);
  // The clock is read after the sources (a probe may write a fresher
  // observation while the rollouts are scanned): never before an observation.
  now ??= Date.now();
  const pools = {anthropic_shared: claude.pool, openai_codex: codex.pool};
  const price = pool => {
    const rate = core.lawPoolPrice({routing_law: {pools}}, pool, now, null);
    return {...rate, price: Number.isFinite(rate.price) ? rate.price : 'exhausted',
      fresh: pools[pool] !== null && now <= pools[pool].valid_until_ms};
  };
  return {schema: 1, generated_at: new Date(now).toISOString(),
    formula: 'price(pool) = max over open windows w of ttr_w / remaining_w; remaining_w = 1 - used_w/100; ' +
      'ttr_w = (resets_at_w - now) / window_length_w (Core lawPoolPrice)',
    pools, derived: {anthropic_shared: price('anthropic_shared'), openai_codex: price('openai_codex')},
    sources: {codex: {dir: codexSessions, days, observations: codex.observations, active_account: codex.active ?? null,
      account_weeks: codex.weeks}, claude: {file: claude.source, buckets: claude.buckets ?? [], scoped_skipped: claude.scoped_skipped ?? []}}};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const o = options(process.argv.slice(2));
  const result = await readPools({codexSessions: o['codex-sessions'], claudeQuota: o['claude-quota'], backendHealth: o['backend-health'],
    days: o.days ? Number(o.days) : undefined, now: o.now ? Date.parse(o.now) : undefined});
  const text = JSON.stringify(result, null, 1) + '\n';
  if (o.out) writeFileSync(o.out, text); else process.stdout.write(text);
}
