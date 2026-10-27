import Foundation

/// K11 (routing architecture v2, §4.4): the D4 measurement artifact gate of a
/// class certificate. A certificate in the signed class table (`RCCClassTable`)
/// names its measurement only by `measurement_sha256`; the catalog builder
/// emits it ONLY when the host holds that measurement artifact and it is the
/// one the certificate was issued from:
///
/// - present in host custody (`custodyPath`, read through the host's private
///   input gate) and hashing to `measurement_sha256`;
/// - strictly shaped (`os1_rcc_class_measurement_v1`, exact keys at every
///   level, no duplicate key, integers never taken from a bool or a fraction);
/// - scoped to this certificate: id, request class, tuple and format check;
/// - measured against the pool's CURRENT reference (its frontier model at its
///   native ceiling, as the builder computes it), under the current executor
///   contract and harness profile (`harness_scope`, `HarnessProfile` id@version);
/// - inside its validity window, with a PASS result: at least 60 cases, no
///   accepted_B, no hard-check regression, the tier's disagreement with the
///   reference no larger than the reference's own A/A disagreement.
///
/// Build 440: the one exception is the owner-decision certificate of
/// `chat_explanatory` (`RCCClassOwnerDecision`, owner order 2026-10-27),
/// judged by the compiled decision instead of a D4 artifact.
///
/// Anything else drops ONLY the certificate (the node binds the reference);
/// every other admission fact stays. Core cannot see host custody, so this is
/// a host attestation like `task_contract.bindings_checked`; the catalog wire
/// is unchanged. Deleting the artifact file withdraws one certificate without
/// a rebuild. Pure: the bytes, clock and scope are inputs.
public enum RCCClassMeasurement {
    public typealias C = RCCRuntimeContract
    public static let schema = 1
    public static let kind = "os1_rcc_class_measurement_v1"
    public static let minimumCases: Int64 = 60

    /// A pool's current reference: its frontier model at that model's native
    /// ceiling, with an offered row (see `RCCNativeCatalogBuilder.build`).
    public struct Reference: Equatable, Sendable {
        public var provider: String
        public var model: String
        public var effort: String
        public init(provider: String, model: String, effort: String) {
            self.provider = provider; self.model = model; self.effort = effort
        }
    }

    /// Why a certificate was not loaded, first failing check only.
    public enum Rejection: String, Error, Equatable, Sendable, CaseIterable {
        case artifactAbsent = "artifact_absent", hashMismatch = "hash_mismatch", malformed
        case scopeMismatch = "scope_mismatch", referenceMismatch = "reference_mismatch"
        case executorMismatch = "executor_mismatch", harnessMismatch = "harness_mismatch"
        case notYetValid = "not_yet_valid", expired, resultNotPass = "result_not_pass"
    }

    /// The harness scope a measurement binds: the profile id AND version, so
    /// a new descriptor (an H change) never inherits an older measurement.
    /// One encoding: the artifact's `harness_scope` and the pre-dispatch
    /// receipt's `harness_scope` are both this string ("H0@1"), so a D4
    /// producer copies it from a receipt verbatim.
    public static func harnessScope(_ profile: HarnessProfile.Descriptor) -> String { "\(profile.id)@\(profile.version)" }

    /// `~/.os1/rcc-runtime/class-measurements/<sha256>.json`; nil unless the
    /// name is a lowercase SHA-256 (no path can be smuggled through it).
    public static func custodyPath(home: URL, sha256: String) -> URL? {
        guard C.isHash(sha256) else { return nil }
        return home.appendingPathComponent(".os1/rcc-runtime/class-measurements", isDirectory: true)
            .appendingPathComponent(sha256 + ".json")
    }

    private struct Tuple: Decodable, Equatable { let provider: String, model: String, effort: String }
    private struct Outcome: Decodable {
        let verdict: String, n: Int64, acceptedB: Int64, hardCheckRegressions: Int64
        let tierDisagreement: Int64, referenceAADisagreement: Int64
        enum CodingKeys: String, CodingKey {
            case verdict, n, acceptedB = "accepted_b", hardCheckRegressions = "hard_check_regressions"
            case tierDisagreement = "tier_disagreement", referenceAADisagreement = "reference_aa_disagreement"
        }
    }
    private struct Artifact: Decodable {
        let schema: Int, kind: String, certificateID: String, requestClass: String, tuple: Tuple, formatCheck: String
        let reference: Tuple, executorContractSHA256: String, harnessScope: String
        let issuedAtMS: Int64, validUntilMS: Int64, result: Outcome, evidenceSHA256: String
        enum CodingKeys: String, CodingKey {
            case schema, kind, tuple, reference, result
            case certificateID = "certificate_id", requestClass = "request_class", formatCheck = "format_check"
            case executorContractSHA256 = "executor_contract_sha256", harnessScope = "harness_scope"
            case issuedAtMS = "issued_at_ms", validUntilMS = "valid_until_ms", evidenceSHA256 = "evidence_sha256"
        }
    }
    private static let artifactKeys: Set<String> = ["schema", "kind", "certificate_id", "request_class", "tuple", "format_check",
        "reference", "executor_contract_sha256", "harness_scope", "issued_at_ms", "valid_until_ms", "result", "evidence_sha256"]
    private static let tupleKeys: Set<String> = ["provider", "model", "effort"]
    private static let outcomeKeys: Set<String> = ["verdict", "n", "accepted_b", "hard_check_regressions",
                                                   "tier_disagreement", "reference_aa_disagreement"]

