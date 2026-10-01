// Cross-task route learning (owner order 2026-09-24): every verified step
// adds one decayed outcome for its (provider, model, effort, task class).
// The RCC policy ranks admitted routes by these counts; nothing here grants
// a route, changes permissions, or stores prompts, answers or principals.
//
// Schema 2 (owner order 2026-09-24, "토큰을 줄이면서 완료를 더 잘, 더 빠르게"):
// each step also carries the tokens it spent, so the policy can rank routes by
// time AND tokens per verified result. Tokens are weighted to input-token
// equivalents — fresh input + 0.1 × cache reads + 5 × output — which tracks
// quota burn instead of a raw total dominated by cached context.
//
// Schema 3 (owner order 2026-09-30, "코스트 메세지 인 메세지 아웃 그거 정확하게
// 알아야지"): the weighted total above prices a cache write like a cache read
// (0.1x) although providers bill it above fresh input (1.25x), and every
// model has its own cache-read rate (Claude Fable 5.1 0.025x, Opus 5.5 0.05x).
// A v3 result therefore also signs `cache_write_tokens`, and each route keeps
// its mean fresh input, cache reads, cache writes and output per measured
// attempt, so the policy prices a route with that model's own rates.

export const LEARNING_HALF_LIFE_MS = 7 * 24 * 3_600_000;
export const LEARNING_CLASSES = new Set(["executed_change", "executed_review", "source_review", "native_record"]);
const LEARNING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ROWS = 256;
const MAX_DURATION_MS = 86_400_000;
const MAX_TOKENS = 10_000_000_000;
export const CACHE_READ_WEIGHT = 0.1;
export const OUTPUT_WEIGHT = 5;

/**
 * Per-step usage the device signed with its result; counts only. `cache_tokens`
 * is every cached input token (reads and writes); v3 adds `cache_write_tokens`,
 * the part of it written to the cache.
 */
export type StepUsage = {
  input_tokens: number | null; output_tokens: number | null; cache_tokens: number | null;
  cache_write_tokens?: number | null;
};

export function validStepUsage(value: unknown): value is StepUsage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const count = (item: unknown) => item === null || (Number.isSafeInteger(item) && (item as number) >= 0 && (item as number) <= MAX_TOKENS);
  const keys = Object.keys(v).sort().join();
  const v3 = keys === "cache_tokens,cache_write_tokens,input_tokens,output_tokens";
  return (keys === "cache_tokens,input_tokens,output_tokens" || v3) &&
    count(v.input_tokens) && count(v.output_tokens) && count(v.cache_tokens) &&
    (v.cache_tokens === null || v.input_tokens === null || (v.cache_tokens as number) <= (v.input_tokens as number)) &&
    (!v3 || (count(v.cache_write_tokens) &&
      (v.cache_write_tokens === null || (v.cache_tokens !== null && (v.cache_write_tokens as number) <= (v.cache_tokens as number)))));
}

/** Fresh input, cache reads, cache writes and output of one step (schema 3). */
export type UsageComponents = { i: number; r: number; w: number; o: number };

/**
 * The four billed components, or null unless every one was measured: a v2
 * result cannot tell a cache read from a cache write, and an unmeasured
 * count is never read as zero.
 */
export function usageComponents(usage: StepUsage | undefined): UsageComponents | null {
  if (!usage || usage.input_tokens === null || usage.output_tokens === null || usage.cache_tokens === null ||
    usage.cache_write_tokens === undefined || usage.cache_write_tokens === null) return null;
  if (usage.input_tokens + usage.output_tokens <= 0) return null;
  const cache = Math.min(usage.cache_tokens, usage.input_tokens);
  const write = Math.min(usage.cache_write_tokens, cache);
  return { i: usage.input_tokens - cache, r: cache - write, w: write, o: usage.output_tokens };
}

function validComponents(value: unknown): value is UsageComponents {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join() === "i,o,r,w" && ["i", "r", "w", "o"].every((key) =>
    typeof v[key] === "number" && Number.isFinite(v[key]) && (v[key] as number) >= 0 && (v[key] as number) <= MAX_TOKENS);
}

