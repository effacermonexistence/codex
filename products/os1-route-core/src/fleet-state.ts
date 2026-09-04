import { DurableObject } from "cloudflare:workers";
import {
  FLEET_NODE_STALE_AFTER_MS,
  placeFleetJob,
  type FleetNode,
  type FleetPlacement,
  type FleetProfile,
  type FleetRequirements,
} from "./fleet-model";

export type FleetJobSpec = {
  job_id: string;
  submitter_device_id: string;
  profile: FleetProfile;
  task: string;
  workspace_repository: string;
  workspace_revision: string;
  workspace_subpath: string;
  requirements: FleetRequirements;
  created_at_ms: number;
  expires_at_ms: number;
  request_nonce: string;
};

export type FleetAssignment = Omit<FleetJobSpec, "request_nonce"> & FleetPlacement;

export type FleetJobStatus = {
  job_id: string;
  state: "queued" | "claimed" | "complete" | "failed" | "expired";
  profile: FleetProfile;
  execution_mode: "single_node" | "distributed_exo";
  executor_device_id: string;
  objective_version: string;
  result: string | null;
  result_hash: string | null;
  created_at_ms: number;
  completed_at_ms: number | null;
};

type NodeRow = Omit<FleetNode, "has_codex" | "has_claude" | "exo_ready"> & {
  has_codex: number;
  has_claude: number;
  exo_ready: number;
};

type JobRow = {
  job_id: string;
  submitter_device_id: string;
  executor_device_id: string;
  profile: FleetProfile;
  task: string;
  workspace_repository: string;
  workspace_revision: string;
  workspace_subpath: string;
  requirements_json: string;
  objective_version: string;
  execution_mode: "single_node" | "distributed_exo";
  score: number;
  state: FleetJobStatus["state"];
  created_at_ms: number;
  expires_at_ms: number;
  claimed_at_ms: number | null;
  completed_at_ms: number | null;
  result: string | null;
  result_hash: string | null;
};

function fleetNode(row: NodeRow): FleetNode {
  return {
    ...row,
    has_codex: row.has_codex === 1,
    has_claude: row.has_claude === 1,
    exo_ready: row.exo_ready === 1,
  };
}

function assignment(row: JobRow): FleetAssignment {
  return {
    job_id: row.job_id,
    submitter_device_id: row.submitter_device_id,
    profile: row.profile,
    task: row.task,
    workspace_repository: row.workspace_repository,
    workspace_revision: row.workspace_revision,
    workspace_subpath: row.workspace_subpath,
    requirements: JSON.parse(row.requirements_json) as FleetRequirements,
    created_at_ms: row.created_at_ms,
    expires_at_ms: row.expires_at_ms,
    objective_version: row.objective_version as FleetPlacement["objective_version"],
    execution_mode: row.execution_mode,
    executor_device_id: row.executor_device_id,
    score: row.score,
  };
}

function assignedSpec(spec: FleetJobSpec, placement: FleetPlacement): FleetAssignment {
  const { request_nonce: _requestNonce, ...publicSpec } = spec;
  return { ...publicSpec, ...placement };
}

function status(row: JobRow): FleetJobStatus {
  return {
    job_id: row.job_id,
    state: row.state,
    profile: row.profile,
    execution_mode: row.execution_mode,
    executor_device_id: row.executor_device_id,
    objective_version: row.objective_version,
    result: row.result,
    result_hash: row.result_hash,
    created_at_ms: row.created_at_ms,
    completed_at_ms: row.completed_at_ms,
  };
}

