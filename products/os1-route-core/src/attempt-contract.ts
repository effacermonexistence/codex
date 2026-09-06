import { parseTicket, type Ticket } from "./contracts";
import { reject } from "./errors";
import { base64UrlDecode } from "./crypto";

export type AttemptStart = { ticket: Ticket; device_signature: string };
export function parseAttemptStart(value: unknown): AttemptStart {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join() !== "device_signature,ticket" ||
      typeof v.device_signature !== "string" || !/^[A-Za-z0-9_-]{64,256}$/.test(v.device_signature)) reject();
  return { ticket: parseTicket(v.ticket), device_signature: v.device_signature };
}
export function attemptStartBytes(ticket: Ticket): Uint8Array {
  return new TextEncoder().encode(["os1-attempt-start-v1", ticket.execution_id,
    String(ticket.sequence), ticket.nonce, ticket.signature].join("\n"));
}
export async function verifyAttemptStart(value: AttemptStart, jwk: JsonWebKey): Promise<boolean> {
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
    base64UrlDecode(value.device_signature), attemptStartBytes(value.ticket));
}
export type AttemptCommand = {
  subject_hash: string; device_id: string; sequence: number; nonce: string; now: number;
};
export type AttemptLease = { execution_deadline: number; submission_deadline: number };
// Public operational deadlines, not model selection weights. Start is single-use
// and retries return the original deadlines; no sliding refresh or new authority.
export const EXECUTION_WINDOW_MS = 1_800_000;
export const SUBMISSION_GRACE_MS = 86_400_000;
