import { authenticate, verifiedDeviceKey } from "./gateway";
import { reject } from "./errors";
import { readBoundedJson } from "./io";
import {
  parseFleetClaim,
  parseFleetComplete,
  parseFleetHeartbeat,
  parseFleetStatus,
  parseFleetSubmit,
} from "./fleet-contracts";
import {
  canonicalFleetClaim,
  canonicalFleetComplete,
  canonicalFleetHeartbeat,
  canonicalFleetStatus,
  canonicalFleetSubmit,
  verifyFleetSignature,
} from "./fleet-crypto";
import type { FleetJobSpec } from "./fleet-state";
import { sha256HexBytes } from "./crypto";

const CLOCK_SKEW_MS = 300_000;
const JOB_TTL_MS = 3_600_000;

function fleetJson(value: object): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) reject();
  return parsed;
}

function fresh(timestamp: number): void {
  if (Math.abs(Date.now() - timestamp) > CLOCK_SKEW_MS) reject();
}

async function verified(
  request: Request,
  env: Env,
  parse: (value: unknown) => { signature: string },
  canonical: (deviceId: string, value: never) => Uint8Array,
): Promise<{ identity: Awaited<ReturnType<typeof authenticate>>; body: ReturnType<typeof parse> }> {
  const identity = await authenticate(request, env);
  const body = parse(await readBoundedJson(request, positiveInteger(env.MAX_REQUEST_BYTES)));
  const key = await verifiedDeviceKey(env, identity);
  const { signature: _signature, ...unsigned } = body;
  if (!(await verifyFleetSignature(key, body.signature, canonical(identity.device_id, unsigned as never)))) reject();
  return { identity, body };
}

async function fleet(env: Env, subject: string) {
  return env.FLEETS.getByName(await sha256HexBytes(new TextEncoder().encode(subject)));
}

export async function fleetHeartbeat(request: Request, env: Env): Promise<Response> {
  const { identity, body } = await verified(request, env, parseFleetHeartbeat, canonicalFleetHeartbeat as never);
  fresh((body as ReturnType<typeof parseFleetHeartbeat>).sent_at_ms);
  const heartbeat = body as ReturnType<typeof parseFleetHeartbeat>;
  const state = await fleet(env, identity.subject);
  return fleetJson(await state.heartbeat({
    device_id: identity.device_id,
    ...heartbeat.node,
    last_seen_ms: heartbeat.sent_at_ms,
  }));
}

export async function fleetSubmit(request: Request, env: Env): Promise<Response> {
  const { identity, body } = await verified(request, env, parseFleetSubmit, canonicalFleetSubmit as never);
  const submit = body as ReturnType<typeof parseFleetSubmit>;
  fresh(submit.submitted_at_ms);
  const state = await fleet(env, identity.subject);
  const spec: FleetJobSpec = {
    job_id: crypto.randomUUID(),
    submitter_device_id: identity.device_id,
    profile: submit.profile,
    task: submit.task,
    workspace_repository: submit.workspace_repository,
    workspace_revision: submit.workspace_revision,
    workspace_subpath: submit.workspace_subpath,
    requirements: submit.requirements,
    created_at_ms: submit.submitted_at_ms,
    expires_at_ms: submit.submitted_at_ms + JOB_TTL_MS,
    request_nonce: submit.nonce,
  };
  return fleetJson(await state.submit(spec));
}

export async function fleetClaim(request: Request, env: Env): Promise<Response> {
  const { identity, body } = await verified(request, env, parseFleetClaim, canonicalFleetClaim as never);
  const claim = body as ReturnType<typeof parseFleetClaim>;
  fresh(claim.sent_at_ms);
  const state = await fleet(env, identity.subject);
  return fleetJson(await state.claim(identity.device_id, claim.sent_at_ms));
}

export async function fleetComplete(request: Request, env: Env): Promise<Response> {
  const { identity, body } = await verified(request, env, parseFleetComplete, canonicalFleetComplete as never);
  const complete = body as ReturnType<typeof parseFleetComplete>;
  fresh(complete.completed_at_ms);
  const digest = await sha256HexBytes(new TextEncoder().encode(complete.result));
  if (digest !== complete.result_hash) reject();
  const state = await fleet(env, identity.subject);
  const response = await state.complete(
    identity.device_id,
    complete.job_id,
    complete.outcome,
    complete.result,
    complete.result_hash,
    complete.completed_at_ms,
  );
  if (response.status !== "stored") reject();
  return fleetJson(response);
}

export async function fleetStatus(request: Request, env: Env): Promise<Response> {
  const { identity, body } = await verified(request, env, parseFleetStatus, canonicalFleetStatus as never);
  const status = body as ReturnType<typeof parseFleetStatus>;
  fresh(status.sent_at_ms);
  const state = await fleet(env, identity.subject);
  const response = await state.jobStatus(identity.device_id, status.job_id, status.sent_at_ms);
  if (!response) reject();
  return fleetJson(response);
}

export async function fleetSnapshot(request: Request, env: Env): Promise<Response> {
  const { identity, body } = await verified(request, env, parseFleetClaim, canonicalFleetClaim as never);
  const snapshot = body as ReturnType<typeof parseFleetClaim>;
  fresh(snapshot.sent_at_ms);
  const state = await fleet(env, identity.subject);
  return fleetJson(await state.snapshot(snapshot.sent_at_ms));
}
