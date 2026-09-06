import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { startExecution } from "../src/gateway";

describe("gateway completion scope boundary", () => {
  const task = "Exact task with source_sha256=a and history_sha256=b";
  function request(objectiveSha: string): Request {
    return new Request("https://gateway/v1/executions", { method: "POST",
      headers: { authorization: "Bearer fixture", "x-os1-device-id": "fixture-device" },
      body: JSON.stringify({ task, provider_preference: "auto", capacity_plan: { codex: 30, claude: 100 },
        executor_contract_version: "executor-test-v1", executor_contract_sha256: "b".repeat(64),
        available_codex_models: [{ slug: "gpt-test", default_effort: "medium", supported_efforts: ["medium"], priority: 1 }],
        execution_context: { input_utf8_bytes: 1000, source_utf8_bytes: 600, history_utf8_bytes: 200,
          completion_feedback: { schema: 1, objective_sha256: objectiveSha, observations: [] } } }) });
  }
  it("rejects cross-objective history before any private route/budget request", async () => {
    let starts = 0;
    const env = { MAX_REQUEST_BYTES: "65536", SERVICE_RESPONSE_BYTES: "4096",
      AUTH_SERVICE: { fetch: async () => Response.json({ subject: "fixture", device_id: "fixture-device" }) },
      PRIVATE_ROUTE_CORE: { fetch: async () => { starts++; return Response.json({ status: "failed" }); } } } as unknown as Env;
    await expect(startExecution(request("a".repeat(64)), env)).rejects.toThrow();
    expect(starts).toBe(0);
    expect(await (await startExecution(request(createHash("sha256").update(task).digest("hex")), env)).json()).toEqual({ status: "failed" });
    expect(starts).toBe(1);
  });
});
