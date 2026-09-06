import { describe, expect, it } from "vitest";
import { bindingJson } from "../src/io";
import { RequestRejected, ResultServiceUnavailable } from "../src/errors";

describe("result transport is not execution failure", () => {
  const response = (status: number) => ({ fetch: async () => new Response("{}", { status }) }) as unknown as Fetcher;
  it("makes only result delivery 5xx recoverable", async () => {
    await expect(bindingJson(response(503), "/decide", {}, 100, undefined, true)).rejects.toBeInstanceOf(ResultServiceUnavailable);
    await expect(bindingJson(response(503), "/decide", {}, 100)).rejects.toBeInstanceOf(RequestRejected);
  });
  it("preserves authentication and policy rejection", async () => {
    for (const status of [400, 401, 403]) {
      await expect(bindingJson(response(status), "/decide", {}, 100, undefined, true)).rejects.toBeInstanceOf(RequestRejected);
    }
  });
  it("does not expose internal timeout details", async () => {
    const binding = { fetch: async () => { throw new Error("private endpoint timeout detail"); } } as unknown as Fetcher;
    await expect(bindingJson(binding, "/decide", {}, 100, undefined, true)).rejects.toThrow("result service unavailable");
  });
});
