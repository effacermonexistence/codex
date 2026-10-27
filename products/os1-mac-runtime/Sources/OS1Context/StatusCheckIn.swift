import Foundation

/// A short "is it working / done / installed?" from the owner. On 2026-10-07
/// "되는지 확인해보자. 되냐?" ran 8 minutes on Claude Code at max effort: three
/// minutes rebuilding which change "it" meant from sessions, git and old Codex
/// logs, then four more compiling two builds to re-prove what the install state
/// already said ("installed 333, the fix is in 334, not installed"). The owner:
/// "그냥 대답해주면 되는 건데". A check-in now carries that state and asks for
/// the answer first; a deeper check is offered, not run.
public enum StatusCheckIn {
    /// The ways the owner asks after state.
    static let asking = #"되나|되냐|되니|됐나|됐냐|됐어|됐니|됐음|되는\s?거|되는지|됐는지|돼\s?\?|작동(?:해|하|되|돼|중)|돌아가(?:냐|나|\?|는지)|다\s?(?:했|한\s?거|됐|끝났)|했냐|끝났|설치\s?(?:됐|된|했|됨|돼)|깔렸|깔려\s?있|들어갔|반영\s?(?:됐|된)|적용\s?(?:됐|된)|연결\s?(?:돼|됐|된)|어떻게\s?(?:됐|된)|어디까지|진행\s?(?:상황|중)|하는\s?중|뭐\s?하고\s?있|몇\s?번\s?빌드|아직(?:도)?\s?(?:[0-9]{3}|안|하는)|살아\s?있|(?<![A-Za-z])(?:is it|did it|does it|does this|are you|is everything)\s+(?:done|work|working|installed|finished|alive|there)|(?<![A-Za-z])status(?![A-Za-z])"#
    /// A sentence that ends the way a question does, with or without "?"
    /// (voice dictation drops it): "됐냐", "설치 됨", "어떻게 된 거야".
    static let questionEnding = #"(?:냐|니|나|까|거야|건가|건지|이야|인가|는지|됐어|했어|됨|됐음|했음|임|중이야|거지|맞지|맞아)$"#
    /// "되는지 확인해보자": the owner's own way to open a check-in.
    static let checkOpener = #"^(?:(?:자|야|그럼|일단|한번|아니)\s*)*(?:(?:라우팅|이거|그거)\s*(?:이|가)?\s*)?(?:잘\s*)?(?:되는지|됐는지|작동하는지)\s*(?:한번\s*)?확인해\s?(?:보자|볼까)$"#
    /// Build 440 (owner, 2026-10-27): the owner inviting a look at THIS
    /// responder, "자 이제 네가 얼마나 잘 되는지 보자", by structure, not a
    /// sentence table: framing words, then either a second-person subject
    /// (optional 얼마나/잘; 하는지 only as 잘하는지) or, with no subject,
    /// exactly "얼마나 잘"; the state verb, optional 한번, then 보자/볼까/볼게/
    /// 확인해 보자. A bare "(그럼/일단) 되는지 보자" names no responder and is
    /// this owner's "try it and see" order, so it stays work, as does any
    /// thing as the subject ("빌드 잘 되는지 보자", "테스트가 통과하는지 볼까").
    static let testInvitation = #"^(?:(?:자|야|그럼|일단|이제|한번|아니)\s*)*(?:(?:네가|너가|니가|너|넌)\s*(?:얼마나\s*)?(?:잘\s*)?(?:되는\s?지|잘\s*하는\s?지|작동하는\s?지)|얼마나\s*잘\s*(?:되는\s?지|하는\s?지|작동하는\s?지))\s*(?:한번\s*)?(?:보자|볼까|볼게|볼께|확인해\s?보자|확인해\s?볼까)$"#
    /// The owner checking the response, not ordering the agent to inspect a
    /// workspace: "야 나 한번 체크해 볼게. 너 되냐?" (build 355). Strip only
    /// this opener so ASR without punctuation still leaves the actual state
    /// question to validate. "너 체크해봐" is deliberately not an opener.
    static let selfCheckOpener = #"^(?:(?:자|야|그럼|일단|아니|지금)\s*)*(?:(?:내가|나는|나|제가|우리|우리가)\s*)?(?:한\s?번\s*)?(?:체크|확인)\s?해\s?(?:보자|볼까|볼게|볼께|봅시다|보겠습니다|보죠)(?=\s|$)|^(?:(?:hey|ok|okay|well|so)[\s,]*)*(?:let\s+me\s+check|i(?:'ll|\s+will)\s+check|let'?s\s+check)(?:\s+(?:once|quickly))?(?=\s|$)"#
    /// Sentences that carry no order: "야", "그래서", "근데", "뭐야", "짧게 대답해줘".
    static let neutral = #"^(?:(?:야|아니|그래서|근데|뭐야|아|음|도대체|진짜|그럼|너|지금)\s*)+$|^(?:그냥\s*)?(?:예\s*아니오로\s*|짧게\s*)?(?:대답|답|말)해\s?줘$"#
    /// A command ending, the same test the chat lane uses for questions.
    static let command = #"(?:봐|줘|해|라|자|빼|가져와|와봐|깔아|돌려)(?=[\s.,~?]|$)"#
    /// A question-shaped request to run tools is still work, in either
    /// language. Unlike "is it installed?", "can you install it?" orders a
    /// new state; unlike a self-check opener, "check the logs" asks for reads.
    static let toolCommand = #"(?:터미널|셸|쉘|명령|로그|파일|스크립트)\s*(?:에서|로|을|를)|(?<![A-Za-z])(?:can|could|would|will)\s+you\s+(?:run|execute|build|compile|test|fix|repair|install|deploy|delete|remove|restart|reset|inspect|read|check)\b|(?<![A-Za-z])(?:run|execute|compile|restart|reset|inspect|read)\s|(?<![A-Za-z])check\s+(?:the\s+)?(?:shell|terminal|logs?|files?|scripts?)\b"#
    public static let maximumCharacters = 80

