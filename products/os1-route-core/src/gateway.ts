import {
  parseAuthIdentity,
  parseArtifactUploadRequest,
  parseDeviceId,
  parseDeviceRegistration,
  parseDeviceRecord,
  parsePrivateDecision,
  parsePublicResponse,
  parseResultRequest,
  parseStartRequest,
  resultArtifactKey,
  resultArtifactRef,
  type AuthIdentity,
  type PrivateDecision,
  type PublicResponse,
  type Ticket,
  type TicketUnsigned,
} from "./contracts";
import {
  randomNonce,
  base64UrlDecode,
  sha256Hex,
  sha256HexBytes,
  signTicket,
  timingSafeHexEqual,
  verifyDeviceResult,
  verifyDeviceRegistration,
  verifyTicket,
} from "./crypto";
import { assertTicketDeliveryHygiene, publicJson } from "./egress";
import { reject } from "./errors";
import { bindingJson, readBoundedJson } from "./io";

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) reject();
  return parsed;
}

async function authenticate(request: Request, env: Env): Promise<AuthIdentity> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 8_192) {
    reject();
  }
  const deviceId = parseDeviceId(request.headers.get("x-os1-device-id"));
  const value = await bindingJson(
    env.AUTH_SERVICE,
    "/verify",
    { device_id: deviceId },
    positiveInteger(env.SERVICE_RESPONSE_BYTES),
    authorization,
  );
  return parseAuthIdentity(value);
}

async function verifyTicketFresh(ticket: Ticket, env: Env): Promise<void> {
  if (
    Date.parse(ticket.expires_at) < Date.now() ||
    !(await verifyTicket(ticket, env.TICKET_VERIFYING_KEY_SPKI))
  ) {
    reject();
  }
}

async function privateDecision(
  env: Env,
  body: unknown,
): Promise<PrivateDecision> {
  return parsePrivateDecision(
    await bindingJson(
      env.PRIVATE_ROUTE_CORE,
      "/decide",
      body,
      positiveInteger(env.SERVICE_RESPONSE_BYTES),
    ),
  );
}

function unsignedTicket(
  executionId: string,
  sequence: number,
  decision: Extract<PrivateDecision, { status: "step" }>,
  ttlSeconds: number,
): TicketUnsigned {
  return {
    execution_id: executionId,
    sequence,
    provider: decision.provider,
    action: decision.action,
    permission_profile: decision.permission_profile,
    expires_at: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
    nonce: randomNonce(),
  };
}

async function issueTicket(
  env: Env,
  executionId: string,
  sequence: number,
  decision: Extract<PrivateDecision, { status: "step" }>,
): Promise<Ticket> {
  const ticket = await signTicket(
    unsignedTicket(
      executionId,
      sequence,
      decision,
      positiveInteger(env.TICKET_TTL_SECONDS),
    ),
    env.TICKET_SIGNING_KEY_PKCS8,
  );
  assertTicketDeliveryHygiene(ticket, env.DELIVERY_DENYLIST_JSON);
  return ticket;
}

export async function startExecution(request: Request, env: Env): Promise<Response> {
  const identity = await authenticate(request, env);
  const { task, provider_preference, capacity_plan, executor_contract_version, executor_contract_sha256 } = parseStartRequest(
    await readBoundedJson(request, positiveInteger(env.MAX_REQUEST_BYTES)),
  );
  const executionId = crypto.randomUUID();
  const decision = await privateDecision(env, {
    version: 2,
    execution_id: executionId,
    principal: { subject: identity.subject, device_id: identity.device_id },
    task: {
      trust: "untrusted_user_data",
      content: task,
      provider_preference,
      capacity_plan,
      executor_contract_version,
      executor_contract_sha256,
    },
  });
  if (decision.status === "complete") return publicJson({ status: "complete" });
  if (decision.status === "failed") return publicJson({ status: "failed" });

  const ticket = await issueTicket(env, executionId, 1, decision);
  const state = env.EXECUTIONS.getByName(executionId);
  const created = await state.begin({
    execution_id: executionId,
    subject_hash: await sha256Hex(identity.subject),
    device_id: identity.device_id,
    sequence: ticket.sequence,
    nonce: ticket.nonce,
    expires_at: Date.parse(ticket.expires_at),
    phase: "active",
  });
  if (created !== "created") reject();
  return publicJson(ticket);
}

