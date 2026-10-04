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
const EDGE_CACHE_NAME = "os1-private-capability-v1";
type EdgeReceipt = { format: 1; version_id: string; service_id: string; policy_sha256: string;
  completion_feedback_schema: 1; model_availability_schema: 1; route_learning_schema: LearningSchema;
  checked_at: number; expires_at: number };

function scopeIdentity(scope: LogicalScope): { version: string; service: string; policy: string } | undefined {
  const parts = scope.split("|");
  return parts.length === 3 && VERSION.test(parts[0]!) && SERVICE.test(parts[1]!) && POLICY.test(parts[2]!) ?
    { version: parts[0]!, service: parts[1]!, policy: parts[2]! } : undefined;
}
function edgeKey(scope: LogicalScope): Request | undefined {
  const identity = scopeIdentity(scope);
  return identity ? new Request(`https://os1-capability.invalid/v1/${identity.version}/${identity.service}/${identity.policy}`, { method: "GET" }) : undefined;
}
async function edgeHandle(): Promise<Cache | undefined> {
  // Obtain a handle in THIS request's I/O context. Never retain Cache/Response/
  // Request/Fetcher/stub objects or in-flight promises in module-global state.
  try { return typeof caches === "undefined" ? undefined : await caches.open(EDGE_CACHE_NAME); }
  catch { return undefined; }
}
async function evictEdge(scope: LogicalScope): Promise<void> {
  const key = edgeKey(scope); if (!key) return;
  try { const cache = await edgeHandle(); if (cache) await cache.delete(key); } catch { /* Metadata cache is disposable. */ }
}
async function readEdge(scope: LogicalScope, nowMs: number): Promise<LogicalReceipt | undefined> {
  const identity = scopeIdentity(scope), key = edgeKey(scope); if (!identity || !key) return undefined;
  try {
    const cache = await edgeHandle(); if (!cache) return undefined;
    const response = await cache.match(key); if (!response) return undefined;
    const value = await readBoundedJson(response, 1_024);
    if (response.status !== 200 || typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid metadata");
    const v = value as Record<string, unknown>;
    if (Object.keys(v).sort().join() !== "checked_at,completion_feedback_schema,expires_at,format,model_availability_schema,policy_sha256,route_learning_schema,service_id,version_id" ||
      v.format !== 1 || v.version_id !== identity.version || v.service_id !== identity.service || v.policy_sha256 !== identity.policy ||
      v.completion_feedback_schema !== 1 || v.model_availability_schema !== 1 || ![0, 1, 2, 3].includes(v.route_learning_schema as number) ||
      !Number.isSafeInteger(v.checked_at) || !Number.isSafeInteger(v.expires_at) || (v.checked_at as number) < 0 ||
      (v.expires_at as number) <= (v.checked_at as number) || (v.expires_at as number) > (v.checked_at as number) + 60_000 ||
      nowMs < (v.checked_at as number) || nowMs >= (v.expires_at as number)) throw new Error("invalid metadata");
    return { verifiedAt: v.checked_at as number, expires: v.expires_at as number, learningSchema: v.route_learning_schema as LearningSchema };
  } catch { await evictEdge(scope); return undefined; }
}
async function publishEdge(scope: LogicalScope, receipt: LogicalReceipt): Promise<void> {
  const identity = scopeIdentity(scope), key = edgeKey(scope); if (!identity || !key) return;
  const value: EdgeReceipt = { format: 1, version_id: identity.version, service_id: identity.service, policy_sha256: identity.policy,
    completion_feedback_schema: 1, model_availability_schema: 1, route_learning_schema: receipt.learningSchema,
    checked_at: receipt.verifiedAt, expires_at: receipt.expires };
  try {
    const cache = await edgeHandle(); if (!cache) return;
    await cache.put(key, Response.json(value, { headers: { "cache-control": "max-age=60" } }));
  } catch { /* A put failure never downgrades the freshly verified GET result. */ }
}

function retainLogical(scope: LogicalScope, receipt: LogicalReceipt): void {
  if (!logicalSupport.has(scope) && logicalSupport.size >= 64) logicalSupport.delete(logicalSupport.keys().next().value!);
  logicalSupport.set(scope, receipt);
}

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
      console.log(JSON.stringify({ event: "capability_positive_cache_hit", hit: true, cache: "memory", age_ms: nowMs - receipt.verifiedAt }));
      return { feedback: true, modelAvailability: true };
    }
    if (receipt && (nowMs < receipt.verifiedAt || nowMs >= receipt.expires)) logicalSupport.delete(logicalScope);
    if (allowCached) {
      const edge = await readEdge(logicalScope, nowMs);
      if (edge) {
        retainLogical(logicalScope, edge);
        seedLearning(binding, expectedPolicy, edge.learningSchema, edge.expires);
        console.log(JSON.stringify({ event: "capability_positive_cache_hit", hit: true, cache: "edge", age_ms: nowMs - edge.verifiedAt }));
        return { feedback: true, modelAvailability: true };
      }
    }
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
    if (logicalScope) await evictEdge(logicalScope);
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
      const receipt: LogicalReceipt = { verifiedAt: nowMs, expires: nowMs + 60_000, learningSchema: schema };
      retainLogical(logicalScope, receipt);
      await publishEdge(logicalScope, receipt);
    }
  } else {
    startupSupport.get(binding)?.delete(expectedPolicy);
    if (logicalScope) logicalSupport.delete(logicalScope);
    if (logicalScope) await evictEdge(logicalScope);
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
