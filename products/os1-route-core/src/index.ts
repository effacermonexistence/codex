import { opaqueError } from "./egress";
import { RequestRejected } from "./errors";
import { ExecutionState } from "./execution-state";
import { FleetState } from "./fleet-state";
import {
  fleetClaim,
  fleetComplete,
  fleetHeartbeat,
  fleetSnapshot,
  fleetStatus,
  fleetSubmit,
} from "./fleet-gateway";
import {
  registerDevice,
  startExecution,
  submitResult,
  uploadArtifact,
} from "./gateway";
import { releaseRequest } from "./releases";

export { ExecutionState, FleetState };

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && (
      url.pathname === "/install.sh" ||
      url.pathname === "/v1/releases/latest" ||
      url.pathname === "/v1/releases/download"
    )) {
      return await releaseRequest(url, env);
    }
    if (request.method !== "POST") throw new RequestRejected();
    if (url.pathname === "/v1/devices/register") {
      return await registerDevice(request, env);
    }
    if (url.pathname === "/v1/executions") return await startExecution(request, env);
    if (url.pathname === "/v1/artifacts") return await uploadArtifact(request, env);
    if (url.pathname === "/v1/results") return await submitResult(request, env);
    if (url.pathname === "/v1/fleet/heartbeat") return await fleetHeartbeat(request, env);
    if (url.pathname === "/v1/fleet/submit") return await fleetSubmit(request, env);
    if (url.pathname === "/v1/fleet/claim") return await fleetClaim(request, env);
    if (url.pathname === "/v1/fleet/complete") return await fleetComplete(request, env);
    if (url.pathname === "/v1/fleet/status") return await fleetStatus(request, env);
    if (url.pathname === "/v1/fleet/snapshot") return await fleetSnapshot(request, env);
    throw new RequestRejected();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: error instanceof RequestRejected ? "request_rejected" : "internal_rejected",
        request_id: requestId,
      }),
    );
    return opaqueError();
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
