/**
 * DESIGN CONTRACT ONLY — not imported by the runtime or gateway.
 * Wire schemas and transition validators must be implemented before activation.
 * This contract defines public transport, not proprietary routing policy.
 */
export type ID = string;
export type SHA256 = string; // Runtime: exactly 64 lowercase hex characters.
export type Timestamp = string; // Runtime: RFC 3339 UTC; monotonic time for durations.
export type Provider = "codex" | "claude" | "local";
export type Observed<T> =
  | { state: "known"; value: T; observedAt: Timestamp; evidenceRef: ID }
  | { state: "unknown"; reason: string };

export interface SourceReference {
  id: ID;
  revision: string;
  sha256: SHA256;
  privateArtifactRef: string;
  trust: "retrieved_data";
  relevance: "accepted"; // Relevance gate must run, not merely copy this value.
}

export type Workspace =
  | { kind: "project"; canonicalRoot: string; repositoryIdentity: string;
      resolvedFrom: "explicit_selection" | "conversation" | "verified_registry";
      evidenceRef: ID }
  | { kind: "projectless"; boundedReadRoots: string[] }
  | { kind: "unresolved"; candidateRefs: ID[] };

export interface TaskEnvelope {
  schemaVersion: 1;
  taskID: ID;
  conversationID: ID;
  turnID: ID;
  objective: { revision: number; text: string; sha256: SHA256 };
  workspace: Workspace;
  sources: SourceReference[];
  contextRevision: number;
  authority: { permissionProfile: "read_only" | "workspace_write";
    grantRef: ID; scopeSHA256: SHA256 }; // Never a credential or a self-grant.
  acceptance: { id: ID; hard: boolean; description: string;
    check: "deterministic" | "source_grounded_review" | "user_only" }[];
  budget: { maximumAttempts: number; maximumRuntimeMs: number;
    inputTokenLimit: number | null; outputTokenLimit: number | null;
    billableCostLimit: number | null };
}

export interface CapabilitySnapshot {
  id: ID;
  provider: Provider;
  adapterVersion: string;
  observedAt: Timestamp;
  modelEfforts: { model: string; efforts: string[] }[];
  tools: { name: string; availability: "available" | "absent" | "unknown";
    permission: "allowed" | "ask" | "denied" | "unknown" }[];
  quota: Observed<{ scope: string; models: string[];
    state: "available" | "exhausted"; resetsAt: Timestamp | null }>;
  // Catalog presence alone never sets quota or action permission to available.
}

export type ExecutionState = "queued" | "preflight" | "routing" | "starting"
  | "running" | "awaiting_approval" | "cancel_requested" | "cancelled"
  | "interrupted" | "backend_finished" | "failed" | "reconciliation_required";
export type DeliveryState = "not_ready" | "persisted" | "upload_pending"
  | "uploaded" | "verification_pending" | "verified" | "rejected";
export type TaskState = "in_progress" | "complete" | "needs_input" | "incomplete";
export type Effects = "not_started" | "read_only" | "applied_verified" | "unknown";

export interface Attempt {
  id: ID;
  taskID: ID;
  sequence: number;
  provider: Provider;
  model: string;
  effort: string;
  capabilitySnapshotID: ID;
  execution: ExecutionState;
  delivery: DeliveryState;
  effects: Effects;
  native: { sessionID: ID; turnID: ID | null } | null;
  ticketRef: ID; // Signed secrets live outside the display/event journal.
  lease: { serverReceiptRef: ID; executionDeadline: Timestamp;
    submissionDeadline: Timestamp } | null;
  lastTransportSignalAt: Timestamp | null;
  lastWorkEventAt: Timestamp | null; // Never refreshed by a UI animation.
}

export type FailureCode = "quota_exhausted" | "capability_unavailable"
  | "policy_denied" | "authentication_required" | "provider_unavailable"
  | "context_limit" | "backend_timeout" | "stream_disconnected"
  | "execution_lease_expired" | "artifact_delivery_failed"
  | "verification_unavailable" | "verification_rejected"
  | "objective_incomplete" | "unknown";
export interface Failure {
  layer: "preflight" | "provider" | "transport" | "verification" | "objective";
  code: FailureCode;
  scope: "attempt" | "model" | "quota_bucket" | "provider" | "task" | "service";
  retryAfter: Timestamp | null;
  effects: Effects;
  publicMessage: string; // Sanitized, not raw provider/server stderr.
  privateDiagnosticRef: ID;
}

export interface EventIdentity {
  schemaVersion: 1;
  taskID: ID;
  attemptID: ID;
  sequence: number; // Monotonic per attempt. Replay ignores exact duplicates.
  providerEventID: ID | null;
  observedAt: Timestamp;
}
// No reasoning/thinking, system prompt, raw tool payload, or private policy event.
export type PublicEvent = EventIdentity & (
  | { kind: "state"; state: ExecutionState }
  | { kind: "heartbeat"; origin: "supervisor" | "provider_transport" }
  | { kind: "assistant_delta"; itemID: ID; phase: "commentary" | "answer_preview";
      text: string }
  | { kind: "assistant_item"; itemID: ID; phase: "commentary" | "answer_preview";
      text: string; authority: "provider_completed_item" }
  | { kind: "tool"; itemID: ID; name: string; state: "started" | "finished" | "failed" }
  | { kind: "approval_required"; requestID: ID; scopeSummary: string }
  | { kind: "failure"; failure: Failure }
  | { kind: "result_persisted"; resultID: ID; sha256: SHA256 }
);

export interface Usage {
  accountingVersion: number;
  source: "provider_result" | "native_transcript";
  deduplicationKeys: ID[];
  uncachedInput: number | null;
  cacheCreationInput: number | null;
  cacheReadInput: number | null;
  output: number | null;
  durationMs: number;
  billedAmount: { amount: number; currency: string } | null;
  // Provider-specific input conventions must be normalized before addition.
}

export interface ResultEnvelope {
  id: ID;
  taskID: ID;
  attemptID: ID;
  objectiveSHA256: SHA256;
  sourceSHA256s: SHA256[];
  outputSHA256: SHA256;
  privateLocalArtifactRef: string;
  nativeRecordRef: string;
  persistedAt: Timestamp;
  uploadIdempotencyKey: SHA256;
  delivery: Exclude<DeliveryState, "not_ready">;
  usage: Usage;
  // Persist BEFORE upload. An upload error does not create another Attempt.
}

export interface Completion {
  taskID: ID;
  state: TaskState;
  resultIDs: ID[];
  receiptRefs: ID[];
  checks: { id: ID; hard: boolean; verdict: "pass" | "fail" | "unknown";
    evidenceRefs: ID[] }[];
  // Runtime gate: state=complete iff all required hard checks pass and all
  // required results are durably delivered/verified. Backend exit 0 is insufficient.
}

export type RecoveryAction = "retry_same_result_delivery" | "refresh_capabilities"
  | "request_new_eligible_route" | "await_authorized_input"
  | "read_only_reconciliation" | "recover_same_native_turn" | "stop";
// Runtime invariants:
// 1. Real policy/auth denial is not bypassed by routing to another provider.
// 2. Unknown effects prohibit blind re-execution; no concurrent writer for one task.
// 3. Quota/transport/verification-unavailable never become model-quality failures.
// 4. Source, objective and grant hashes survive handoff unchanged.
// 5. Terminal output/receipt do not disappear on display/transport disconnect.
