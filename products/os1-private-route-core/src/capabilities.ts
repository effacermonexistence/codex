import { readBoundedJson } from "../../os1-route-core/src/io";

/** Support is usable only with the same source-locked adapter as this policy. */
export async function supportsCompletionFeedback(binding: Fetcher, expectedPolicy: string): Promise<boolean> {
  try {
    const response = await binding.fetch("https://internal/capabilities", {
      method: "GET", signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const value = await readBoundedJson(response, 256);
    return typeof value === "object" && value !== null && !Array.isArray(value) &&
      Object.keys(value).sort().join() === "completion_feedback_schema,policy_sha256" &&
      (value as Record<string, unknown>).completion_feedback_schema === 1 &&
      (value as Record<string, unknown>).policy_sha256 === expectedPolicy;
  } catch { return false; }
}
