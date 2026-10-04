import { readBoundedJson } from "../../os1-route-core/src/io";

const CAPABILITY_KEY_SETS = [
  "completion_feedback_schema,policy_sha256",
  "completion_feedback_schema,model_availability_schema,policy_sha256",
  "completion_feedback_schema,model_availability_schema,policy_sha256,route_learning_schema",
];

async function capabilities(binding: Fetcher, expectedPolicy: string): Promise<Record<string, unknown> | undefined> {
  try {
    // Name the pinned policy: a worker holding several source-locked adapters
    // (mid-rollover) confirms exactly this one instead of its default.
    const response = await binding.fetch(`https://internal/capabilities?policy=${encodeURIComponent(expectedPolicy)}`, {
      method: "GET", signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return undefined;
    const value = await readBoundedJson(response, 256);
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
      !CAPABILITY_KEY_SETS.includes(Object.keys(value).sort().join())) return undefined;
    const record = value as Record<string, unknown>;
    return record.completion_feedback_schema === 1 && record.policy_sha256 === expectedPolicy &&
      (record.model_availability_schema === undefined || record.model_availability_schema === 1) &&
      (record.route_learning_schema === undefined || [1, 2, 3].includes(record.route_learning_schema as number)) ? record : undefined;
  } catch { return undefined; }
}

/** Support is usable only with the same source-locked adapter as this policy. */
export async function supportsCompletionFeedback(binding: Fetcher, expectedPolicy: string, requireModelAvailability = false): Promise<boolean> {
  const value = await capabilities(binding, expectedPolicy);
  return value !== undefined && (!requireModelAvailability || value.model_availability_schema === 1);
}

const learningSupport = new WeakMap<Fetcher, Map<string, { schema: 0 | 1 | 2 | 3; expires: number }>>();
const startupSupport = new WeakMap<Fetcher, Map<string, { verifiedAt: number; expires: number }>>();
type LearningSchema = 0 | 1 | 2 | 3;
type LogicalReceipt = { verifiedAt: number; expires: number; learningSchema: LearningSchema };
type LogicalScope = string & { readonly __capability_scope: unique symbol };
const logicalSupport = new Map<LogicalScope, LogicalReceipt>();
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SERVICE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const POLICY = /^[0-9a-f]{64}$/;

/** Version metadata is supplied by the Cloudflare runtime, not a request or
 * caller label. Code/config changes receive a different version. Invalid or
 * absent deployment metadata keeps the original per-binding fallback only. */
export function capabilityCacheScope(env: { WORKER_VERSION?: unknown; RCC_SERVICE_ID?: unknown }, policy: string): LogicalScope | undefined {
  const version = env.WORKER_VERSION;
  if (typeof version !== "object" || version === null || Array.isArray(version) ||
    typeof (version as Record<string, unknown>).id !== "string" || !VERSION.test((version as { id: string }).id) ||
    typeof env.RCC_SERVICE_ID !== "string" || !SERVICE.test(env.RCC_SERVICE_ID) || !POLICY.test(policy)) return undefined;
  return `${(version as { id: string }).id}|${env.RCC_SERVICE_ID}|${policy}` as LogicalScope;
}

function seedLearning(binding: Fetcher, policy: string, schema: LearningSchema, expires: number): void {
  const entries = learningSupport.get(binding) ?? new Map();
  entries.set(policy, { schema, expires }); learningSupport.set(binding, entries);
}

/** One fresh pinned-policy response certifies the advertised schemas together.
 * Seed only the existing short-lived learning metadata cache, never credentials,
 * authorization, route decisions or an unsuccessful probe. The actual route
 * still validates the pinned adapter and every model tuple independently. */
export async function completionCapabilityState(binding: Fetcher, expectedPolicy: string, nowMs = Date.now(), allowCached = false,
  logicalScope?: LogicalScope): Promise<{
  feedback: boolean; modelAvailability: boolean;
}> {
  // A caller may not reuse a scope constructed for another policy argument.
  if (logicalScope && !logicalScope.endsWith(`|${expectedPolicy}`)) logicalScope = undefined;
  if (logicalScope) {
    const receipt = logicalSupport.get(logicalScope);
    if (allowCached && receipt && nowMs >= receipt.verifiedAt && nowMs < receipt.expires) {
      seedLearning(binding, expectedPolicy, receipt.learningSchema, receipt.expires);
      console.log(JSON.stringify({ event: "capability_positive_cache_hit", hit: true, age_ms: nowMs - receipt.verifiedAt }));
      return { feedback: true, modelAvailability: true };
    }
    if (receipt && (nowMs < receipt.verifiedAt || nowMs >= receipt.expires)) logicalSupport.delete(logicalScope);
    if (allowCached) console.log(JSON.stringify({ event: "capability_positive_cache_hit", hit: false }));
  } else {
    const cached = startupSupport.get(binding)?.get(expectedPolicy);
    if (allowCached && cached && nowMs >= cached.verifiedAt && nowMs < cached.expires) {
      return { feedback: true, modelAvailability: true };
    }
  }
  // Only critical start/retry may reuse a positive, source-bound public schema
  // receipt. Fresh public GET remains fresh. This never authorizes a route:
  // every route still invokes its pinned adapter and checks the model tuple.
  const value = await capabilities(binding, expectedPolicy);
  if (value === undefined) {
    startupSupport.get(binding)?.delete(expectedPolicy);
    if (logicalScope) logicalSupport.delete(logicalScope);
    return { feedback: false, modelAvailability: false };
  }
  const schema = value.route_learning_schema === 3 ? 3 : value.route_learning_schema === 2 ? 2 :
    value.route_learning_schema === 1 ? 1 : 0;
  seedLearning(binding, expectedPolicy, schema, nowMs + 60_000);
  if (value.model_availability_schema === 1) {
    const positives = startupSupport.get(binding) ?? new Map();
    if (!positives.has(expectedPolicy) && positives.size >= 8) positives.delete(positives.keys().next().value!);
    positives.set(expectedPolicy, { verifiedAt: nowMs, expires: nowMs + 60_000 });
    startupSupport.set(binding, positives);
    if (logicalScope) {
      if (!logicalSupport.has(logicalScope) && logicalSupport.size >= 64) logicalSupport.delete(logicalSupport.keys().next().value!);
      logicalSupport.set(logicalScope, { verifiedAt: nowMs, expires: nowMs + 60_000, learningSchema: schema });
    }
  } else {
    startupSupport.get(binding)?.delete(expectedPolicy);
    if (logicalScope) logicalSupport.delete(logicalScope);
  }
  return { feedback: true, modelAvailability: value.model_availability_schema === 1 };
}

/**
 * Which route-learning rows the pinned adapter reads: 0 none, 1 outcome and
 * time (v37), 2 also tokens (v38), 3 also the billed token components (v47).
 * Asked on every route start, so the answer
 * is kept per binding for a minute; a failed probe is not kept, and routing
 * then proceeds without learning.
 */
export async function routeLearningSchema(binding: Fetcher, expectedPolicy: string, nowMs = Date.now()): Promise<0 | 1 | 2 | 3> {
  const cached = learningSupport.get(binding)?.get(expectedPolicy);
  if (cached && cached.expires > nowMs) return cached.schema;
  const value = await capabilities(binding, expectedPolicy);
  if (value === undefined) return 0;
  const schema = value.route_learning_schema === 3 ? 3 : value.route_learning_schema === 2 ? 2 :
    value.route_learning_schema === 1 ? 1 : 0;
  const entries = learningSupport.get(binding) ?? new Map();
  entries.set(expectedPolicy, { schema, expires: nowMs + 60_000 });
  learningSupport.set(binding, entries);
  return schema;
}

/** Whether the pinned adapter ranks routes by server-recorded outcomes. */
export async function supportsRouteLearning(binding: Fetcher, expectedPolicy: string, nowMs = Date.now()): Promise<boolean> {
  return (await routeLearningSchema(binding, expectedPolicy, nowMs)) > 0;
}
