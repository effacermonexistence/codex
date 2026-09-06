import { readBoundedJson } from "./io";

/** Public protocol support only; no policy identity, scores, or source content. */
export async function completionCapabilities(binding: Fetcher): Promise<Response> {
  let schema: 1 | null = null;
  try {
    const response = await binding.fetch("https://service.internal/capabilities", {
      method: "GET", signal: AbortSignal.timeout(2_000),
    });
    if (response.ok) {
      const value = await readBoundedJson(response, 256);
      if (typeof value === "object" && value !== null && !Array.isArray(value) &&
        Object.keys(value).join() === "completion_feedback_schema" &&
        (value as Record<string, unknown>).completion_feedback_schema === 1) schema = 1;
    }
  } catch { /* Old or unavailable private services do not advertise support. */ }
  return Response.json({ completion_feedback_schema: schema, execution_protocol: 1, fleet_receipt_protocol: 1 }, {
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
