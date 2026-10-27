import Foundation

/// Build 440 (owner order 2026-10-27, routing architecture v2 동결 기록):
/// the one class certificate whose basis is an OWNER DECISION, not a D4
/// measurement. The owner's standing rule (2026-10-14: trivial work on the
/// fast tier at low effort, REVAS escalates to the reference on a failure
/// signal) applied to `chat_explanatory` only: the chat-lane question that
/// is not a text operation. Quality-bearing classes (text_operation,
/// readonly_lookup, readonly_material, writer, explicit_route) keep the
/// reference and the D4 gate.
///
/// The decision is compiled in: `frozenBytes` hash to `pinnedSHA256`, the
/// signed class table names that hash as the certificate's
/// `measurement_sha256`, and `Resources/rcc-class-owner-decision.json` is the
/// reviewable copy (the regression fixture proves the bytes identical). It is
/// never read from disk or looked up, so no custody file can create, widen or
/// extend it. A certificate loads from it only when (`verified`):
///
/// - the compiled bytes still hash to the pin and the certificate names it;
/// - the decision decodes strictly (exact keys, this kind, schema 1);
/// - the request class is `chat_explanatory` (also fixed in code here), and
///   the certificate's id, tuple and format check equal the decision's;
/// - the certificate's pool has a current reference (the escalation target
///   the core fixes before dispatch); unlike a measurement, the decision does
///   not name WHICH reference model, so a new frontier never lapses it;
/// - the host attests a harness (a caller with none loads nothing).
///
/// Not checked, because there is nothing measured to bind (stated in the
/// frozen doc): the executor contract and the harness version a measurement
/// ran under, a validity window (the decision stands until the owner reverses
/// it in a later build) and a PASS result. Each answer is still checked by
/// the certificate's format check before adoption; a failure escalates once
/// to the reference. Anything else fails closed: the node binds the reference.
public enum RCCClassOwnerDecision {
    public typealias C = RCCRuntimeContract
    public static let kind = "os1_rcc_class_owner_decision_v1"
    /// The one class an owner decision may certify (locked 2026-10-27).
    public static let requestClass = C.RequestClass.chatExplanatory
    public static let frozenBytes = Data((#"{"certificate_id":"owner-chat-fast-20261027","decided_on":"2026-10-27","escalation":"reference_once_on_format_check_failure","format_check":"nonempty_text","kind":"os1_rcc_class_owner_decision_v1","owner_words":["무슨 아스트라를 또 또 아스트라를 쓰면 또 고쳐야 되잖아","왜 이게 안 고쳐지는데"],"request_class":"chat_explanatory","schema":1,"tuple":{"effort":"low","model":"gpt-6-luna","provider":"codex"}}"# + "\n").utf8)
    public static let pinnedSHA256 = "af958f76401c42133b8f90db2fcae11fd5eb62c5c4f51a27e9df54e780cce36f"

    private struct Tuple: Decodable, Equatable { let provider: String, model: String, effort: String }
    private struct Decision: Decodable {
        let schema: Int, kind: String, certificateID: String, decidedOn: String, requestClass: String, tuple: Tuple
        let formatCheck: String, escalation: String, ownerWords: [String]
        enum CodingKeys: String, CodingKey {
            case schema, kind, tuple, escalation
            case certificateID = "certificate_id", decidedOn = "decided_on", requestClass = "request_class"
            case formatCheck = "format_check", ownerWords = "owner_words"
        }
    }
    private static let decisionKeys: Set<String> = ["schema", "kind", "certificate_id", "decided_on", "request_class", "tuple",
                                                    "format_check", "escalation", "owner_words"]
    private static let tupleKeys: Set<String> = ["provider", "model", "effort"]

    /// The same strict pattern as `RCCClassMeasurement`: the duplicate-key and
    /// size gate with exact keys at every level, then a typed decode.
    private static func decode(_ data: Data) -> Decision? {
        guard let object = try? C.checkedObject(data), Set(object.keys) == decisionKeys,
              let tuple = object["tuple"] as? [String: Any], Set(tuple.keys) == tupleKeys,
              let value = try? JSONDecoder().decode(Decision.self, from: data),
              value.schema == 1, value.kind == kind, value.decidedOn == "2026-10-27",
              value.escalation == "reference_once_on_format_check_failure",
              !value.ownerWords.isEmpty, value.ownerWords.allSatisfy({ !$0.isEmpty }) else { return nil }
        return value
    }

    /// The certificate when the compiled decision admits it, else the first
    /// failing check (`RCCClassMeasurement.Rejection`). `bytes`/`pinned` are
    /// parameters only so the fixture can prove a tampered decision fails.
    public static func verified(_ certificate: C.ClassCertificate, requestClass: C.RequestClass, harnessProfile: String?,
                                reference: RCCClassMeasurement.Reference?, bytes: Data = frozenBytes,
                                pinned: String = pinnedSHA256) -> Result<C.ClassCertificate, RCCClassMeasurement.Rejection> {
        guard C.isHash(pinned), C.digest(bytes) == pinned, certificate.measurementSHA256 == pinned else {
            return .failure(.hashMismatch)
        }
        guard let value = decode(bytes) else { return .failure(.malformed) }
        guard requestClass == Self.requestClass, value.requestClass == requestClass.rawValue,
              value.certificateID == certificate.certificateID, value.formatCheck == certificate.formatCheck,
              value.tuple == Tuple(provider: certificate.provider, model: certificate.model,
                                   effort: certificate.effort.rawValue) else { return .failure(.scopeMismatch) }
        guard let reference, reference.provider == certificate.provider else { return .failure(.referenceMismatch) }
        guard let harnessProfile, !harnessProfile.isEmpty else { return .failure(.harnessMismatch) }
        return .success(certificate)
    }
}
