import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { scanClientArtifacts } from "../scripts/client-artifact-scan.mjs";

const temporaryDirectories: string[] = [];

async function auditedPublicTokens() {
  const policy = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
  return Object.entries(policy.publicTokenProvenance).flatMap(([fingerprint, entry]) => {
    const provenance = entry as { publicToken?: string; source: string; tokenKind: string };
    if (typeof provenance.publicToken !== "string") {
      expect(provenance.tokenKind).toBe("public_font_glyph_names");
      return [];
    }
    expect(["compiler_type", "diagnostic_source_path"]).toContain(provenance.tokenKind);
    expect(createHash("sha256").update(provenance.publicToken).digest("hex")).toBe(fingerprint);
    expect(policy.entropy.allowedTokenSha256).toContain(fingerprint);
    return [{ fingerprint, token: provenance.publicToken, source: provenance.source, tokenKind: provenance.tokenKind }];
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

  it("matches every explicitly typed audited public token exactly inside a scanned Mach-O cstring section", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-audited-cstrings-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "client.bin");
    const audited = await auditedPublicTokens();
    const policy = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
    const kinds = Object.values(policy.publicTokenProvenance).map(entry => (entry as { tokenKind: string }).tokenKind);
    // Inventory follows the explicitly typed policy, not a stale symbol count.
    expect(audited).toHaveLength(kinds.filter(kind => ["compiler_type", "diagnostic_source_path"].includes(kind)).length);
    expect(new Set(audited.map(item => item.fingerprint)).size).toBe(audited.length);
    expect(kinds).toContain("compiler_type");
    expect(kinds).toContain("diagnostic_source_path");
    expect(kinds).toContain("public_font_glyph_names");
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

  it("diagnoses only exact audited public tokens and distinguishes paths from compiler types without printing suspected bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-scan-diagnostics-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "client.bin");
    const audited = await auditedPublicTokens();
    const unreviewed = audited[0]!.token + "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
    await writeFile(file, [...audited.map(item => item.token), unreviewed].join("\0"));
    const diagnostic = spawnSync(process.execPath, [
      fileURLToPath(new URL("../scripts/explain-client-scan.mjs", import.meta.url)), file,
    ], { encoding: "utf8" });
    expect(diagnostic.status).toBe(0);
    const rows = diagnostic.stdout.trim().split("\n").map(line => JSON.parse(line));
    expect(rows).toHaveLength(audited.length);
    for (const item of audited) {
      expect(rows).toContainEqual(expect.objectContaining({ fingerprint: item.fingerprint, source: item.source, tokenKind: item.tokenKind }));
      if (item.tokenKind === "diagnostic_source_path") {
        expect(rows.find(row => row.fingerprint === item.fingerprint).publicCompilerType).toBeNull();
      }
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

  it("allows only the two source-verified browser diagnostic paths, never similar paths or added credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-browser-diagnostics-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "client.bin");
    const policy = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
    const fingerprints = [
      "88346c5e520d9727ddd33a01fa1d75a6209afb97a46e0fbca6465ff43f838d1a",
      "9e6f24e5038f815a68210f01a6ec546e7fd045d442247cff85c43f40daadf6ab",
    ];
    const tokens: string[] = [];
    for (const fingerprint of fingerprints) {
      const entry = policy.publicTokenProvenance[fingerprint];
      expect(entry.tokenKind).toBe("diagnostic_source_path");
      expect(entry.sourceRevision).toBe("0bd91bfaa435441db5c0b27804a311d3c7f2b1e2");
      expect(entry.sourceURL).toBe(`https://github.com/effacermonexistence/codex/blob/${entry.sourceRevision}/${entry.source}`);
      const source = await readFile(new URL("../../../" + entry.source, import.meta.url));
      expect(createHash("sha256").update(source).digest("hex")).toBe(entry.sourceSHA256);
      expect(createHash("sha256").update(entry.publicToken).digest("hex")).toBe(fingerprint);
      expect(policy.entropy.allowedTokenSha256).toContain(fingerprint);
      tokens.push(entry.publicToken);
    }
    await writeFile(file, machoCStringFixture(tokens.map(token => token + ".swift").join("\0")));
    expect((await scanClientArtifacts([directory])).findings).toEqual([]);
    const credentialLikeSuffix = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
    const mutants = tokens.flatMap(token => [token + "Extra", token + credentialLikeSuffix]);
    await writeFile(file, machoCStringFixture(mutants.map(token => token + ".swift").join("\0")));
    const result = await scanClientArtifacts([directory]);
    const rejected = new Set(result.findings.filter(item => item.kind === "high_entropy").map(item => item.fingerprint));
    for (const token of mutants) {
      expect(rejected.has(createHash("sha256").update(token).digest("hex"))).toBe(true);
    }
    expect(JSON.stringify(result)).not.toContain(credentialLikeSuffix);
  });

  it("rejects incorrect diagnostic-path kind or provenance instead of treating every path as compiler evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-provenance-diagnostics-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "scripts"));
    await mkdir(join(directory, "security"));
    const helper = join(directory, "scripts", "explain-client-scan.mjs");
    await writeFile(helper, await readFile(new URL("../scripts/explain-client-scan.mjs", import.meta.url)));
    const original = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
    const fingerprint = "88346c5e520d9727ddd33a01fa1d75a6209afb97a46e0fbca6465ff43f838d1a";
    const input = join(directory, "client.bin");
    await writeFile(input, original.publicTokenProvenance[fingerprint].publicToken);
    for (const delta of [
      { tokenKind: "compiler_type" },
      { sourceRevision: "not-an-immutable-revision" },
      { sourceSHA256: "not-a-source-hash" },
      { sourceURL: "https://example.invalid/not-the-audited-source" },
      { source: "products/os1-mac-runtime/Sources/OS1App/Different.swift" },
    ]) {
      const policy = structuredClone(original);
      Object.assign(policy.publicTokenProvenance[fingerprint], delta);
      await writeFile(join(directory, "security", "client-artifact-scan-policy.json"), JSON.stringify(policy));
      const diagnostic = spawnSync(process.execPath, [helper, input], { encoding: "utf8" });
      expect(diagnostic.status).not.toBe(0);
      expect(diagnostic.stdout).toBe("");
      expect(diagnostic.stderr).not.toContain(original.publicTokenProvenance[fingerprint].publicToken);
    }
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
