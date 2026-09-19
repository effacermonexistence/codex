import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("routing and result evaluation deploy the same RCC service", () => {
  const service = (path: string) => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    return source.match(/"binding"\s*:\s*"RCC_V26"[\s\S]*?"service"\s*:\s*"([^"]+)"/)?.[1];
  };
  const evaluator = service("../wrangler.jsonc");
  expect(evaluator).toBeTruthy();
  expect(evaluator).toBe(service("../../os1-private-route-core/wrangler.jsonc"));
});