    /// Same pattern as `RCCClassTable.decode`: the duplicate-key and size
    /// gate with exact keys at every level, then a typed decode (a JSON bool
    /// or fraction is never an integer).
    private static func decode(_ data: Data) -> Artifact? {
        guard let object = try? C.checkedObject(data), Set(object.keys) == artifactKeys,
              let tuple = object["tuple"] as? [String: Any], Set(tuple.keys) == tupleKeys,
              let reference = object["reference"] as? [String: Any], Set(reference.keys) == tupleKeys,
              let result = object["result"] as? [String: Any], Set(result.keys) == outcomeKeys,
              let value = try? JSONDecoder().decode(Artifact.self, from: data),
              value.schema == schema, value.kind == kind, C.isHash(value.executorContractSHA256),
              !value.harnessScope.isEmpty, value.harnessScope.utf8.count <= 128 else { return nil }
        return value
    }

    /// The certificate when its artifact passes every check above, else the
    /// first failing check. `reference` is the certificate pool's current
    /// reference; nil (none, or a direct caller that computed none) rejects.
    ///
    /// Build 440: a certificate naming the compiled owner decision
    /// (`RCCClassOwnerDecision.pinnedSHA256`) is judged by that decision
    /// instead of a D4 measurement; a custody artifact plays no part in it.
    /// Every other hash keeps the measurement gate below, which refuses an
    /// owner-decision kind (it is not `os1_rcc_class_measurement_v1`).
    public static func verified(_ certificate: C.ClassCertificate, requestClass: C.RequestClass, artifact: Data?, now: Date,
                                executorContractSHA256: String, harnessProfile: String?,
                                reference: Reference?) -> Result<C.ClassCertificate, Rejection> {
        if certificate.measurementSHA256 == RCCClassOwnerDecision.pinnedSHA256 {
            return RCCClassOwnerDecision.verified(certificate, requestClass: requestClass, harnessProfile: harnessProfile,
                                                  reference: reference)
        }
        guard let artifact else { return .failure(.artifactAbsent) }
        guard C.isHash(certificate.measurementSHA256), C.digest(artifact) == certificate.measurementSHA256 else {
            return .failure(.hashMismatch)
        }
        guard let value = decode(artifact) else { return .failure(.malformed) }
        guard requestClass.certifiable, value.certificateID == certificate.certificateID,
              value.requestClass == requestClass.rawValue, value.formatCheck == certificate.formatCheck,
              value.tuple == Tuple(provider: certificate.provider, model: certificate.model,
                                   effort: certificate.effort.rawValue) else { return .failure(.scopeMismatch) }
        guard let reference, reference.provider == certificate.provider,
              value.reference == Tuple(provider: reference.provider, model: reference.model, effort: reference.effort) else {
            return .failure(.referenceMismatch)
        }
        guard value.executorContractSHA256 == executorContractSHA256 else { return .failure(.executorMismatch) }
        guard let harnessProfile, value.harnessScope == harnessProfile else { return .failure(.harnessMismatch) }
        // The same millisecond clock the builder stamps rows with.
        let nowMS = Int64(now.timeIntervalSince1970 * 1000)
        guard value.issuedAtMS <= nowMS else { return .failure(.notYetValid) }
        guard nowMS < value.validUntilMS else { return .failure(.expired) }
        let r = value.result
        guard r.verdict == "pass", r.n >= minimumCases, r.acceptedB == 0, r.hardCheckRegressions == 0,
              r.tierDisagreement >= 0, r.tierDisagreement <= r.referenceAADisagreement, r.referenceAADisagreement <= r.n,
              C.isHash(value.evidenceSHA256) else { return .failure(.resultNotPass) }
        return .success(certificate)
    }
}
