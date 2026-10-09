import CryptoKit
import Foundation

/// A deterministic, zero-provider response to a question about this request's
/// own response path. This is not a ChatGPT transport or a backend health test.
/// Whole-request grammar is intentional: a liveness question beside an order,
/// attachment, named provider or completion question must remain normal work.
public enum ResponseAvailability {
    public static let maximumCharacters = 160

    // Only discourse openers, not arbitrary words or a keyword deny list. The
    // self/joint forms describe the owner's check, not an order to inspect logs.
    private static let filler = #"(?:(?:야|자|아|어|음|그래|그럼|일단|잠깐|지금|이제|근데|아니)[\s,，.!?？。]*)*"#
    private static let ownerCheck = #"(?:(?:내가|나는|나|제가|저|우리가|우리)\s*)?(?:한\s*번\s*)?(?:체크|확인)\s*해\s*(?:볼게|볼께|볼까|보자|봅시다|보겠습니다|보겠어|보죠)"#
    private static let separator = #"[\s,，.!?？。]*"#
    private static let selfSubject = #"(?:너(?:는|가)?|니(?:는|가)?|당신(?:은|이)?|os\s*[-‐‑–]?\s*1(?:은|이)?|오스원(?:은|이)?)"#
    private static let responseSubject = #"(?:(?:너(?:는|가)?|니(?:는|가)?)\s*)?(?:여기\s*)?(?:응답|답변)(?:은|는|이|가)?"#
    private static let presentLiveness = #"(?:되냐|되나|되니|돼|살아\s*있(?:냐|니|어)|응답\s*(?:하냐|하니|해|되냐|되니|돼))"#
    private static let responseLiveness = #"(?:되냐|되나|되니|돼|오냐|오니|하냐|하니|해)"#
    private static let now = #"(?:(?:지금|이제|잘|아직|여기서)\s*)*"#
    private static let questionEnd = #"[\s.!?？。]*"#

    /// True only when generating this local reply itself answers the question.
    /// `hasAttachments` is authoritative ingress metadata, not inferred from
    /// text. A provider-targeted check must actually visit that provider.
    public static func matches(_ request: String, hasAttachments: Bool = false) -> Bool {
        guard !hasAttachments else { return false }
        let value = request.precomposedStringWithCanonicalMapping
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !value.isEmpty, value.count <= maximumCharacters else { return false }

        let namedQuestion = "(?:\(selfSubject)\\s*\(now)\(presentLiveness)|\(responseSubject)\\s*\(now)\(responseLiveness))"
        let koreanDirect = "^\(filler)\(namedQuestion)\(questionEnd)$"
        // With an owner check opener, the omitted subject inherits this check,
        // not an earlier installation/completion claim. Without that opener a
        // bare '되냐' remains ambiguous and is deliberately not consumed here.
        let koreanCheck = "^\(filler)\(ownerCheck)\(separator)\(filler)(?:\(namedQuestion)|\(presentLiveness))\(questionEnd)$"
        let englishFiller = #"(?:(?:hey|hi|ok|okay|well|so)[\s,!.?]*)*"#
        let englishQuestion = #"(?:are\s+you\s+(?:(?:still|currently)\s+)?(?:there|alive|responding|working)|can\s+you\s+(?:respond|reply)|do\s+you\s+(?:receive|see)\s+(?:this|my)\s+(?:message|request))"#
        let englishCheck = #"(?:(?:let\s+me\s+check|i(?:'ll|\s+will)\s+check|let'?s\s+check)(?:\s+(?:once|quickly))?[\s,!.?]*)?"#
        let english = "^\(englishFiller)\(englishCheck)\(englishQuestion)\(questionEnd)$"
        return [koreanDirect, koreanCheck, english].contains { pattern in
            value.range(of: pattern, options: .regularExpression) != nil
        }
    }

    public struct Receipt: Codable, Equatable, Sendable {
        public let schema: Int
        public let id: String
        public let requestID: UUID
        public let requestSHA256: String
        public let responseSHA256: String
        public let observedAt: Date
        public let provider: String
        public let executor: String
        public let modelInvoked: Bool
        public let quotaPool: String
        public let observation: String

        fileprivate init(requestID: UUID, request: String, response: String, observedAt: Date) {
            schema = 1
            id = "os1-response-availability-" + requestID.uuidString.lowercased()
            self.requestID = requestID
            requestSHA256 = ResponseAvailability.digest(request)
            responseSHA256 = ResponseAvailability.digest(response)
            self.observedAt = observedAt
            provider = "local"
            executor = "os1.response-availability.v1"
            modelInvoked = false
            quotaPool = "none"
            observation = "request_received_local_response_generated"
        }

        /// Bind this observation to the exact raw ingress and result. Delivery,
        /// backend availability and task completeness require other receipts.
        public func verifies(requestID: UUID, request: String, response: String) -> Bool {
            ResponseAvailability.matches(request) && schema == 1 && self.requestID == requestID
                && id == "os1-response-availability-" + requestID.uuidString.lowercased()
                && requestSHA256 == ResponseAvailability.digest(request)
                && responseSHA256 == ResponseAvailability.digest(response)
                && provider == "local" && executor == "os1.response-availability.v1"
                && !modelInvoked && quotaPool == "none"
                && observation == "request_received_local_response_generated"
        }
    }

    public struct Response: Codable, Equatable, Sendable {
        public let text: String
        public let receipt: Receipt
    }