    /// "되는지 확인해보자. 되냐?", "다 한 거야?", "설치됐어?", "아직 333이야?",
    /// "야 너 지금 작동하냐?": short, asks after state, and every sentence is a
    /// question (or the owner's check opener). An order anywhere ("설치됐어? 안
    /// 됐으면 깔아", "되나? 안 되면 롤백해") or parts to route ("1+1 GPT한테.
    /// 2+2 Codex한테. 되나?") makes it a task: a deny list of work verbs let 23
    /// such orders through (second hunt of build 334).
    public static func matches(_ request: String) -> Bool {
        let text = request.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !text.isEmpty, text.count <= maximumCharacters, !text.contains("\n"), !text.contains("/"),
              !RouteFanout.containsName(text),
              // "사파리 쓰면 안 되냐?": may I, not is it done.
              text.range(of: #"면\s*안\s*(?:되|돼)"#, options: .regularExpression) == nil,
              text.range(of: RouteFanout.expression, options: [.regularExpression, .caseInsensitive]) == nil else { return false }
        if standaloneTestInvitation(text) { return true }
        guard text.range(of: asking, options: [.regularExpression, .caseInsensitive]) != nil else { return false }
        var sentences: [(text: String, asked: Bool)] = []
        var current = ""
        for character in text {
            if ".!?？。".contains(character) {
                if !current.trimmingCharacters(in: .whitespaces).isEmpty {
                    sentences.append((current.trimmingCharacters(in: .whitespaces), character == "?" || character == "？"))
                }
                current = ""
            } else {
                current.append(character)
            }
        }
        if !current.trimmingCharacters(in: .whitespaces).isEmpty { sentences.append((current.trimmingCharacters(in: .whitespaces), false)) }
        return !sentences.isEmpty && sentences.allSatisfy { sentence in
            let withoutOpener = sentence.text.replacingOccurrences(of: selfCheckOpener, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            if withoutOpener.isEmpty && withoutOpener != sentence.text { return true }
            let value = withoutOpener.replacingOccurrences(of: #"(?:\s+(?:도대체|진짜|지금|그래서|그럼))+$"#, with: "", options: .regularExpression)
            if value.range(of: checkOpener, options: .regularExpression) != nil
                || value.range(of: neutral, options: .regularExpression) != nil { return true }
            // "그럼 실제로 해봐 다 되는지": a command anywhere is work, whatever the ending.
            if value.range(of: command, options: .regularExpression) != nil
                || value.range(of: toolCommand, options: .regularExpression) != nil
                || ScopeResolution.resolve(value).scope == .workspaceWrite { return false }
            return sentence.asked || value.range(of: questionEnding, options: .regularExpression) != nil
                || value.range(of: #"^(?:is|are|was|did|does|has|have)\s"#, options: .regularExpression) != nil
        }
    }

    /// The build-440 test invitation counts only as the WHOLE request: after
    /// self-check openers and neutral sentences ("야.") there is exactly one
    /// part, and it is `testInvitation`. Any other sentence beside it, a
    /// question included ("최신 아이폰 가격 얼마니? 이제 너 얼마나 잘하는지
    /// 보자", "빌드 끝났어? 그럼 이제 잘 되는지 보자", "…보자. 빌드 다시
    /// 해볼래?"), leaves the request to the build-439 sentence check, where the
    /// invitation is a command ending (…자) and so work. Commas, tildes and a
    /// trailing ㅋ/ㅎ run are renderings of the same sentence, not words.
    static func standaloneTestInvitation(_ text: String) -> Bool {
        let parts = text.components(separatedBy: CharacterSet(charactersIn: ".!?？。"))
            .map { $0.replacingOccurrences(of: #"[,，~～]"#, with: " ", options: .regularExpression)
                .replacingOccurrences(of: #"\s*[ㅋㅎ]+$"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { $0.replacingOccurrences(of: selfCheckOpener, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.range(of: neutral, options: .regularExpression) == nil }
            .map { $0.replacingOccurrences(of: #"(?:\s+(?:도대체|진짜|지금|그래서|그럼))+$"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression) }
        return parts.count == 1 && parts[0].range(of: testInvitation, options: .regularExpression) != nil
    }

    /// A check-in about this responder or OS-1's own state and nothing else:
    /// the standalone test invitation, or a check-in whose every sentence left
    /// after openers and neutral framing asks after state ("설치됐어?", "다
    /// 끝났어? 너 되냐?"). `matches` also lets a plain question ride along
    /// ("최신 아이폰 가격 얼마니? 너 되냐?", "이 함수 왜 에러 나니? 너 잘 되냐",
    /// "되는지 확인해보자. 빌드 다시 해볼래?"): a rider asks about something
    /// else, so it is not state only.
    public static func stateOnly(_ request: String) -> Bool {
        guard answersFromCard(request) else { return false }
        let text = request.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if standaloneTestInvitation(text) { return true }
        for raw in text.components(separatedBy: CharacterSet(charactersIn: ".!?？。")) {
            let stripped: String = raw.trimmingCharacters(in: .whitespaces)
                .replacingOccurrences(of: selfCheckOpener, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            let value: String = stripped.replacingOccurrences(of: #"(?:\s+(?:도대체|진짜|지금|그래서|그럼))+$"#, with: "",
                                                              options: .regularExpression)
            if value.isEmpty || value.range(of: neutral, options: .regularExpression) != nil
                || value.range(of: checkOpener, options: .regularExpression) != nil { continue }
            if value.range(of: asking, options: [.regularExpression, .caseInsensitive]) == nil { return false }
        }
        return true
    }

    /// Things outside OS-1 that only a tool can check now.
    static let externalSubject = #"사이트|웹|배포|서버|r2|알투|깃허브|기타보|기탑|github|(?<![A-Za-z])pr(?![A-Za-z])|머지|merge|푸시|push|커밋|commit|백업|backup|연결|connect|도메인|domain|링크|url|railway|레일웨이|cloudflare|클라우드플레어|인스타|instagram|scv|결제|payment|데이터베이스|database|(?<![A-Za-z])db(?![A-Za-z])|deploy|site|server|터미널|셸|쉘|명령|로그|파일|스크립트|(?<![A-Za-z])(?:shell|terminal|command|logs?|files?|scripts?)(?![A-Za-z])"#

    /// A check-in the status card answers by itself: about OS-1 or the last
    /// change in this conversation, naming nothing outside it. It runs on the
    /// chat lane, the model without the coding agent's 900 KB of instructions
    /// and tools: with the card, the full lane still thought 165 s at max
    /// effort over an 87k-token prompt to say "334 is installed" (2026-10-07).
    /// A check-in about a site, a deployment or a connection keeps a lane
    /// that can look.
    public static func answersFromCard(_ request: String) -> Bool {
        matches(request) && request.lowercased().range(of: externalSubject, options: [.regularExpression, .caseInsensitive]) == nil
    }

    /// Narrower than a status card: the owner asks whether this responder is
    /// answering, not whether an installation, earlier task or external system
    /// is ready. Reuse the existing source/order/external and opener grammar;
    /// after its neutral framing there must be ONE self-directed liveness
    /// question. No exact-utterance greeting table and no inference from old
    /// conversation state authorizes a broader completion claim.
    public static func responsePathOnly(_ request: String) -> Bool {
        guard answersFromCard(request) else { return false }
        let framing = #"^(?:(?:야|아니|그래서|근데|뭐야|아|음|도대체|진짜|그럼|지금)\s*)+"#
        let responseQuestion = #"^(?:너(?:는)?|넌)\s*(?:(?:지금|잘)\s*)*(?:되(?:냐|나|니)|작동(?:해|하냐|하니|하나|되냐|되나)|돌아가(?:냐|나|니)|살아\s?있(?:냐|나|니))$|^are\s+you\s+(?:working|alive|there)$"#
        let text = request.precomposedStringWithCanonicalMapping.lowercased()
        let parts = text.components(separatedBy: CharacterSet(charactersIn: ".!?？。"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .map { $0.replacingOccurrences(of: selfCheckOpener, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.range(of: neutral, options: .regularExpression) == nil }
            .map { $0.replacingOccurrences(of: framing, with: "", options: .regularExpression) }
        return parts.count == 1 && parts[0].range(of: responseQuestion, options: .regularExpression) != nil
    }

    public struct Staged: Equatable, Sendable {
        public let intent: SelfUpdate.Intent
        /// Installed by the app itself when idle; otherwise only by an
        /// explicit `os1 self-update apply --root`.
        public let automatic: Bool
        public let subject: String?
        public init(intent: SelfUpdate.Intent, automatic: Bool, subject: String?) {
            self.intent = intent; self.automatic = automatic; self.subject = subject
        }
    }

    /// Every staged build newer than the installed one and still fresh, from
    /// every checkout's release cache (registered or not), newest first.
    public static func stagedIntents(installedBuild: Int, home: URL = FileManager.default.homeDirectoryForCurrentUser,
                                     now: Date = Date()) -> [SelfUpdate.Intent] {
        let releases = home.appendingPathComponent("Library/Caches/OS-1/releases", isDirectory: true)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let names = (try? FileManager.default.contentsOfDirectory(atPath: releases.path)) ?? []
        return names.compactMap { name -> SelfUpdate.Intent? in
            let url = releases.appendingPathComponent(name).appendingPathComponent("self-update-intent.json")
            guard let data = try? Data(contentsOf: url), data.count <= 32_768,
                  let intent = try? decoder.decode(SelfUpdate.Intent.self, from: data), intent.schema == 1,
                  intent.build > installedBuild, now.timeIntervalSince(intent.stagedAt) <= SelfUpdate.intentMaxAge else { return nil }
            return intent
        }.sorted { ($0.build, $0.stagedAt) > ($1.build, $1.stagedAt) }
    }

    /// The state a check-in is answered from, and how to answer it.
    public static func card(installedVersion: String, installedBuild: Int, installedSubject: String?,
                            staged: [Staged], outcomes: [SelfUpdate.Outcome], hold: SelfUpdate.Hold?,
                            now: Date = Date()) -> String {
        let clock = ISO8601DateFormatter()
        func short(_ commit: String?) -> String { commit.map { String($0.prefix(7)) } ?? "unknown" }
        func quoted(_ subject: String?) -> String { subject.map { " \"\(String($0.prefix(120)))\"" } ?? "" }
        var lines = [
            "--- OS-1 STATUS CHECK-IN ---",
            "The owner asked a short check-in about state (working? done? installed?), not for new work. If the message also asks for something to be done, do that; this card covers only the state question.",
            "Answer it first, in two or three sentences. If it is about OS-1 or the latest change in this conversation, answer from the OS-1 state below and the conversation's latest turns (one memory lookup at most). If it is about something else (a site, a deployment, a file), one or two direct reads of that thing's current state are fine.",
            "Do not build, compile, run tests or self-tests, replay a request, or mine old logs and transcripts to re-prove it; a check-in wants the current state now.",
            "If only a deeper check could settle it, say so in one line and offer it; do not run it. Never call a staged build installed.",
            "Installed now: \(installedVersion) (build \(installedBuild))\(quoted(installedSubject)).",
        ]
        if staged.isEmpty {
            lines.append("Staged, not installed: none newer than build \(installedBuild).")
        }
        for item in staged.prefix(4) {
            let intent = item.intent
            let install = item.automatic ? "OS-1 installs it by itself when no task is running"
                : "not a registered OS-1 source: it installs only by an explicit `os1 self-update apply --root \(intent.sourceRoot)`"
            let failure = intent.lastError.map { " Last error: \(String($0.suffix(200)))." } ?? ""
            lines.append("Staged, not installed: build \(intent.build) (\(intent.version)) from \(intent.sourceRoot) commit \(short(intent.sourceCommit))\(quoted(item.subject)), staged \(clock.string(from: intent.stagedAt)), state \(intent.state), \(intent.applyAttempts) install attempt(s); \(install).\(failure)")
        }
        if let hold { lines.append("New work is held for build \(hold.build) until \(clock.string(from: hold.expiresAt)).") }
        for outcome in outcomes.suffix(3).reversed() {
            let result = outcome.success ? "installed" : "failed: " + String((outcome.error ?? "unknown").suffix(160))
            lines.append("Install receipt \(clock.string(from: outcome.completedAt)): build \(outcome.intent.build) commit \(short(outcome.intent.sourceCommit)) \(result).")
        }
        lines.append("--- END OS-1 STATUS CHECK-IN ---")
        return lines.joined(separator: "\n")
    }

    public static func selfTest() throws {
        var failed: [String] = []
        func check(_ value: Bool, _ name: String) { if !value { failed.append(name) } }
        for text in ["되는지 확인해보자. 되냐?", "되는지 확인해보자. 되나?", "뭐 하고 있는 거야 다 한 거야 뭐야 어떻게 된 거야 도대체.",
                     "야 너 지금 작동하냐?", "설치됐어?", "아직 333이야?", "다 끝났어?", "is it working?", "did it work",
                     "야 나 한번 체크해 볼게. 너 되냐?", "야 체크해 봅시다. 너 되냐?",
                     "우리 확인해보죠 너 되니", "확인해 보겠습니다. 너 되냐?", "너 잘 되냐", "한번 체크해보자 되냐",
                     "야 나 한번 체크해볼게 너 되냐", "야 내가 한 번 확인해볼께 너 잘 되냐",
                     "Hey, let me check. Are you working?", "let me check are you working", "let's check. does this work?"] {
            check(matches(text), "check-in: \(text)")
        }
        for text in ["그래서 설치 됨 안 됨", "야 너 R2 연결 돼있냐?", "아직도 333이야?", "지금 몇 번 빌드 깔려 있어?", "아까 시켜둔 거 끝났냐?",
                     "그래서 334 설치됐어 안 됐어? 그냥 예 아니오로 대답해줘"] {
            check(matches(text), "check-in: \(text)")
        }
        // Second hunt of build 334: orders beside a state question.
        for text in ["설치됐어? 안 됐으면 깔아", "되나? 안 되면 롤백해", "어디까지 했어? 이어서 해", "진행 중인 작업 계속 해",
                     "작동하는지 시간 재봐", "되는지 빌드하고 테스트 돌려", "라우팅 되는지 다시 테스트해봐", "아직 333이면 apply 해",
                     "is it installed? if not, build it", "did it work? test it again", "1+1 GPT한테. 2+2 Codex한테. 되나?",
                     "QMGR 통합해야 되니까 스키마 좀 짜봐", "PR 머지됐어? 안 됐으면 머지해", "되는지 테스트해봐", "진행 중인 거 취소해",
                     "그럼 실제로 해봐 다 되는지", "그거 설명 좀 해봐 어디까지 진행됐는지", "야 크롬 말고 사파리 쓰면 안 되냐?",
                     "야 너 한번 체크해봐. 되냐?", "한번 체크해보자 되냐? 안 되면 고쳐",
                     "야 나 한번 체크해 볼게. 터미널에서 실제로 확인해줘. 너 되냐?",
                     "너 잘 되냐? 셸로 상태를 확인해", "너 되냐? 터미널에서 ps aux로 확인할 수 있어?",
                     "Are you working? Can you run a shell check?", "let me check. are you working? inspect the logs"] {
            check(!matches(text), "an order is not a check-in: \(text)")
        }
        for text in ["이거 고쳐", "되는지 확인하고 안 되면 고쳐", "라우팅 되게 해줘", "클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2. 되나?",
                     "OS-1 설치해", "그럼 클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐. 1 plus 1, 2 plus 2, 3 plus 3, 4 plus 4.",
                     "RCC가 뭐야?", "~/Library 정리해", String(repeating: "되나? ", count: 30)] {
            check(!matches(text), "not a check-in: \(text.prefix(40))")
        }
        for text in ["되는지 확인해보자. 되냐?", "다 한 거야?", "설치됐어?", "아직 333이야?", "야 너 지금 작동하냐?",
                     "야 나 한번 체크해 볼게. 너 되냐?", "너 잘 되냐", "한번 체크해보자 되냐",
                     "Hey, let me check. Are you working?", "let me check are you working"] {
            check(answersFromCard(text), "the card answers: \(text)")
        }
        // Build 440 (owner, 2026-10-27): inviting a look at this responder is a
        // check-in by structure, only as the whole request; a thing as the
        // subject, no responder, or any other sentence beside it is work.
        for text in ["자 이제 네가 얼마나 잘 되는지 보자", "이제 너 얼마나 잘하는지 보자", "얼마나 잘 되는지 한번 보자",
                     "야 니가 얼마나 잘 작동하는지 볼까", "넌 얼마나 잘 되는지 확인해 보자", "자 이제 네가 얼마나 잘 되는지 보자.",
                     "자, 이제 네가 얼마나 잘 되는지 보자", "자 이제, 네가 얼마나 잘 되는지 보자", "자 이제 네가 얼마나 잘 되는지 보자~",
                     "자 이제 너 얼마나 잘하는지 보자 ㅋㅋ", "자 이제 네가 얼마나 잘 되는 지 보자", "야. 자 이제 네가 얼마나 잘 되는지 보자",
                     "야 나 한번 체크해 볼게. 너 얼마나 잘하는지 보자", "이제 너 얼마나 잘하는지 볼까?"] {
            check(matches(text) && answersFromCard(text), "a test invitation is a check-in: \(text)")
        }
        for text in ["빌드 잘 되는지 보자", "테스트 돌려서 되는지 보자", "이 코드 잘 되는지 보자", "사이트 잘 되는지 보자",
                     "되는지 보고 안 되면 고쳐", "그럼 실제로 해봐 다 되는지", "라우팅 되는지 보자", "그 사람이 영어를 잘하는지 보자",
                     "자 이제 네가 얼마나 잘 되는지 보자. 안 되면 고쳐", "네가 얼마나 잘 되는지 보자 터미널에서 확인해줘",
                     // No responder named: "try it and see" (review of build 440).
                     "되는지 보자", "일단 되는지 보자", "그럼 되는지 보자.", "이제 되는지 확인해 보자", "그럼 작동하는지 보자",
                     "일단 잘 되는지 한번 볼게", "자 이제 잘 작동하는지 볼까", "그럼 얼마나 되는지 보자", "이제 니가 하는지 보자",
                     // A thing as the subject in the 볼까 form.
                     "테스트가 통과하는지 볼까", "이 함수가 제대로 동작하는지 볼까", "그 사람이 영어를 잘하는지 볼까",
                     "새 버전이 제대로 동작하는지 한번 볼까",
                     // Another sentence beside the invitation, a question included.
                     "최신 아이폰 가격 얼마니? 이제 너 얼마나 잘하는지 보자", "그 버그 원인이 뭐니? 잘하는지 보자",
                     "오늘 원달러 환율 얼마니? 자 이제 네가 얼마나 잘 되는지 보자", "지금 비트코인 시세 얼마니? 하는지 보자",
                     "고쳤어? 이제 잘 되는지 보자", "빌드 끝났어? 그럼 이제 잘 되는지 보자",
                     "테스트 다 통과했냐? 이제 얼마나 잘 되는지 보자", "패치 적용됐어? 그럼 되는지 보자",
                     "쿼터 얼마나 남았어? 그럼 얼마나 되는지 보자", "각각 라우팅을 시켜오라니까? 되는지 보자.",
                     "자 이제 네가 얼마나 잘 되는지 보자. 빌드 다시 해볼래?", "이제 네가 얼마나 잘 되는지 보자. 앱 다시 깔아줄래?",
                     "이제 너 얼마나 잘하는지 보자. 스키마 하나 짜볼래?", "일 시작해볼까? 이제 네가 얼마나 잘하는지 보자"] {
            check(!matches(text), "a thing, no responder, or another sentence beside the invitation is work: \(text)")
        }
        for text in ["배포 됐냐?", "사이트 살아있어?", "야 너 R2 연결 돼있냐?", "푸시 됐어?", "PR 머지됐어?", "설치됐어? 안 됐으면 깔아",
                     "야 나 한번 체크해 볼게. 서버 되냐?", "너 되냐? Can you check the shell?", "로그에는 작동 중이야?"] {
            check(!answersFromCard(text), "needs a look: \(text)")
        }
        // Build 440 lead narrowing: the owner-decision fast tier covers only a
        // check-in that is about state and nothing else.
        for text in ["자 이제 네가 얼마나 잘 되는지 보자", "자, 이제 네가 얼마나 잘 되는지 보자", "너 되냐?", "야 너 지금 작동하냐?",
                     "설치됐어?", "다 끝났어?", "아직 333이야?", "다 끝났어? 너 되냐?", "되는지 확인해보자. 되냐?",
                     "야 나 한번 체크해 볼게. 너 되냐?", "is it working?", "Hey, let me check. Are you working?"] {
            check(stateOnly(text), "a state-only check-in: \(text)")
        }
        for text in ["최신 아이폰 가격 얼마니? 너 되냐?", "오늘 원달러 환율 얼마니? 너 되냐?", "이 함수 왜 에러 나니? 너 잘 되냐",
                     "RCC 라우팅에서 쿼터 계산은 어떤 식으로 하니? 너 되냐?", "되는지 확인해보자. 빌드 다시 해볼래?",
                     "Swift에서 actor reentrancy가 왜 생겨?", "그게 왜 그래?", "co가 무슨 뜻이야?", "배포 됐냐?"] {
            check(!stateOnly(text), "a rider question or a non-check-in is not state only: \(text)")
        }
        let stagedAt = Date(timeIntervalSince1970: 1_791_000_000)
        let intent = SelfUpdate.Intent(build: 334, version: "0.9.268", sourceRoot: "/tmp/os1-side", sourceCommit: "d5799590681d96e5e",
                                       stagedAppSHA256: "a", stagedCLISHA256: "b", stagedAt: stagedAt, conversationID: nil,
                                       submissionID: nil, checks: [])
        let card = card(installedVersion: "OS-1 Runtime 0.9.267", installedBuild: 333, installedSubject: "build 333",
                        staged: [Staged(intent: intent, automatic: false, subject: "build 334 — fan-out")], outcomes: [], hold: nil,
                        now: stagedAt)
        check(card.contains("build 333") && card.contains("build 334 (0.9.268)") && card.contains("d579959"), "card names installed and staged builds")
        check(card.contains("explicit `os1 self-update apply --root /tmp/os1-side`"), "a side checkout's build is not promised to self-install")
        check(card.contains("Do not build, compile"), "card asks for the answer, not a re-proof")
        let home = FileManager.default.temporaryDirectory.appendingPathComponent("os1-checkin-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: home) }
        let cache = home.appendingPathComponent("Library/Caches/OS-1/releases/abc", isDirectory: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(intent).write(to: cache.appendingPathComponent("self-update-intent.json"))
        check(stagedIntents(installedBuild: 333, home: home, now: stagedAt.addingTimeInterval(60)).map(\.build) == [334], "a fresh newer staged build is found")
        check(stagedIntents(installedBuild: 334, home: home, now: stagedAt.addingTimeInterval(60)).isEmpty, "an installed build is not staged")
        check(stagedIntents(installedBuild: 333, home: home, now: stagedAt.addingTimeInterval(SelfUpdate.intentMaxAge + 60)).isEmpty, "a stale intent is not staged")
        guard failed.isEmpty else { throw StatusCheckInError.selfTest(failed) }
    }
}

public enum StatusCheckInError: Error, CustomStringConvertible {
    case selfTest([String])
    public var description: String {
        switch self {
        case .selfTest(let failed): return "Status check-in self-test failed: " + failed.joined(separator: "; ")
        }
    }
}