export class FleetState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS fleet_nodes (
          device_id TEXT PRIMARY KEY,
          role TEXT NOT NULL CHECK (role IN ('pro', 'air')),
          hostname TEXT NOT NULL,
          zerotier_ip TEXT NOT NULL,
          cpu_logical_count INTEGER NOT NULL,
          load_average_1m REAL NOT NULL,
          memory_total_mib INTEGER NOT NULL,
          memory_available_mib INTEGER NOT NULL,
          queue_depth INTEGER NOT NULL,
          has_codex INTEGER NOT NULL,
          has_claude INTEGER NOT NULL,
          exo_ready INTEGER NOT NULL,
          exo_nodes INTEGER NOT NULL,
          last_seen_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS fleet_jobs (
          job_id TEXT PRIMARY KEY,
          submitter_device_id TEXT NOT NULL,
          executor_device_id TEXT NOT NULL,
          profile TEXT NOT NULL,
          task TEXT NOT NULL,
          workspace_repository TEXT NOT NULL,
          workspace_revision TEXT NOT NULL,
          workspace_subpath TEXT NOT NULL,
          requirements_json TEXT NOT NULL,
          objective_version TEXT NOT NULL,
          execution_mode TEXT NOT NULL,
          score REAL NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('queued','claimed','complete','failed','expired')),
          created_at_ms INTEGER NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          claimed_at_ms INTEGER,
          completed_at_ms INTEGER,
          result TEXT,
          result_hash TEXT
        );
        CREATE INDEX IF NOT EXISTS fleet_jobs_claim
          ON fleet_jobs(executor_device_id, state, created_at_ms);
        CREATE TABLE IF NOT EXISTS fleet_submit_nonces (
          device_id TEXT NOT NULL,
          nonce TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL,
          PRIMARY KEY(device_id, nonce)
        );
      `);
    });
  }

  heartbeat(node: FleetNode): { status: "online"; stale_after_ms: number } {
    this.ctx.storage.sql.exec(
      `INSERT INTO fleet_nodes (
        device_id, role, hostname, zerotier_ip, cpu_logical_count, load_average_1m,
        memory_total_mib, memory_available_mib, queue_depth, has_codex, has_claude,
        exo_ready, exo_nodes, last_seen_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        role=excluded.role, hostname=excluded.hostname, zerotier_ip=excluded.zerotier_ip,
        cpu_logical_count=excluded.cpu_logical_count, load_average_1m=excluded.load_average_1m,
        memory_total_mib=excluded.memory_total_mib,
        memory_available_mib=excluded.memory_available_mib, queue_depth=excluded.queue_depth,
        has_codex=excluded.has_codex, has_claude=excluded.has_claude,
        exo_ready=excluded.exo_ready, exo_nodes=excluded.exo_nodes,
        last_seen_ms=excluded.last_seen_ms`,
      node.device_id, node.role, node.hostname, node.zerotier_ip, node.cpu_logical_count,
      node.load_average_1m, node.memory_total_mib, node.memory_available_mib,
      node.queue_depth, Number(node.has_codex), Number(node.has_claude),
      Number(node.exo_ready), node.exo_nodes, node.last_seen_ms,
    );
    return { status: "online", stale_after_ms: FLEET_NODE_STALE_AFTER_MS };
  }

  submit(spec: FleetJobSpec): { status: "queued"; assignment: FleetAssignment } | { status: "no_capacity" } {
    return this.ctx.storage.transactionSync(() => {
      this.expire(spec.created_at_ms);
      const duplicate = this.ctx.storage.sql.exec<{ nonce: string }>(
        "SELECT nonce FROM fleet_submit_nonces WHERE device_id=? AND nonce=?",
        spec.submitter_device_id,
        spec.request_nonce,
      ).toArray()[0];
      if (duplicate) return { status: "no_capacity" };
      this.ctx.storage.sql.exec(
        "INSERT INTO fleet_submit_nonces(device_id, nonce, created_at_ms) VALUES (?, ?, ?)",
        spec.submitter_device_id,
        spec.request_nonce,
        spec.created_at_ms,
      );
      const nodes = this.ctx.storage.sql.exec<NodeRow>("SELECT * FROM fleet_nodes").toArray().map((row) => {
        const node = fleetNode(row);
        const queued = this.ctx.storage.sql.exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM fleet_jobs WHERE executor_device_id=? AND state IN ('queued','claimed')",
          node.device_id,
        ).one().count;
        return { ...node, queue_depth: node.queue_depth + queued };
      });
      const placement = placeFleetJob(nodes, spec.profile, spec.requirements, spec.created_at_ms);
      if (!placement) return { status: "no_capacity" };
      this.ctx.storage.sql.exec(
        `INSERT INTO fleet_jobs (
          job_id, submitter_device_id, executor_device_id, profile, task,
          workspace_repository, workspace_revision, workspace_subpath, requirements_json,
          objective_version, execution_mode, score, state, created_at_ms, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
        spec.job_id, spec.submitter_device_id, placement.executor_device_id, spec.profile,
        spec.task, spec.workspace_repository, spec.workspace_revision, spec.workspace_subpath,
        JSON.stringify(spec.requirements), placement.objective_version, placement.execution_mode,
        placement.score, spec.created_at_ms, spec.expires_at_ms,
      );
      return { status: "queued", assignment: assignedSpec(spec, placement) };
    });
  }

  claim(deviceId: string, nowMs: number): { status: "idle" } | { status: "claimed"; assignment: FleetAssignment } {
    return this.ctx.storage.transactionSync(() => {
      this.expire(nowMs);
      const row = this.ctx.storage.sql.exec<JobRow>(
        `SELECT * FROM fleet_jobs
         WHERE executor_device_id=? AND state='queued' AND expires_at_ms>=?
         ORDER BY created_at_ms, job_id LIMIT 1`,
        deviceId,
        nowMs,
      ).toArray()[0];
      if (!row) return { status: "idle" };
      this.ctx.storage.sql.exec(
        "UPDATE fleet_jobs SET state='claimed', claimed_at_ms=? WHERE job_id=? AND state='queued'",
        nowMs,
        row.job_id,
      );
      return { status: "claimed", assignment: assignment({ ...row, state: "claimed", claimed_at_ms: nowMs }) };
    });
  }

  complete(
    deviceId: string,
    jobId: string,
    outcome: "complete" | "failed",
    result: string,
    resultHash: string,
    completedAtMs: number,
  ): { status: "stored" } | { status: "rejected" } {
    return this.ctx.storage.transactionSync(() => {
      const row = this.ctx.storage.sql.exec<JobRow>("SELECT * FROM fleet_jobs WHERE job_id=?", jobId).toArray()[0];
      if (!row || row.executor_device_id !== deviceId || row.state !== "claimed" ||
          completedAtMs < (row.claimed_at_ms ?? row.created_at_ms)) return { status: "rejected" };
      this.ctx.storage.sql.exec(
        `UPDATE fleet_jobs SET state=?, result=?, result_hash=?, completed_at_ms=?
         WHERE job_id=? AND executor_device_id=? AND state='claimed'`,
        outcome,
        result,
        resultHash,
        completedAtMs,
        jobId,
        deviceId,
      );
      return { status: "stored" };
    });
  }

  jobStatus(submitterDeviceId: string, jobId: string, nowMs: number): FleetJobStatus | null {
    this.expire(nowMs);
    const row = this.ctx.storage.sql.exec<JobRow>(
      "SELECT * FROM fleet_jobs WHERE job_id=? AND submitter_device_id=?",
      jobId,
      submitterDeviceId,
    ).toArray()[0];
    return row ? status(row) : null;
  }

  snapshot(nowMs: number): { nodes: FleetNode[] } {
    this.expire(nowMs);
    const nodes = this.ctx.storage.sql.exec<NodeRow>("SELECT * FROM fleet_nodes ORDER BY device_id").toArray().map(fleetNode);
    return { nodes };
  }

  private expire(nowMs: number): void {
    this.ctx.storage.sql.exec(
      "UPDATE fleet_jobs SET state='expired' WHERE state IN ('queued','claimed') AND expires_at_ms<?",
      nowMs,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM fleet_submit_nonces WHERE created_at_ms<?",
      nowMs - 86_400_000,
    );
  }
}
