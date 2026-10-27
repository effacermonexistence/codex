import Foundation

/// Build 407 (R0(c), R11): the signed class table. Build 440 (owner order
/// 2026-10-27): it certifies exactly ONE class, `chat_explanatory`, for
/// (codex, gpt-6-luna, low) with the `nonempty_text` format check, on the
/// basis of the compiled owner decision (`RCCClassOwnerDecision`) its
/// `measurement_sha256` names. No other class is certified and no class pins
/// a reference pool, so every other node without an owner contract or a
/// registered verifier binds the reference.
///
/// Any other class enters only after a frozen held-out measurement (at least
/// 60 cases, the tier's disagreement with the reference no larger than the
/// reference's own A/A disagreement, zero hard-check regressions) with owner
/// sign-off, in a separate build that changes `frozenBytes` AND re-pins
/// `pinnedSHA256`.
///
/// `Resources/rcc-class-table.json` is the reviewable artifact. Its exact
/// bytes are compiled in here and the regression fixture proves the two are
/// identical, so no runtime file lookup can select another table.
///
/// K11: a signed certificate is still not enough. The catalog builder emits
/// one only when the host also holds the D4 measurement artifact its
/// `measurement_sha256` names, and that artifact verifies against the current
/// reference, executor contract, harness profile and validity window
/// (`RCCClassMeasurement`); the owner-decision certificate is judged by the
/// compiled decision instead. The artifact is never selected by lookup: it
/// must hash to the value compiled in here.
public struct RCCClassTable: Equatable, Sendable {
    public static let frozenBytes = Data((#"{"class_certificates":{"chat_explanatory":{"certificate_id":"owner-chat-fast-20261027","effort":"low","format_check":"nonempty_text","measurement_sha256":"af958f76401c42133b8f90db2fcae11fd5eb62c5c4f51a27e9df54e780cce36f","model":"gpt-6-luna","provider":"codex"}},"class_provider_pins":{},"schema":1}"# + "\n").utf8)
    public static let pinnedSHA256 = "41bdb810b4d04e6d271d743d8ba98b249f4d26a64b2c731e3e17849fe9e66957"

    public typealias C = RCCRuntimeContract
    /// Request class (raw value) -> certificate; certifiable classes only.
    public var classCertificates: [String: C.ClassCertificate]
    /// Request class (raw value) -> reference pool provider ("codex"/"claude").
    public var classProviderPins: [String: String]
    public static let empty = RCCClassTable(classCertificates: [:], classProviderPins: [:])

    public init(classCertificates: [String: C.ClassCertificate], classProviderPins: [String: String]) {
        self.classCertificates = classCertificates; self.classProviderPins = classProviderPins
    }

    public enum Failure: Error, Equatable { case unsigned, malformed }

    /// Strict decode of signed table bytes: the exact pinned hash, exact keys
    /// at every level, no duplicate keys, known classes and valid certificates.
    public static func decode(_ data: Data, pinnedSHA256: String = pinnedSHA256) throws -> RCCClassTable {
        guard C.digest(data) == pinnedSHA256 else { throw Failure.unsigned }
        guard let object = try? C.checkedObject(data), Set(object.keys) == ["schema", "class_certificates", "class_provider_pins"],
              object["schema"] as? Int == 1, let certificates = object["class_certificates"] as? [String: Any],
              let pins = object["class_provider_pins"] as? [String: String], certificates.count <= 8, pins.count <= 8 else {
            throw Failure.malformed
        }
        var decoded: [String: C.ClassCertificate] = [:]
        for (name, value) in certificates {
            guard let requestClass = C.RequestClass(rawValue: name), requestClass.certifiable,
                  let fields = value as? [String: Any],
                  Set(fields.keys) == ["certificate_id", "provider", "model", "effort", "format_check", "measurement_sha256"],
                  let bytes = try? JSONSerialization.data(withJSONObject: fields),
                  let certificate = try? JSONDecoder().decode(C.ClassCertificate.self, from: bytes),
                  C.validClassCertificate(certificate) else { throw Failure.malformed }
            decoded[name] = certificate
        }
        for (name, provider) in pins {
            guard let requestClass = C.RequestClass(rawValue: name), requestClass != .explicitRoute,
                  C.Exclusion.providers.contains(provider) else { throw Failure.malformed }
        }
        return RCCClassTable(classCertificates: decoded, classProviderPins: pins)
    }

    /// The compiled-in table. A pin mismatch is a build defect the fixture
    /// rejects; at runtime it fails closed to the empty table (reference).
    public static var frozen: RCCClassTable { (try? decode(frozenBytes)) ?? .empty }

    public func certificate(for requestClass: C.RequestClass) -> C.ClassCertificate? {
        requestClass.certifiable ? classCertificates[requestClass.rawValue] : nil
    }
    public func providerPin(for requestClass: C.RequestClass) -> String? {
        requestClass == .explicitRoute ? nil : classProviderPins[requestClass.rawValue]
    }
}
