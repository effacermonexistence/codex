export type ExecutionSnapshot = {
  execution_id: string;
  subject_hash: string;
  device_id: string;
  sequence: number;
  nonce: string;
  expires_at: number;
  phase: "active" | "complete";
};

export type ResultSnapshot = {
  sequence: number;
  nonce: string;
  result_hash: string;
  response_json: string | null;
};

export type ClaimCommand = {
  subject_hash: string;
  device_id: string;
  sequence: number;
  nonce: string;
  result_hash: string;
  now: number;
};

export type ClaimDecision =
  | { kind: "claimed"; claim_token?: string }
  | { kind: "pending"; retry_after_ms: number }
  | { kind: "completed"; response_json: string }
  | { kind: "rejected" };

export function decideClaim(
  execution: ExecutionSnapshot | undefined,
  previous: ResultSnapshot | undefined,
  command: ClaimCommand,
): ClaimDecision {
  if (
    !execution ||
    execution.subject_hash !== command.subject_hash ||
    execution.device_id !== command.device_id
  ) {
    return { kind: "rejected" };
  }
  if (previous) {
    if (
      previous.nonce !== command.nonce ||
      previous.result_hash !== command.result_hash
    ) {
      return { kind: "rejected" };
    }
    return previous.response_json === null
      ? { kind: "rejected" }
      : { kind: "completed", response_json: previous.response_json };
  }
  if (
    execution.phase !== "active" ||
    execution.sequence !== command.sequence ||
    execution.nonce !== command.nonce ||
    execution.expires_at < command.now
  ) {
    return { kind: "rejected" };
  }
  return { kind: "claimed" };
}
