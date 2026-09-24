// Cross-task route learning (owner order 2026-09-24): every verified step
// adds one decayed outcome for its (provider, model, effort, task class).
// The RCC policy ranks admitted routes by these counts; nothing here grants
// a route, changes permissions, or stores prompts, answers or principals.

export const LEARNING_HALF_LIFE_MS = 7 * 24 * 3_600_000;
export const LEARNING_CLASSES = new Set(["executed_change", "executed_review", "source_review", "native_record"]);
const LEARNING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_ROWS = 256;
const MAX_DURATION_MS = 86_400_000;

export type LearningObservation = {
  provider: "codex" | "claude";
  model: string;
  effort: string;
  task_class: string;
  adopted: boolean;
  duration_ms: number | null;
};

/** Decayed totals as stored; `dlog` sums ln(seconds) of adopted runs. */
export type StoredLearning = {
  provider: string; model: string; effort: string; task_class: string;
  n: number; s: number; dlog: number; dn: number; at_ms: number;
};

/** The policy wire row: n attempts, s adopted, d geometric-mean seconds. */
export type LearningRow = {
  provider: "codex" | "claude"; model: string; effort: string; class: string;
  n: number; s: number; d: number | null; dn: number;
};

export function validLearningObservation(value: unknown): value is LearningObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).sort().join() === "adopted,duration_ms,effort,model,provider,task_class" &&
    (v.provider === "codex" || v.provider === "claude") &&
    typeof v.model === "string" && MODEL.test(v.model) &&
    typeof v.effort === "string" && LEARNING_EFFORTS.has(v.effort) &&
    typeof v.task_class === "string" && LEARNING_CLASSES.has(v.task_class) &&
    typeof v.adopted === "boolean" &&
    (v.duration_ms === null || (Number.isSafeInteger(v.duration_ms) && (v.duration_ms as number) >= 0 &&
      (v.duration_ms as number) <= MAX_DURATION_MS));
}

function decayFactor(fromMs: number, toMs: number): number {
  return Math.pow(0.5, Math.max(0, toMs - fromMs) / LEARNING_HALF_LIFE_MS);
}

/** One new outcome on top of the decayed previous totals. */
export function updateLearning(previous: StoredLearning | undefined, observation: LearningObservation, nowMs: number): StoredLearning {
  const factor = previous ? decayFactor(previous.at_ms, nowMs) : 0;
  // A measured second is the smallest unit the policy reasons in.
  const seconds = observation.adopted && observation.duration_ms !== null ? Math.max(1, observation.duration_ms / 1000) : null;
  return {
    provider: observation.provider, model: observation.model, effort: observation.effort, task_class: observation.task_class,
    n: (previous?.n ?? 0) * factor + 1,
    s: (previous?.s ?? 0) * factor + (observation.adopted ? 1 : 0),
    dlog: (previous?.dlog ?? 0) * factor + (seconds === null ? 0 : Math.log(seconds)),
    dn: (previous?.dn ?? 0) * factor + (seconds === null ? 0 : 1),
    at_ms: nowMs,
  };
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** Rows decayed to now, strongest first, in the policy's exact wire shape. */
export function exportLearningRows(stored: StoredLearning[], nowMs: number): LearningRow[] {
  return stored
    .filter((row) => (row.provider === "codex" || row.provider === "claude") && MODEL.test(row.model) &&
      LEARNING_EFFORTS.has(row.effort) && LEARNING_CLASSES.has(row.task_class))
    .map((row) => {
      const factor = decayFactor(row.at_ms, nowMs);
      const n = round(row.n * factor, 4);
      const s = Math.min(n, round(row.s * factor, 4));
      const dn = Math.min(s, round(row.dn * factor, 4));
      const d = dn > 0 && row.dn > 0 ? Math.min(86_400, Math.max(1, round(Math.exp(row.dlog / row.dn), 1))) : null;
      return { provider: row.provider as "codex" | "claude", model: row.model, effort: row.effort, class: row.task_class,
        n, s, d, dn: d === null ? 0 : dn };
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
