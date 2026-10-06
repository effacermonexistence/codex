import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { scanClientArtifacts } from "../scripts/client-artifact-scan.mjs";

const temporaryDirectories: string[] = [];

async function auditedCompilerTokens() {
  const policy = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
  return Object.entries(policy.publicTokenProvenance).flatMap(([fingerprint, entry]) => {
    const provenance = entry as { publicToken?: string; source: string };
    if (typeof provenance.publicToken !== "string") return [];
    expect(createHash("sha256").update(provenance.publicToken).digest("hex")).toBe(fingerprint);
    expect(policy.entropy.allowedTokenSha256).toContain(fingerprint);
    return [{ fingerprint, token: provenance.publicToken, source: provenance.source }];
  });
}

function machoCStringFixture(value: string) {
  const strings = Buffer.from(value + "\0");
  const header = Buffer.alloc(32 + 72 + 80);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(1, 16);
  header.writeUInt32LE(72 + 80, 20);
  header.writeUInt32LE(0x19, 32);
  header.writeUInt32LE(72 + 80, 36);
  header.write("__TEXT", 40, "ascii");
  header.writeUInt32LE(1, 32 + 64);
  header.write("__cstring", 32 + 72, "ascii");
  header.write("__TEXT", 32 + 72 + 16, "ascii");
  header.writeBigUInt64LE(BigInt(strings.length), 32 + 72 + 40);
  header.writeUInt32LE(header.length, 32 + 72 + 48);
  header.writeUInt32LE(2, 32 + 72 + 64);
  return Buffer.concat([header, strings]);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("client release artifact hygiene gate", () => {

  it("matches every audited compiler token exactly inside a scanned Mach-O cstring section", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-audited-cstrings-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "client.bin");
    const audited = await auditedCompilerTokens();
    expect(audited).toHaveLength(18);
    await writeFile(file, machoCStringFixture(audited.map(item => item.token).join("\0")));
    expect((await scanClientArtifacts([directory])).findings).toEqual([]);

    const secretLikeSuffix = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
    const appended = audited.map(item => item.token + secretLikeSuffix);
    const altered = audited.map(item => item.token.replace("P33_", "P33_F") + secretLikeSuffix);
    await writeFile(file, machoCStringFixture([...appended, ...altered, "private routing prompt"].join("\0")));
    const result = await scanClientArtifacts([directory]);
    const rejected = new Set(result.findings.filter(item => item.kind === "high_entropy").map(item => item.fingerprint));
    for (const token of [...appended, ...altered]) {
      expect(rejected.has(createHash("sha256").update(token).digest("hex"))).toBe(true);
    }
    expect(result.findings.some(item => item.kind === "forbidden_content")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(secretLikeSuffix);
  });

  it("diagnoses only exact audited compiler tokens without printing suspected bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-scan-diagnostics-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "client.bin");
    const audited = await auditedCompilerTokens();
    const unreviewed = audited[0]!.token + "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
    await writeFile(file, [...audited.map(item => item.token), unreviewed].join("\0"));
    const diagnostic = spawnSync(process.execPath, [
      fileURLToPath(new URL("../scripts/explain-client-scan.mjs", import.meta.url)), file,
    ], { encoding: "utf8" });
    expect(diagnostic.status).toBe(0);
    const rows = diagnostic.stdout.trim().split("\n").map(line => JSON.parse(line));
    expect(rows).toHaveLength(audited.length);
    for (const item of audited) {
      expect(rows).toContainEqual(expect.objectContaining({ fingerprint: item.fingerprint, source: item.source }));
      expect(diagnostic.stdout).not.toContain(item.token);
    }
    expect(diagnostic.stdout).not.toContain(unreviewed);
    await writeFile(file, unreviewed);
    const unknownOnly = spawnSync(process.execPath, [
      fileURLToPath(new URL("../scripts/explain-client-scan.mjs", import.meta.url)), file,
    ], { encoding: "utf8" });
    expect(unknownOnly.status).toBe(0);
    expect(unknownOnly.stdout).toBe("");
  });

  it("allows exact audited public compiler type tokens, never a general binary exemption", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-public-types-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "OS1App.bin");
    const publicTypes = [
      "_TtC6OS1AppP33_E4338E7CE7A60E44AE4AAB89C865B63321SpeechAudioBufferSink",
      "_TtC6OS1AppP33_E4338E7CE7A60E44AE4AAB89C865B63325TranscriptSnapshotSurface",
      "_TtC6OS1AppP33_E4338E7CE7A60E44AE4AAB89C865B63328ContinuousTranscriptTextView",
      "_TtCV6OS1AppP33_E4338E7CE7A60E44AE4AAB89C865B63324ContinuousTranscriptView11Coordinator",
      "_TtC9SwiftMathP33_8258232E753A187089D8181EFE1F648A13BundleManager"
];
    await writeFile(file, publicTypes.join("\n"));
    expect((await scanClientArtifacts([directory])).findings).toEqual([]);
    await writeFile(file, publicTypes.join("\n") + "\n" + publicTypes[0] + "Extra" +
      "\n" + "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/" +
      "\nprivate routing prompt");
    const result = await scanClientArtifacts([directory]);
    expect(result.findings.filter(finding => finding.kind === "high_entropy").length).toBeGreaterThanOrEqual(2);
    expect(result.findings.some(finding => finding.kind === "forbidden_content")).toBe(true);
  });
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
