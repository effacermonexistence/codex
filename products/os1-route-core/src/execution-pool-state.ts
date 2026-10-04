import { DurableObject } from "cloudflare:workers";
import type { ClaimCommand, ExecutionSnapshot, ResultSnapshot } from "./ledger-model";
import { decideClaim, type ClaimDecision } from "./ledger-model";
import { EXECUTION_WINDOW_MS, SUBMISSION_GRACE_MS, type AttemptCommand, type AttemptLease } from "./attempt-contract";

type BeginCommand = ExecutionSnapshot;
type PoolIdentity = { execution_id: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function identity(command: PoolIdentity): void { if (!UUID.test(command.execution_id)) throw new Error("invalid execution identity"); }

type FinalizeCommand = {
  sequence: number;
  result_hash: string;
  response_json: string;
  claim_token?: string;
  next:
    | null
    | { sequence: number; nonce: string; expires_at: number };
};

type FinalizeDecision =
  | { kind: "stored"; response_json: string }
  | { kind: "completed"; response_json: string }
  | { kind: "rejected" };

type ExecutionRow = ExecutionSnapshot;
type ResultRow = ResultSnapshot;

/** Fixed pool: every row and RPC is explicitly execution-ID bound.
 * Only signed startup-contract tickets select it; legacy objects remain intact. */
export class ExecutionPoolState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS execution (
          execution_id TEXT PRIMARY KEY,
          subject_hash TEXT NOT NULL,
          device_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          nonce TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          phase TEXT NOT NULL CHECK (phase IN ('active', 'complete'))
        );
        CREATE TABLE IF NOT EXISTS results (
          execution_id TEXT NOT NULL, sequence INTEGER NOT NULL,
          nonce TEXT NOT NULL,
          result_hash TEXT NOT NULL,
          response_json TEXT, PRIMARY KEY(execution_id,sequence)
        );
        CREATE TABLE IF NOT EXISTS attempt_leases (
          execution_id TEXT NOT NULL, sequence INTEGER NOT NULL, nonce TEXT NOT NULL,
          execution_deadline INTEGER NOT NULL, submission_deadline INTEGER NOT NULL, PRIMARY KEY(execution_id,sequence)
        );
        CREATE TABLE IF NOT EXISTS evaluation_claims (
          execution_id TEXT NOT NULL, sequence INTEGER NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(execution_id,sequence)
        );
      `);
    });
  }

  /** Request-owned connection activation only: no execution, nonce, lease, task or authority. */
  ready(): true {
    const row = this.ctx.storage.sql.exec<{ ready: number }>("SELECT 1 AS ready").one();
    if (row.ready !== 1) throw new Error("pool activation failed");
    return true;
  }

  async startAttempt(command: AttemptCommand & PoolIdentity): Promise<AttemptLease | null> {
    identity(command);
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<ExecutionRow>("SELECT * FROM execution WHERE execution_id=?", command.execution_id).toArray()[0];
      if (!row || row.subject_hash !== command.subject_hash || row.device_id !== command.device_id ||
          row.phase !== "active" || row.sequence !== command.sequence || row.nonce !== command.nonce) return null;
      const lease = this.ctx.storage.sql.exec<AttemptLease>(
        "SELECT execution_deadline,submission_deadline FROM attempt_leases WHERE execution_id=? AND sequence=? AND nonce=?",
        command.execution_id, command.sequence, command.nonce).toArray()[0];
      if (lease) return lease.execution_deadline >= command.now ? lease : null;
      if (row.expires_at < command.now) return null;
      const next = { execution_deadline: command.now + EXECUTION_WINDOW_MS,
        submission_deadline: command.now + EXECUTION_WINDOW_MS + SUBMISSION_GRACE_MS };
      this.ctx.storage.sql.exec("INSERT INTO attempt_leases VALUES(?,?,?,?,?)",
        command.execution_id, command.sequence, command.nonce, next.execution_deadline, next.submission_deadline);
      this.ctx.storage.sql.exec("UPDATE execution SET expires_at=? WHERE execution_id=?", next.submission_deadline, command.execution_id);
      return next;
    });
  }

  async permitsArtifact(command: ClaimCommand & PoolIdentity): Promise<boolean> {
    identity(command);
    const execution = this.ctx.storage.sql.exec<ExecutionRow>("SELECT * FROM execution WHERE execution_id=?", command.execution_id).toArray()[0];
    const previous = this.ctx.storage.sql.exec<ResultRow>("SELECT * FROM results WHERE execution_id=? AND sequence=?", command.execution_id, command.sequence).toArray()[0];
    if (!execution || execution.subject_hash !== command.subject_hash || execution.device_id !== command.device_id) return false;
    if (previous) return previous.nonce === command.nonce && previous.result_hash === command.result_hash;
    return decideClaim(execution, undefined, command).kind === "claimed";
  }

  async begin(command: BeginCommand): Promise<"created" | "exists"> {
    identity(command);
    return this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ execution_id: string }>(
          "SELECT execution_id FROM execution WHERE execution_id = ?", command.execution_id,
        )
        .toArray()[0];
      if (existing) return "exists";
      this.ctx.storage.sql.exec(
        `INSERT INTO execution
          (execution_id, subject_hash, device_id, sequence, nonce, expires_at, phase)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        command.execution_id,
        command.subject_hash,
        command.device_id,
        command.sequence,
        command.nonce,
        command.expires_at,
        command.phase,
      );
      return "created";
    });
  }

  async claim(command: ClaimCommand & PoolIdentity): Promise<ClaimDecision> {
    identity(command);
    return this.ctx.storage.transactionSync(() => {
      const execution = this.ctx.storage.sql
        .exec<ExecutionRow>(
          `SELECT execution_id, subject_hash, device_id, sequence, nonce, expires_at, phase
           FROM execution WHERE execution_id = ?`,
          command.execution_id,
        )
        .toArray()[0];
      const previous = this.ctx.storage.sql
        .exec<ResultRow>(
          `SELECT sequence, nonce, result_hash, response_json
           FROM results WHERE execution_id = ? AND sequence = ?`,
          command.execution_id, command.sequence,
        )
        .toArray()[0];
      let decision = decideClaim(execution, previous, command);
      const owner = this.ctx.storage.sql.exec<{ token: string; expires_at: number }>(
        "SELECT * FROM evaluation_claims WHERE execution_id=? AND sequence=?", command.execution_id, command.sequence).toArray()[0];
      if (previous?.response_json === null && previous.nonce === command.nonce && previous.result_hash === command.result_hash &&
          execution?.subject_hash === command.subject_hash && execution.device_id === command.device_id &&
          owner && owner.expires_at > command.now) return { kind: "pending", retry_after_ms: owner.expires_at - command.now };
      if (previous?.response_json === null && previous.nonce === command.nonce && previous.result_hash === command.result_hash &&
          execution?.subject_hash === command.subject_hash && execution.device_id === command.device_id &&
          execution.phase === "active" && execution.sequence === command.sequence && execution.expires_at >= command.now &&
          (!owner || owner.expires_at <= command.now)) decision = { kind: "claimed" };
      if (decision.kind === "claimed") {
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO results (execution_id, sequence, nonce, result_hash, response_json)
           VALUES (?, ?, ?, ?, NULL)`,
          command.execution_id, command.sequence,
          command.nonce,
          command.result_hash,
        );
        const token = crypto.randomUUID();
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO evaluation_claims VALUES(?,?,?,?)", command.execution_id, command.sequence, token, command.now + 60_000);
        return { kind: "claimed", claim_token: token };
      }
      return decision;
    });
  }

  async finalize(command: FinalizeCommand & PoolIdentity): Promise<FinalizeDecision> {
    identity(command);
    return this.ctx.storage.transactionSync(() => {
      const result = this.ctx.storage.sql
        .exec<ResultRow>(
          `SELECT sequence, nonce, result_hash, response_json
           FROM results WHERE execution_id = ? AND sequence = ?`,
          command.execution_id, command.sequence,
        )
        .toArray()[0];
      if (!result || result.result_hash !== command.result_hash) {
        return { kind: "rejected" };
      }
      if (result.response_json !== null) {
        return { kind: "completed", response_json: result.response_json };
      }
      const owner = this.ctx.storage.sql.exec<{ token: string }>("SELECT token FROM evaluation_claims WHERE execution_id=? AND sequence=?", command.execution_id, command.sequence).toArray()[0];
      if (owner && owner.token !== command.claim_token) return { kind: "rejected" };
      this.ctx.storage.sql.exec(
        "UPDATE results SET response_json = ? WHERE execution_id = ? AND sequence = ?",
        command.response_json, command.execution_id, command.sequence,
      );
      if (command.next === null) {
        this.ctx.storage.sql.exec(
          "UPDATE execution SET phase = 'complete' WHERE execution_id = ?", command.execution_id,
        );
      } else {
        this.ctx.storage.sql.exec(
          `UPDATE execution
           SET sequence = ?, nonce = ?, expires_at = ?, phase = 'active'
           WHERE execution_id = ? AND sequence = ?`,
          command.next.sequence,
          command.next.nonce,
          command.next.expires_at,
          command.execution_id, command.sequence,
        );
      }
      return { kind: "stored", response_json: command.response_json };
    });
  }
}