    /// Call only from an actual received request, before provider discovery or
    /// dispatch. Returning nil leaves the existing route untouched. No file,
    /// subprocess, network, model, account or native-session API is used here.
    public static func execute(_ request: String, hasAttachments: Bool = false,
                               requestID: UUID, now: Date = Date()) -> Response? {
        guard matches(request, hasAttachments: hasAttachments) else { return nil }
        let korean = request.range(of: #"[가-힣]"#, options: .regularExpression) != nil
        let text = korean
            ? "응, OS-1이 네 메시지를 받아 지금 응답하고 있어. 이건 로컬 응답 확인이고, 모델이나 코딩 에이전트는 호출하지 않았어."
            : "Yes, OS-1 received your message and is responding locally. No model or coding agent was invoked for this response check."
        return Response(text: text, receipt: Receipt(requestID: requestID, request: request,
                                                     response: text, observedAt: now))
    }

    private static func digest(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    /// Deterministic fixtures: no paid inference or live backend is involved.
    public static func selfTest() throws {
        var failures: [String] = []
        func check(_ value: Bool, _ label: String) { if !value { failures.append(label) } }
        for request in [
            "야 체크해 봅시다. 너 되냐?", "야 체크해봅시다 너 되냐", "야체크해봅시다너되냐",
            "야 내가 한번 체크해 볼게. 너 되냐?", "한번 확인해보자 되냐", "너 되냐?",
            "야 너 지금 잘 되냐", "지금 너 살아있어?", "응답 되냐?", "여기 답변 오니",
            "자 확인해 보겠습니다. 너 응답하니?", "우리 체크해보죠 너 되니"
        ] { check(matches(request), "positive: " + request) }
        for request in ["Are you responding?", "Hey, let me check. Are you working?", "let's check are you still there",
                        "Can you reply?", "Do you receive my message?"] {
            check(matches(request), "English positive: " + request)
        }
        for request in [
            "되냐?", "됐냐?", "다 했냐?", "다 한 거야?", "설치됐어?", "OS-1 설치 됐냐?",
            "아까 시켜둔 거 끝났냐?", "어디까지 진행 중이냐?", "야 너 지금 작동하냐?",
            "전체 시스템 잘 되냐?", "OS-1 시스템 정상인지 확인해줘", "서버 응답 되냐?",
            "야 너 한번 체크해봐. 되냐?", "야 체크해 봅시다. 너 되냐? 안 되면 고쳐",
            "야 내가 체크해 볼게. 너 되냐? 로그 봐", "너 되냐? 파일 읽어", "응답 되냐? 셸 실행해",
            "ChatGPT 너 되냐?", "GPT한테 너 되냐 물어봐", "Claude 응답 되냐?", "클로드 너 되냐?",
            "Codex 너 되냐?", "Claude Code 너 되냐?", "OS-1 너 되냐?", "너 R2 연결 되냐?",
            "GPT, Codex, Claude, Claude Code 1+1, 2+2, 3+3, 4+4 각각 돌려", "너 되냐? 1+1",
            "너 되냐? /tmp/test.txt", "너 되냐? [attachment]", "Are you working? Inspect the logs",
            "Can you run a response test?", "Is it installed?", "Is everything working?", "Does this work?",
            "Are you responding? Is the server alive?", "Do you receive my message? send it to GPT",
            String(repeating: "야 ", count: 100) + "너 되냐?"
        ] { check(!matches(request), "negative: " + request) }
        check(!matches("너 되냐?", hasAttachments: true), "attachment metadata blocks the fast path")
        let id = UUID(uuidString: "7268692B-89A0-4A81-9D1D-82266AD4F726")!
        let now = Date(timeIntervalSince1970: 1_791_000_000)
        let request = "야 체크해 봅시다. 너 되냐?"
        guard let result = execute(request, requestID: id, now: now) else {
            throw ResponseAvailabilityError.selfTest(failures + ["executor returned nil"])
        }
        check(result.receipt.verifies(requestID: id, request: request, response: result.text), "receipt exact binding")
        check(!result.receipt.verifies(requestID: UUID(), request: request, response: result.text), "wrong request ID rejected")
        check(!result.receipt.verifies(requestID: id, request: request + " ", response: result.text), "raw input change rejected")
        check(!result.receipt.verifies(requestID: id, request: request, response: result.text + " "), "output change rejected")
        check(result.receipt.observedAt == now && !result.receipt.modelInvoked && result.receipt.quotaPool == "none",
              "actual observation time and no provider invocation")
        let encoded = try JSONEncoder().encode(result)
        let roundTrip = try JSONDecoder().decode(Response.self, from: encoded)
        check(roundTrip == result, "receipt Codable round trip")
        check(!String(decoding: encoded, as: UTF8.self).contains("nativeSessionID"), "no fabricated native backend identity")
        check(execute("너 되냐?", hasAttachments: true, requestID: id) == nil, "attachments not consumed")
        check(execute("다 했냐?", requestID: id) == nil, "completion question not consumed")
        guard failures.isEmpty else { throw ResponseAvailabilityError.selfTest(failures) }
    }
}

public enum ResponseAvailabilityError: Error, CustomStringConvertible {
    case selfTest([String])
    public var description: String {
        switch self {
        case .selfTest(let failures): return "Response availability self-test failed: " + failures.joined(separator: "; ")
        }
    }
}
