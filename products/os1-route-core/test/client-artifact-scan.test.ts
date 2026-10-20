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

// Each architecture stays independently subject to the same cstring scanner.
function universalMachOCStringFixture(values: string[]) {
  const header = Buffer.alloc(8 + 20 * values.length);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(values.length, 4);
  const pieces = [header];
  let offset = header.length;
  values.forEach((value, index) => {
    const aligned = Math.ceil(offset / 4096) * 4096;
    pieces.push(Buffer.alloc(aligned - offset));
    const thin = machoCStringFixture(value);
    const cpu = index === 0 ? 0x01000007 : 0x0100000c;
    thin.writeUInt32LE(cpu, 4);
    header.writeUInt32BE(cpu, 8 + 20 * index);
    header.writeUInt32BE(3, 12 + 20 * index);
    header.writeUInt32BE(aligned, 16 + 20 * index);
    header.writeUInt32BE(thin.length, 20 + 20 * index);
    header.writeUInt32BE(12, 24 + 20 * index);
    pieces.push(thin);
    offset = aligned + thin.length;
  });
  return Buffer.concat(pieces);
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

  it("allows only the three audited CI compiler types, with exact source provenance and no appended entropy", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-ci-public-types-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "ci-cstrings.bin");
    const policy = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
    const fingerprints = [
      "c2c8a7293079209e730fee3cec9d9dfa737c70f16b11e34cd893148370760e66",
      "114a70e2f9a615ddc64b64b9bf14bea793b36dc63dde82edbea962b78d2b528f",
      "a91c1be85c496305576c4c07e080f1d302bc081ba102714b24d17e1e4433a4bb",
    ];
    const tokens: string[] = [];
    for (const fingerprint of fingerprints) {
      const entry = policy.publicTokenProvenance[fingerprint];
      expect(entry.tokenKind).toBe("compiler_type");
      expect(entry.sourceRevision).toBe("27fe23154bb9d2188abce0504ae9aab3d885d2eb");
      expect(entry.sourceSHA256).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.sourceURL).toBe(`https://github.com/effacermonexistence/codex/blob/${entry.sourceRevision}/${entry.source}`);
      const source = await readFile(new URL("../../../" + entry.source, import.meta.url), "utf8");
      expect(source).toContain(entry.sourceAnchor);
      expect(createHash("sha256").update(entry.publicToken).digest("hex")).toBe(fingerprint);
      expect(entry.demangledPublicType).toBeTruthy();
      tokens.push(entry.publicToken);
    }
    expect(policy.entropy.minimumLength).toBe(48);
    expect(policy.entropy.minimumBitsPerCharacter).toBe(4.7);
    await writeFile(file, machoCStringFixture(tokens.join("\0")));
    expect((await scanClientArtifacts([file])).findings).toEqual([]);
    const canary = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
    const mutants = tokens.map(token => token + canary);
    await writeFile(file, machoCStringFixture([...mutants, canary, "private routing prompt"].join("\0")));
    const result = await scanClientArtifacts([file]);
    const rejected = new Set(result.findings.filter(row => row.kind === "high_entropy").map(row => row.fingerprint));
    for (const token of [...mutants, canary]) expect(rejected.has(createHash("sha256").update(token).digest("hex"))).toBe(true);
    expect(result.findings.some(row => row.kind === "forbidden_content")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(canary);
  });

  it("rejects altered hash, wrong demangling or missing source provenance for the exact static-local diagnostic", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-ci-type-provenance-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "scripts"));
    await mkdir(join(directory, "security"));
    const helper = join(directory, "scripts", "explain-client-scan.mjs");
    await writeFile(helper, await readFile(new URL("../scripts/explain-client-scan.mjs", import.meta.url)));
    const original = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
    const fingerprint = "c2c8a7293079209e730fee3cec9d9dfa737c70f16b11e34cd893148370760e66";
    const input = join(directory, "compiler-type.bin");
    await writeFile(input, original.publicTokenProvenance[fingerprint].publicToken);
    for (const delta of [
      { publicToken: original.publicTokenProvenance[fingerprint].publicToken + "Altered" },
      { demangledPublicType: "A different type" },
      { sourceSHA256: undefined },
      { source: undefined },
      { sourceRevision: undefined },
      { sourceURL: "https://example.invalid/not-an-audited-source" },
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

  it("allows the build399 source-verified diagnostic token in each universal slice, never similar paths or added entropy", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-build399-diagnostic-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "client.bin");
    const policy = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
    const fingerprint = "bab36416d7f32a22778d82ce3a81b860644a30e8b80180f69695429177225c23";
    const entry = policy.publicTokenProvenance[fingerprint];
    expect(entry.tokenKind).toBe("diagnostic_source_path");
    expect(entry.source).toBe("products/os1-mac-runtime/Sources/OS1/ConsumerChatGPTTransport.swift");
    expect(entry.sourceRevision).toBe("3f46fd6f62db9ee6394b4ac1c9d6c807602cebb8");
    expect(entry.sourceSHA256).toBe("f69764eae620130769061139f46b4e90c42440373c75b59d15e03f5f8b583074");
    expect(entry.sourceURL).toBe(`https://github.com/effacermonexistence/codex/blob/${entry.sourceRevision}/${entry.source}`);
    const source = await readFile(new URL("../../../" + entry.source, import.meta.url));
    expect(createHash("sha256").update(source).digest("hex")).toBe(entry.sourceSHA256);
    expect(source.toString("utf8")).toContain("URL(fileURLWithPath: #filePath)");
    expect(createHash("sha256").update(entry.publicToken).digest("hex")).toBe(fingerprint);
    expect(policy.entropy.allowedTokenSha256.filter((value: string) => value === fingerprint)).toHaveLength(1);
    expect(policy.entropy.minimumLength).toBe(48);
    expect(policy.entropy.minimumBitsPerCharacter).toBe(4.7);
    const exact = entry.publicToken + ".swift";
    await writeFile(file, universalMachOCStringFixture([exact, exact]));
    expect((await scanClientArtifacts([file])).findings).toEqual([]);

    const altered = entry.publicToken.slice(0, -1) + "X";
    for (const values of [[altered + ".swift", exact], [exact, altered + ".swift"]]) {
      await writeFile(file, universalMachOCStringFixture(values));
      const findings = (await scanClientArtifacts([file])).findings;
      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual(expect.objectContaining({ kind: "high_entropy",
        fingerprint: createHash("sha256").update(altered).digest("hex") }));
    }
    const canary = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
    const mutants = [altered, entry.publicToken + "Extra", entry.publicToken + canary,
      entry.publicToken.replace("/OS1-quality-parity-", "/OS1-unknown-audit-"), canary];
    await writeFile(file, universalMachOCStringFixture([
      exact, [...mutants.map(token => token + ".swift"), "private routing prompt"].join("\0"),
    ]));
    const result = await scanClientArtifacts([file]);
    const rejected = new Set(result.findings.filter(item => item.kind === "high_entropy").map(item => item.fingerprint));
    for (const token of mutants) expect(rejected.has(createHash("sha256").update(token).digest("hex"))).toBe(true);
    expect(result.findings.some(item => item.kind === "forbidden_content")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(canary);
  });

  it("classifies the exact build399 path without demangling or printing it and rejects mutated provenance", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-build399-provenance-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "scripts"));
    await mkdir(join(directory, "security"));
    const helper = join(directory, "scripts", "explain-client-scan.mjs");
    await writeFile(helper, await readFile(new URL("../scripts/explain-client-scan.mjs", import.meta.url)));
    const original = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
    const fingerprint = "bab36416d7f32a22778d82ce3a81b860644a30e8b80180f69695429177225c23";
    const entry = original.publicTokenProvenance[fingerprint];
    const input = join(directory, "client.bin");
    await writeFile(input, universalMachOCStringFixture([entry.publicToken + ".swift", entry.publicToken + ".swift"]));
    const policyPath = join(directory, "security", "client-artifact-scan-policy.json");
    await writeFile(policyPath, JSON.stringify(original));
    const valid = spawnSync(process.execPath, [helper, input], { encoding: "utf8" });
    expect(valid.status).toBe(0);
    expect(valid.stdout.trim().split("\n").map(line => JSON.parse(line))).toEqual([{
      fingerprint, length: entry.publicToken.length, tokenKind: "diagnostic_source_path",
      publicCompilerType: null, source: entry.source,
    }]);
    expect(valid.stdout).not.toContain(entry.publicToken);
    for (const delta of [
      { publicToken: entry.publicToken + "Extra" },
      { tokenKind: "compiler_type" },
      { sourceRevision: "not-an-immutable-revision" },
      { sourceSHA256: "not-a-source-hash" },
      { sourceURL: "https://example.invalid/not-the-audited-source" },
      { source: "products/os1-mac-runtime/Sources/OS1/Different.swift" },
    ]) {
      const policy = structuredClone(original);
      Object.assign(policy.publicTokenProvenance[fingerprint], delta);
      await writeFile(policyPath, JSON.stringify(policy));
      const diagnostic = spawnSync(process.execPath, [helper, input], { encoding: "utf8" });
      expect(diagnostic.status).not.toBe(0);
      expect(diagnostic.stdout).toBe("");
      expect(diagnostic.stderr).not.toContain(entry.publicToken);
    }
    await writeFile(policyPath, JSON.stringify(original));
    const unreviewed = entry.publicToken + "Extra";
    await writeFile(input, universalMachOCStringFixture([unreviewed + ".swift", unreviewed + ".swift"]));
    const unknown = spawnSync(process.execPath, [helper, input], { encoding: "utf8" });
    expect(unknown.status).toBe(0);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).not.toContain(unreviewed);
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

  it("allows only the source-verified build408 local Gate in either universal cstring slice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-build408-local-gate-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "client.bin");
    const policy = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
    const fingerprint = "5f4fefa8202359ac40fe5e33b2c99063fea2f7845c4bb6b2c5aa5efa1866e99f";
    const entry = policy.publicTokenProvenance[fingerprint];
    expect(entry.tokenKind).toBe("compiler_type");
    expect(entry.sourceRevision).toBe("3e9245b10c33dd8001f7ec456b19631a6c0cb863");
    expect(entry.sourceSHA256).toBe("67d557f1a2a7c37723898ffe3a8d7e54bdade7fd21dc91d380602321d6f1a0df");
    expect(entry.sourceURL).toBe(`https://github.com/effacermonexistence/codex/blob/${entry.sourceRevision}/${entry.source}`);
    const source = await readFile(new URL("../../../" + entry.source, import.meta.url));
    expect(createHash("sha256").update(source).digest("hex")).toBe(entry.sourceSHA256);
    const text = source.toString("utf8"), functionStart = text.indexOf(entry.sourceAnchor);
    expect(functionStart >= 0).toBe(true);
    expect(text.indexOf(entry.localTypeAnchor, functionStart) > functionStart).toBe(true);
    expect(createHash("sha256").update(entry.publicToken).digest("hex")).toBe(fingerprint);
    expect(policy.entropy.allowedTokenSha256.filter((value: string) => value === fingerprint)).toHaveLength(1);
    expect(policy.entropy.minimumLength).toBe(48);
    expect(policy.entropy.minimumBitsPerCharacter).toBe(4.7);
    if (process.platform === "darwin") {
      const demangled = spawnSync("xcrun", ["swift-demangle", "--compact"], {input: entry.publicToken + "\n", encoding: "utf8"});
      expect(demangled.status).toBe(0);
      expect(demangled.stdout.trim() === entry.demangledPublicType).toBe(true);
    }
    await writeFile(file, universalMachOCStringFixture([entry.publicToken, entry.publicToken]));
    expect((await scanClientArtifacts([file])).findings).toEqual([]);
    const altered = entry.publicToken.slice(0, -1) + "X";
    for (const values of [[altered, entry.publicToken], [entry.publicToken, altered]]) {
      await writeFile(file, universalMachOCStringFixture(values));
      const result = await scanClientArtifacts([file]);
      expect(result.findings.filter(item => item.kind === "high_entropy").map(item => item.fingerprint))
        .toEqual([createHash("sha256").update(altered).digest("hex")]);
    }
    const canary = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
    const mutants = [altered, entry.publicToken + "Extra", entry.publicToken + canary, canary + entry.publicToken, canary];
    await writeFile(file, universalMachOCStringFixture([entry.publicToken, mutants.join("\0") + "\0private routing prompt"]));
    const result = await scanClientArtifacts([file]);
    const rejected = new Set(result.findings.filter(item => item.kind === "high_entropy").map(item => item.fingerprint));
    for (const token of mutants) expect(rejected.has(createHash("sha256").update(token).digest("hex"))).toBe(true);
    expect(result.findings.some(item => item.kind === "forbidden_content")).toBe(true);
    expect(JSON.stringify(result).includes(canary)).toBe(false);
    expect(JSON.stringify(result).includes(entry.publicToken)).toBe(false);
  });

  it("classifies only the exact build408 Gate with immutable function/class provenance and no raw token output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "os1-build408-gate-proof-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "scripts")); await mkdir(join(directory, "security"));
    const helper = join(directory, "scripts", "explain-client-scan.mjs");
    await writeFile(helper, await readFile(new URL("../scripts/explain-client-scan.mjs", import.meta.url)));
    const original = JSON.parse(await readFile(new URL("../security/client-artifact-scan-policy.json", import.meta.url), "utf8"));
    const fingerprint = "5f4fefa8202359ac40fe5e33b2c99063fea2f7845c4bb6b2c5aa5efa1866e99f", entry = original.publicTokenProvenance[fingerprint];
    const input = join(directory, "client.bin"), policyPath = join(directory, "security", "client-artifact-scan-policy.json");
    await writeFile(input, universalMachOCStringFixture([entry.publicToken, entry.publicToken]));
    await writeFile(policyPath, JSON.stringify(original));
    const valid = spawnSync(process.execPath, [helper, input], { encoding: "utf8" });
    expect(valid.status).toBe(0);
    const rows = valid.stdout.trim().split("\n").map(line => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({fingerprint, length: 92, tokenKind: "compiler_type",
      publicCompilerType: process.platform === "darwin" ? entry.demangledPublicType : null, source: entry.source});
    expect(valid.stdout.includes(entry.publicToken)).toBe(false);
    for (const delta of [{publicToken: entry.publicToken + "Extra"}, {tokenKind: "diagnostic_source_path"},
      {demangledPublicType: "Wrong public type"}, {source: "products/os1-mac-runtime/Sources/OS1App/Different.swift"},
      {sourceRevision: "0".repeat(40)}, {sourceSHA256: "0".repeat(64)}, {sourceURL: "https://example.invalid/not-reviewed"},
      {sourceAnchor: "private func anotherTest() async throws"}, {localTypeAnchor: "struct Gate {}"}]) {
      const policy = structuredClone(original); Object.assign(policy.publicTokenProvenance[fingerprint], delta);
      await writeFile(policyPath, JSON.stringify(policy));
      const diagnostic = spawnSync(process.execPath, [helper, input], { encoding: "utf8" });
      expect(diagnostic.status !== 0).toBe(true); expect(diagnostic.stdout).toBe("");
      expect(diagnostic.stderr.includes(entry.publicToken)).toBe(false);
    }
    await writeFile(policyPath, JSON.stringify(original));
    const unknown = entry.publicToken + "Extra";
    await writeFile(input, universalMachOCStringFixture([unknown, unknown]));
    const unreviewed = spawnSync(process.execPath, [helper, input], { encoding: "utf8" });
    expect(unreviewed.status).toBe(0); expect(unreviewed.stdout).toBe("");
    expect(unreviewed.stderr.includes(unknown)).toBe(false);
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