/**
 * Input-token equivalents, or null when the step's usage is not fully known.
 * A step that spent nothing never reached inference; counting it as a real
 * attempt would drag the route's geometric mean toward one token.
 */
export function weightedTokens(usage: StepUsage | undefined): number | null {
  if (!usage || usage.input_tokens === null || usage.output_tokens === null) return null;
  const cache = Math.min(usage.cache_tokens ?? 0, usage.input_tokens);
  const weighted = (usage.input_tokens - cache) + CACHE_READ_WEIGHT * cache + OUTPUT_WEIGHT * usage.output_tokens;
  return weighted > 0 ? weighted : null;
}

export type LearningObservation = {
  provider: "codex" | "claude";
  model: string;
  effort: string;
  task_class: string;
  adopted: boolean;
  duration_ms: number | null;
  /** Weighted tokens this step spent, adopted or not; null when unmeasured. */
  tokens: number | null;
  /** Schema 3: the step's billed components; absent or null when unmeasured. */
  components?: UsageComponents | null;
};

/**
 * Decayed totals as stored; `dlog` sums ln(seconds) of adopted runs and
 * `klog` ln(weighted tokens) of every measured attempt. Rows written before
 * tokens were recorded read `klog`/`kn` as null.
 */
export type StoredLearning = {
  provider: string; model: string; effort: string; task_class: string;
  n: number; s: number; dlog: number; dn: number; at_ms: number;
  klog?: number | null; kn?: number | null;
  /** Schema 3: decayed sums of each component and the decayed count measured. */
  ci?: number | null; cr?: number | null; cw?: number | null; co?: number | null; cn?: number | null;
};

/**
 * The policy wire row: n attempts, s adopted, d geometric-mean seconds.
 * Schema 2 adds k, the geometric-mean weighted tokens per measured attempt,
 * and kn, the decayed number of attempts it is measured over.
 */
export type LearningRow = {
  provider: "codex" | "claude"; model: string; effort: string; class: string;
  n: number; s: number; d: number | null; dn: number;
  k?: number | null; kn?: number;
  /** Schema 3: mean fresh input, cache reads, cache writes, output per measured attempt. */
  u?: UsageComponents | null; un?: number;
};

export function validLearningObservation(value: unknown): value is LearningObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort().join();
  return (keys === "adopted,duration_ms,effort,model,provider,task_class,tokens" ||
    (keys === "adopted,components,duration_ms,effort,model,provider,task_class,tokens" &&
      (v.components === null || validComponents(v.components)))) &&
    (v.provider === "codex" || v.provider === "claude") &&
    typeof v.model === "string" && MODEL.test(v.model) &&
    typeof v.effort === "string" && LEARNING_EFFORTS.has(v.effort) &&
    typeof v.task_class === "string" && LEARNING_CLASSES.has(v.task_class) &&
    typeof v.adopted === "boolean" &&
    (v.duration_ms === null || (Number.isSafeInteger(v.duration_ms) && (v.duration_ms as number) >= 0 &&
      (v.duration_ms as number) <= MAX_DURATION_MS)) &&
    (v.tokens === null || (typeof v.tokens === "number" && Number.isFinite(v.tokens) && v.tokens >= 0 && v.tokens <= MAX_TOKENS * OUTPUT_WEIGHT));
}

function decayFactor(fromMs: number, toMs: number): number {
  return Math.pow(0.5, Math.max(0, toMs - fromMs) / LEARNING_HALF_LIFE_MS);
}

