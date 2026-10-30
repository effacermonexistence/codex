import Foundation

/// Build 447 (DESIGN-8, owner-approved direction 2026-10-29): the host side
/// of the routing law.
///
/// The owner's only input is the objective: the result of the newest top
/// model at its highest reasoning, with less quota. Core (rcc-runtime.mjs,
/// routing law) turns the local model's reading into a family, keeps the
/// candidates with evidence that they give the reference's result on that
/// family's benchmark tiers, prices each in real quota (E[Q] = Q + p_fail x
/// Q(escalation) + scarcity) and binds the argmin. Its inputs are one compiled
/// table (`scripts/routing-law-table.mjs`; `Resources/routing-law-table.json`
/// is the reviewable copy, Core embeds the same bytes): `tableSHA256` is the
/// pin both sides check.
///
/// The host only (a) decides the switch, (b) reads the request with the local
/// model for every Auto request (the keyword rails no longer decide the tier:
/// they set the permission scope only) and (c) carries the raw reading and
/// the owner's own reference words (`reference_request`, build 446's
/// capability guard) in the catalog's `routing_law`. The rollback is `routing_policy=law_446`: the
/// catalog then carries no `routing_law` and Core keeps build 446's routes.
public enum RoutingLaw {
    /// SHA-256 of `Resources/routing-law-table.json` (the compiled table).
    public static let tableSHA256 = "78c5fb182df056753b227866464ae6bf581bf677494108aa6d9877f2a3500815"

    public enum Policy: String, Codable, Sendable, CaseIterable {
        case law446 = "law_446", law447 = "law_447"
    }
    public static let defaultPolicy: Policy = .law447
    /// One-shot override for a process (tests, a rollback drill).
    public static let environmentKey = "OS1_ROUTING_POLICY"
    /// The persistent switch: `{"routing_policy":"law_446"}` rolls back,
    /// `{"routing_policy":"law_447"}` (or no file) runs the law.
    public static func policyFile(home: URL) -> URL { home.appendingPathComponent(".os1/routing-policy.json") }

    public struct Selection: Equatable, Sendable {
        public var policy: Policy
        /// `environment`, `file`, `default`, or `default_invalid_file` (an
        /// unreadable or malformed switch file: the default runs, visibly).
        public var source: String
        public init(policy: Policy, source: String) { self.policy = policy; self.source = source }
        public var receiptLine: String { "routing policy \(policy.rawValue) (\(source))" }
    }

    /// The switch: the environment, else the file, else the default.
    public static func policy(home: URL = FileManager.default.homeDirectoryForCurrentUser,
                              environment: [String: String] = ProcessInfo.processInfo.environment) -> Selection {
        if let raw = environment[environmentKey], let value = Policy(rawValue: raw) {
            return Selection(policy: value, source: "environment")
        }
        let url = policyFile(home: home)
        guard FileManager.default.fileExists(atPath: url.path) else { return Selection(policy: defaultPolicy, source: "default") }
        guard let data = try? Data(contentsOf: url), data.count <= 4_096,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == ["routing_policy"], let raw = object["routing_policy"] as? String,
              let value = Policy(rawValue: raw) else {
            return Selection(policy: defaultPolicy, source: "default_invalid_file")
        }
        return Selection(policy: value, source: "file")
    }

    /// The catalog's `routing_law` for one request under `policy`: nil under
    /// law_446 (build 446's routes), else the local reading as read (the
    /// enum call, the domain call and, build 447, the intent call), or
    /// `reader: none` with no reading when the local model gave none (Core's
    /// family U: only evidence across the broad tiers, or the reference).
    public static func catalogLaw(policy: Policy, receipt: LocalRequestClassifier.Receipt?) -> RCCRuntimeContract.RoutingLaw? {
        guard policy == .law447 else { return nil }
        guard let adopted = receipt?.adopted, LocalRequestClassifier.validModelName(adopted.model) else {
            return RCCRuntimeContract.RoutingLaw(tableSHA256: tableSHA256, reader: "none", reading: nil)
        }
        let answer = adopted.answer
        return RCCRuntimeContract.RoutingLaw(tableSHA256: tableSHA256, reader: "local_llm:" + adopted.model,
            reading: .init(taskType: answer.taskType.rawValue, difficulty: answer.difficulty.rawValue,
                           needsTools: answer.needsTools.rawValue, domain: answer.domain.rawValue,
                           intent: answer.intent?.rawValue))
    }
}
