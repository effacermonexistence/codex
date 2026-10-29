import CryptoKit
import Foundation

/// Build 446 (DESIGN-5 §B, owner order 2026-10-29): ONE local model per
/// machine, sized to it, so OS-1 runs on low-spec computers and a 16 GiB Mac
/// never swaps two local models in and out.
///
/// "Install only one local model, sized to the machine." The host picks at
/// startup from the physical RAM and the models installed in OS-1's own
/// Ollama store:
/// - RAM >= 16 GiB and `qwen3.5:9b` installed at its pinned digest: 9b for
///   EVERYTHING (the request classifier, local chat, the OpenClaw local
///   surface and planner, the routing-order interpreter);
/// - otherwise `qwen3.5:4b` for everything. The classifier's domain call
///   stays 9b-only (`LocalRequestClassifier.readsDomain`, DESIGN-4 §4).
/// This table is the only place a local model name is written: the catalog's
/// local row, the gateway's pin and allowlist (the host passes the name to
/// the OS-1 bridge plugin, which passes it to Core), the classifier and the
/// interpreter all read `active`. A model OS-1 no longer uses stays installed:
/// nothing here deletes, moves or converts a model file.
///
/// Measured 2026-10-29 on this Air (16 GiB, both models present, nothing else
/// loading models; scratchpad b446/latency.py): build 445 (classifier 9b at
/// Ollama's default context, local chat 4b at the gateway's 32768) reloaded
/// both models on every request (8 reloads in 4 warm requests), warm median
/// classify 11.3 s + chat 9.0 s = 20.2 s, and a reloaded classifier call
/// passed its 12 s bound; build 446 (9b for both at the one shared context)
/// reloaded nothing, warm median classify 6.4 s + chat 5.6 s = 12.1 s.
/// Resident: 4b at 32768 4.35 GB; 9b at 32768 6.69 GB.
public enum LocalModelSelection {
    public struct Candidate: Equatable, Sendable {
        public let name: String
        /// The Ollama digest: SHA-256 of the model's manifest in the store.
        public let digest: String
        public let bytes: Int64
        public let minimumMemoryBytes: UInt64
    }
    public static let gibibyte: UInt64 = 1 << 30
    /// Largest first. Digests are the registry manifests OS-1's store holds
    /// (4b: the one local-controller-sources.json pins and provisioning
    /// verifies; 9b: the store's manifest, recorded 2026-10-09 in
    /// ~/.os1/local-router/model9-identity.json and re-read 2026-10-29).
    public static let candidates: [Candidate] = [
        .init(name: "qwen3.5:9b", digest: "56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90",
              bytes: 6_550_825_550, minimumMemoryBytes: 16 * gibibyte),
        .init(name: "qwen3.5:4b", digest: "d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04",
              bytes: 3_324_173_934, minimumMemoryBytes: 0),
    ]
    /// The smallest candidate: what every OS-1 local router provisioned since
    /// it existed, and the choice when nothing larger qualifies.
    public static var baseline: Candidate { candidates[candidates.count - 1] }
    /// The one context every local call uses (the OpenClaw gateway's, which
    /// a 20,144-token planner prompt needs). Ollama reloads a model whose
    /// requested context differs from its resident runner's, so the
    /// classifier, the interpreter and the warm-keeper send the same value.
    public static let contextTokens = 32_768

    public static func candidate(named name: String) -> Candidate? { candidates.first { $0.name == name } }

    /// The pure rule: the largest candidate this machine's memory admits that
    /// is installed (name, and digest when the inventory carries digests);
    /// nil when none is (a model too large for the machine is never used).
    public static func choose(physicalMemory: UInt64, installed: [String: String?]) -> Candidate? {
        func present(_ candidate: Candidate) -> Bool {
            guard let entry = installed[candidate.name] else { return false }
            return entry.map { $0 == candidate.digest } ?? true
        }
        return candidates.first { physicalMemory >= $0.minimumMemoryBytes && present($0) }
    }
    /// Name-only inventories (the loopback `/api/tags` names the classifier reads).
    public static func choose(physicalMemory: UInt64, installedNames: [String]) -> Candidate? {
        choose(physicalMemory: physicalMemory, installed: Dictionary(installedNames.map { ($0, String?.none) },
                                                                      uniquingKeysWith: { first, _ in first }))
    }
    /// The loopback inventory's model names (`/api/tags` rows) as the
    /// classifier and the warm-keeper read them: a candidate's name only at
    /// its pinned digest (review of 446: a re-pulled tag is not the selected
    /// model), every other name as listed.
    public static func pinnedInventoryNames(_ rows: [[String: Any]]) -> [String] {
        rows.compactMap { row in
            guard let name = row["name"] as? String else { return nil }
            guard let candidate = candidate(named: name) else { return name }
            return row["digest"] as? String == candidate.digest ? name : nil
        }
    }
    /// A NEW machine's one model to pull: by memory alone (DESIGN-5 §B "pull
    /// only the chosen one").
    public static func toProvision(physicalMemory: UInt64) -> Candidate {
        candidates.first { physicalMemory >= $0.minimumMemoryBytes } ?? baseline
    }

    /// OS-1's private Ollama store (`OLLAMA_MODELS` of the managed server).
    public static func store(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent(".os1/local-router/models", isDirectory: true)
    }
    /// The candidates installed in the store at their pinned digests, read
    /// from the manifests on disk (no network, no Ollama call): each manifest
    /// is a bounded regular file whose SHA-256 is the model's digest.
    public static func installedOnDisk(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> [String: String?] {
        var found: [String: String?] = [:]
        for candidate in candidates {
            let parts = candidate.name.split(separator: ":").map(String.init)
            guard parts.count == 2 else { continue }
            let manifest = store(home: home).appendingPathComponent("manifests/registry.ollama.ai/library", isDirectory: true)
                .appendingPathComponent(parts[0], isDirectory: true).appendingPathComponent(parts[1])
            guard let values = try? manifest.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]),
                  values.isRegularFile == true, values.isSymbolicLink != true, (values.fileSize ?? .max) <= 65_536,
                  let data = try? Data(contentsOf: manifest) else { continue }
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            if digest == candidate.digest { found[candidate.name] = digest }
        }
        return found
    }

    private final class State: @unchecked Sendable {
        let lock = NSLock()
        var active: Candidate?
    }
    private static let state = State()
    /// The model this process uses for every local call, decided once (first
    /// use, or a host's `activate`): physical RAM and the store on disk. With
    /// nothing installed it is the baseline, whose readiness probes then fail
    /// visibly (never another model).
    public static var active: Candidate {
        state.lock.lock(); defer { state.lock.unlock() }
        if let active = state.active { return active }
        let chosen = choose(physicalMemory: ProcessInfo.processInfo.physicalMemory, installed: installedOnDisk()) ?? baseline
        state.active = chosen
        return chosen
    }
    /// A host or a fixture fixing the choice for this process.
    public static func activate(_ candidate: Candidate) {
        state.lock.lock(); state.active = candidate; state.lock.unlock()
    }
    /// The plugin config key that carries the name to the OS-1 bridge plugin and Core.
    public static let pluginConfigKey = "local_model"
}
