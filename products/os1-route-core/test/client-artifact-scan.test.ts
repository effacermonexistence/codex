import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanClientArtifacts } from "../scripts/client-artifact-scan.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("client release artifact hygiene gate", () => {
  it("allows only the known public glyph-name token, not other font contents", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-font-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "latinmodern-math.otf");
    const glyphNames = "stDeltaGammaLambdaOmegaPhiPiPsiSigmaThetaUpsilonXiuni2127uni2126AlphaBetaEpsilonZetaEtaIotaKappaMuNuOmicronRhoTauChiDelta";
    await writeFile(file, glyphNames);
    expect((await scanClientArtifacts([directory])).findings).toEqual([]);
    await writeFile(file, glyphNames + "\n" + "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/" + "\nprivate routing prompt");
    const result = await scanClientArtifacts([directory]);
    expect(result.findings.some(finding => finding.kind === "high_entropy")).toBe(true);
    expect(result.findings.some(finding => finding.kind === "forbidden_content")).toBe(true);
  });

  it("passes a minimal client artifact", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-clean-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "runtime.txt"), "ticket executor only\n");
    const result = await scanClientArtifacts([directory]);
    expect(result.findings).toEqual([]);
  });

  it("reports fingerprints without printing protected content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-leak-"));
    temporaryDirectories.push(directory);
    await writeFile(
      join(directory, "runtime.txt"),
      "accidental private routing prompt material",
    );
    const result = await scanClientArtifacts([directory]);
    expect(result.findings).toHaveLength(1);
    expect(JSON.stringify(result.findings)).not.toContain("private routing prompt");
  });

  it("rejects legacy private-core paths even when their contents are empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-private-path-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "darwin_routed_rcc.py"), "");
    const result = await scanClientArtifacts([directory]);
    expect(result.findings.some((finding) => finding.kind === "forbidden_path")).toBe(true);
  });

  it("rejects a private-core filename embedded in a binary string", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-private-string-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "runtime.bin"), "prefix\\0os1_local_core.py\\0suffix");
    const result = await scanClientArtifacts([directory]);
    expect(result.findings.some((finding) => finding.kind === "forbidden_content")).toBe(true);
  });
});