/** One new outcome on top of the decayed previous totals. */
export function updateLearning(previous: StoredLearning | undefined, observation: LearningObservation, nowMs: number): StoredLearning {
  const factor = previous ? decayFactor(previous.at_ms, nowMs) : 0;
  // A measured second is the smallest unit the policy reasons in.
  const seconds = observation.adopted && observation.duration_ms !== null ? Math.max(1, observation.duration_ms / 1000) : null;
  // Tokens count on every attempt: a failed route still spent them, and the
  // policy charges that cost to the route that spent it.
  const tokens = observation.tokens === null ? null : Math.max(1, observation.tokens);
  const parts = observation.components ?? null;
  return {
    provider: observation.provider, model: observation.model, effort: observation.effort, task_class: observation.task_class,
    n: (previous?.n ?? 0) * factor + 1,
    s: (previous?.s ?? 0) * factor + (observation.adopted ? 1 : 0),
    dlog: (previous?.dlog ?? 0) * factor + (seconds === null ? 0 : Math.log(seconds)),
    dn: (previous?.dn ?? 0) * factor + (seconds === null ? 0 : 1),
    at_ms: nowMs,
    klog: (previous?.klog ?? 0) * factor + (tokens === null ? 0 : Math.log(tokens)),
    kn: (previous?.kn ?? 0) * factor + (tokens === null ? 0 : 1),
    ci: (previous?.ci ?? 0) * factor + (parts ? parts.i : 0),
    cr: (previous?.cr ?? 0) * factor + (parts ? parts.r : 0),
    cw: (previous?.cw ?? 0) * factor + (parts ? parts.w : 0),
    co: (previous?.co ?? 0) * factor + (parts ? parts.o : 0),
    cn: (previous?.cn ?? 0) * factor + (parts ? 1 : 0),
  };
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** Rows decayed to now, strongest first, in the policy's exact wire shape. */
export function exportLearningRows(stored: StoredLearning[], nowMs: number, schema: 1 | 2 | 3 = 1): LearningRow[] {
  return stored
    .filter((row) => (row.provider === "codex" || row.provider === "claude") && MODEL.test(row.model) &&
      LEARNING_EFFORTS.has(row.effort) && LEARNING_CLASSES.has(row.task_class))
    .map((row) => {
      const factor = decayFactor(row.at_ms, nowMs);
      const n = round(row.n * factor, 4);
      const s = Math.min(n, round(row.s * factor, 4));
      const dn = Math.min(s, round(row.dn * factor, 4));
      const d = dn > 0 && row.dn > 0 ? Math.min(86_400, Math.max(1, round(Math.exp(row.dlog / row.dn), 1))) : null;
      const base = { provider: row.provider as "codex" | "claude", model: row.model, effort: row.effort, class: row.task_class,
        n, s, d, dn: d === null ? 0 : dn };
      if (schema === 1) return base;
      const storedKn = row.kn ?? 0;
      const kn = Math.min(n, round(storedKn * factor, 4));
      const k = kn > 0 && storedKn > 0 && row.klog !== null && row.klog !== undefined ?
        Math.min(MAX_TOKENS * OUTPUT_WEIGHT, Math.max(1, Math.round(Math.exp(row.klog / storedKn)))) : null;
      const tokenRow = { ...base, k, kn: k === null ? 0 : kn };
      if (schema === 2) return tokenRow;
      // Means are ratios of equally decayed sums: the decay cancels.
      const storedCn = row.cn ?? 0;
      const un = Math.min(n, round(storedCn * factor, 4));
      const mean = (sum: number | null | undefined) => Math.min(MAX_TOKENS, Math.max(0, Math.round((sum ?? 0) / storedCn)));
      const u = un > 0 && storedCn > 0 ? { i: mean(row.ci), r: mean(row.cr), w: mean(row.cw), o: mean(row.co) } : null;
      return { ...tokenRow, u, un: u === null ? 0 : un };
    })
    .filter((row) => row.n >= 0.01)
    .sort((a, b) => b.n - a.n || a.model.localeCompare(b.model) || a.effort.localeCompare(b.effort) || a.class.localeCompare(b.class))
    .slice(0, MAX_ROWS);
}

/** Deterministic per decision, different per run; not a secret. */
export async function routeSeed(executionId: string, attempt: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${executionId}:${attempt}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