export async function registerDevice(
  request: Request,
  env: Env,
): Promise<Response> {
  const identity = await authenticate(request, env);
  const registration = parseDeviceRegistration(
    await readBoundedJson(request, positiveInteger(env.MAX_REQUEST_BYTES)),
  );
  if (
    registration.device_id !== identity.device_id ||
    Math.abs(Date.now() - registration.registered_at) > 300_000 ||
    !(await verifyDeviceRegistration(registration))
  ) {
    reject();
  }
  const value = await bindingJson(
    env.DEVICE_REGISTRY,
    "/register",
    {
      subject: identity.subject,
      device_id: identity.device_id,
      p256_public_jwk: registration.p256_public_jwk,
    },
    positiveInteger(env.SERVICE_RESPONSE_BYTES),
  );
  return publicJson(parsePublicResponse(value));
}

async function verifiedDeviceKey(
  env: Env,
  identity: AuthIdentity,
): Promise<JsonWebKey> {
  const record = parseDeviceRecord(
    await bindingJson(
      env.DEVICE_REGISTRY,
      "/lookup",
      { subject: identity.subject, device_id: identity.device_id },
      positiveInteger(env.SERVICE_RESPONSE_BYTES),
    ),
  );
  if (
    record.subject !== identity.subject ||
    record.device_id !== identity.device_id
  ) {
    reject();
  }
  return record.p256_public_jwk;
}

export async function submitResult(request: Request, env: Env): Promise<Response> {
  const identity = await authenticate(request, env);
  const result = parseResultRequest(
    await readBoundedJson(request, positiveInteger(env.MAX_REQUEST_BYTES)),
  );
  await verifyTicketFresh(result.ticket, env);
  const deviceKey = await verifiedDeviceKey(env, identity);
  if (!(await verifyDeviceResult(result, deviceKey))) reject();

  const state = env.EXECUTIONS.getByName(result.ticket.execution_id);
  const claim = await state.claim({
    subject_hash: await sha256Hex(identity.subject),
    device_id: identity.device_id,
    sequence: result.ticket.sequence,
    nonce: result.ticket.nonce,
    result_hash: result.result_hash,
    now: Date.now(),
  });
  if (claim.kind === "rejected") reject();
  if (claim.kind === "completed") {
    return publicJson(parsePublicResponse(JSON.parse(claim.response_json)));
  }

  const decision = await privateDecision(env, {
    version: 2,
    execution_id: result.ticket.execution_id,
    previous: {
      sequence: result.ticket.sequence,
      artifact_ref: result.artifact_ref,
      expected_artifact_hash: result.result_hash,
    },
  });
  let response: PublicResponse;
  let next: { sequence: number; nonce: string; expires_at: number } | null;
  if (decision.status === "complete") {
    response = { status: "complete" };
    next = null;
  } else if (decision.status === "failed") {
    response = { status: "failed" };
    next = null;
  } else {
    const ticket = await issueTicket(
      env,
      result.ticket.execution_id,
      result.ticket.sequence + 1,
      decision,
    );
    response = ticket;
    next = {
      sequence: ticket.sequence,
      nonce: ticket.nonce,
      expires_at: Date.parse(ticket.expires_at),
    };
  }

  const responseJson = JSON.stringify(response);
  const finalized = await state.finalize({
    sequence: result.ticket.sequence,
    result_hash: result.result_hash,
    response_json: responseJson,
    next,
  });
  if (finalized.kind === "rejected") reject();
  return publicJson(parsePublicResponse(JSON.parse(finalized.response_json)));
}

export async function uploadArtifact(
  request: Request,
  env: Env,
): Promise<Response> {
  const identity = await authenticate(request, env);
  const upload = parseArtifactUploadRequest(
    await readBoundedJson(request, positiveInteger(env.MAX_ARTIFACT_REQUEST_BYTES)),
  );
  await verifyTicketFresh(upload.ticket, env);
  const artifactRef = resultArtifactRef(upload.ticket, upload.result_hash);
  const result = {
    ticket: upload.ticket,
    result_hash: upload.result_hash,
    artifact_ref: artifactRef,
    device_signature: upload.device_signature,
  };
  const deviceKey = await verifiedDeviceKey(env, identity);
  if (!(await verifyDeviceResult(result, deviceKey))) reject();

  const bytes = base64UrlDecode(upload.artifact_base64);
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > positiveInteger(env.MAX_ARTIFACT_BYTES) ||
    !(await timingSafeHexEqual(
      await sha256HexBytes(bytes),
      upload.result_hash,
    ))
  ) {
    reject();
  }
  await env.RESULTS.put(resultArtifactKey(artifactRef), bytes, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: {
      execution_id: upload.ticket.execution_id,
      sequence: String(upload.ticket.sequence),
      result_hash: upload.result_hash,
      subject_hash: await sha256Hex(identity.subject),
      device_id: identity.device_id,
    },
  });
  return publicJson({ artifact_ref: artifactRef });
}
