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
    return record.completion_feedback_schema === 1 && record.policy_sha256 === expectedPolicy ? record : undefined;
  } catch { return undefined; }
}

/** Support is usable only with the same source-locked adapter as this policy. */
export async function supportsCompletionFeedback(binding: Fetcher, expectedPolicy: string, requireModelAvailability = false): Promise<boolean> {
  const value = await capabilities(binding, expectedPolicy);
  return value !== undefined && (!requireModelAvailability || value.model_availability_schema === 1);
}

const learningSupport = new WeakMap<Fetcher, Map<string, { schema: 0 | 1 | 2 | 3; expires: number }>>();
const startupSupport = new WeakMap<Fetcher, Map<string, { verifiedAt: number; expires: number }>>();

/** One fresh pinned-policy response certifies the advertised schemas together.
 * Seed only the existing short-lived learning metadata cache, never credentials,
 * authorization, route decisions or an unsuccessful probe. The actual route
 * still validates the pinned adapter and every model tuple independently. */
export async function completionCapabilityState(binding: Fetcher, expectedPolicy: string, nowMs = Date.now(), allowCached = false): Promise<{
  feedback: boolean; modelAvailability: boolean;
}> {
  const cached = startupSupport.get(binding)?.get(expectedPolicy);
  if (allowCached && cached && nowMs >= cached.verifiedAt && nowMs < cached.expires) {
    return { feedback: true, modelAvailability: true };
  }
  // Only critical start/retry may reuse a positive, source-bound public schema
  // receipt. Fresh public GET remains fresh. This never authorizes a route:
  // every route still invokes its pinned adapter and checks the model tuple.
  const value = await capabilities(binding, expectedPolicy);
  if (value === undefined) {
    startupSupport.get(binding)?.delete(expectedPolicy);
    return { feedback: false, modelAvailability: false };
  }
  const schema = value.route_learning_schema === 3 ? 3 : value.route_learning_schema === 2 ? 2 :
    value.route_learning_schema === 1 ? 1 : 0;
  const entries = learningSupport.get(binding) ?? new Map();
  entries.set(expectedPolicy, { schema, expires: nowMs + 60_000 });
  learningSupport.set(binding, entries);
  if (value.model_availability_schema === 1) {
    const positives = startupSupport.get(binding) ?? new Map();
    if (!positives.has(expectedPolicy) && positives.size >= 8) positives.delete(positives.keys().next().value!);
    positives.set(expectedPolicy, { verifiedAt: nowMs, expires: nowMs + 60_000 });
    startupSupport.set(binding, positives);
  } else startupSupport.get(binding)?.delete(expectedPolicy);
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
