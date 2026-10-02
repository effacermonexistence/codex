import Foundation

/// Claude Code and Claude chat are the same app, the same sign-in and the same
/// Anthropic plan; only Claude Code has a programmatic interface, so OS-1 runs
/// every Claude turn through it. What the chat side really is, for a request
/// that needs nothing from this machine, is the same model without the coding
/// agent's baggage: no CLAUDE.md, no skills or MCP servers, no tools, and a
/// workspace it never reads.
///
/// Measured here 2026-09-25, same question, same account, sonnet/medium: a
/// repo-workspace turn spent 359,147 cache-creation tokens (35,937 weighted) in
/// 5.4 s, because ~/.claude/CLAUDE.md is 910 KB; the same call with
/// customizations off spent 641 weighted in 1.2 s. Same answer, same
/// subscription, no API key.
///
/// What may take that lane is deliberately narrow. The owner's requests are
/// mostly work on this machine, and they are often phrased without naming it
/// ("그럼 실제로 해봐", "했냐고"): a request answered by a model with no tools
/// when it actually wanted work done is worse than a request that pays for the
/// full lane. So only a text operation carrying its own payload qualifies —
/// translate, summarize, proofread, rephrase this text — where the whole object
/// of the task arrives inside the request. Everything else keeps the full lane
/// until there is evidence for widening it.
public enum ClaudeChatLane {
    /// Words that put this machine, its files or its history in scope.
    static let workspaceTerms = [
        "저장소", "레포", "리포지", "코드", "파일", "폴더", "디렉터리", "디렉토리", "소스", "로그",
        "커밋", "브랜치", "빌드", "테스트", "스크립트", "설정", "환경변수", "터미널", "명령",
        "프로젝트", "앱", "화면", "버전", "패치", "실행", "설치", "배포", "여기", "이거", "그거",
        "아까", "방금", "확인해", "돌려", "돌아가",
        "repo", "repository", "codebase", "file", "folder", "directory", "source", "log",
        "commit", "branch", "diff", "build", "script", "config", "settings", "terminal",
        "command", "project", "workspace", "session", "account", "quota", "usage", "install",
        "deploy", "run it", "check it",
    ]

    /// OS-1 itself, a backend, or a registered project.
    static let projectTerms = ["os1", "os-1", "clodex", "클로덱스", "코덱스", "codex", "클로드", "claude",
                               "rcc", "instagram", "인스타", "scv", "fleet", "플릿"]

    /// Wording that asks for work, not for an answer. These carry no file name,
    /// which is exactly why the lane cannot be decided by material alone.
    static let actionTerms = ["해봐", "해 봐", "해라", "해줘", "해 줘", "하라", "했냐", "했어", "했지",
                              "됐냐", "됐어", "진행", "계속", "마저", "시작", "고쳐", "고치", "만들어",
                              "수정", "바꿔", "지워", "삭제", "저장", "기록"]

    /// True when the text names something on this machine: a project, its
    /// files or history, a path, a URL or a filename.
    public static func namesMachineMaterial(_ prompt: String) -> Bool {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        if projectTerms.contains(where: value.contains) { return true }
        if workspaceTerms.contains(where: value.contains) { return true }
        return value.range(of: #"(?:^|\s)(?:~|\.{1,2})?/[^\s]|\bhttps?://|[A-Za-z0-9_-]+\.[A-Za-z]{1,6}\b"#,
                           options: .regularExpression) != nil
    }

    /// True when the request asks for work rather than an answer. A text
    /// operation's own instruction ends this way too ("번역해줘"), so this is
    /// asked about the whole request, never about the instruction alone.
    public static func asksForWork(_ prompt: String) -> Bool {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        return actionTerms.contains(where: value.contains)
    }

    /// True when the request needs the full Claude Code lane.
    public static func needsWorkspaceMaterial(_ prompt: String) -> Bool {
        namesMachineMaterial(prompt) || asksForWork(prompt)
    }

    /// The request is a text operation whose whole object arrives with it, so
    /// the model needs nothing else to answer. Uses the same instruction/payload
    /// split as routing (build 255), and still refuses anything naming this
    /// machine — "README.md를 번역해서 저장해" is a file task, not a chat one.
    public static func selfContainedTextOperation(_ prompt: String) -> Bool {
        // Only the instruction is judged: the payload is data, so "파일을
        // 삭제하고 배포해" is a sentence to translate, not a file task. A
        // request that does name a file ("README.md를 번역해서 저장해") has no
        // separable instruction in the first place and is refused above.
        guard let instruction = OwnerIntentText.textOperationInstruction(prompt),
              !namesMachineMaterial(instruction) else { return false }
        // The payload is what is left once the instruction is removed; without
        // one there is nothing to operate on and the request means something else.
        let payload = prompt.precomposedStringWithCanonicalMapping
            .replacingOccurrences(of: instruction, with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return payload.count >= 4
    }

    /// Words that make a question depend on the outside world as it is now,
    /// which only a tool can check: prices, dates, availability, news,
    /// releases, anything addressed by a name or a link.
    static let lookupTerms = [
        "조회", "검색", "찾아", "알아봐", "확인", "최신", "최근", "요즘", "오늘", "어제", "내일", "올해", "작년", "이번",
        "지금", "현재", "뉴스", "가격", "얼마", "비싸", "시세", "날씨", "환율", "주가", "구매", "구입", "판매", "등록",
        "출시", "발표", "버전", "업데이트", "사이트", "링크", "주소", "도메인", "닷컴",
        "search", "look up", "lookup", "latest", "recent", "today", "current", "now", "price", "cost", "news",
        "weather", "buy", "purchase", "available", "registered", "release", "version", "update", "link", "website",
        "url", "domain",
    ]
    /// Code, systems and OS-1's own behaviour: questions about them belong to
    /// the agent that can read the code and the logs.
    static let technicalTerms = [
        "함수", "변수", "클래스", "메서드", "에러", "오류", "버그", "서버", "데이터베이스", "라우팅", "쿼터", "토큰", "모델",
        "api", "sdk", "error", "bug", "server", "database", "function", "class", "method", "routing", "quota", "token",
        "model",
    ]
    /// The question is asked in words: a question mark or an interrogative.
    static let interrogatives = [
        "뭐", "무엇", "무슨", "뜻", "의미", "왜", "어떻게", "어때", "어떤", "언제", "누구", "누가", "어디", "어느", "차이",
        "what", "why", "how", "who", "when", "where", "which", "meaning", "mean", "difference",
    ]

    /// A short question the model answers from the conversation and its own
    /// knowledge: what a word means, why, which is better. Owner, 2026-10-02:
    /// "co가 무슨 뜻이야?" ran on the full Codex agent; "이렇게 간단한 채팅이면
    /// 쿼터 안 쓰는 걸로 라우팅해야 정상 아님?". Such a question takes the chat
    /// lane — the same model without the agent's tools and instructions, a
    /// small fraction of the tokens. Anything that may need the machine, the
    /// web or current facts (a name with a dot, a number, a price, a date, a
    /// release, code, OS-1 itself) keeps the agent: missing a lookup costs
    /// correctness, a full lane only costs tokens.
    public static func conversationalQuestion(_ prompt: String) -> Bool {
        let value = prompt.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 200, !value.contains("\n"),
              !needsWorkspaceMaterial(value),
              !value.unicodeScalars.contains(where: { CharacterSet.decimalDigits.contains($0) }),
              // A dotted name right before a Korean particle ("README.md는",
              // "usung.com은") escapes the word-boundary pattern above.
              value.range(of: #"[A-Za-z0-9_\-]\.[A-Za-z]{1,6}(?![A-Za-z])"#, options: .regularExpression) == nil
        else { return false }
        let lower = value.lowercased()
        func mentions(_ terms: [String]) -> Bool {
            terms.contains { term in
                term.unicodeScalars.allSatisfy(\.isASCII)
                    ? lower.range(of: "\\b\(NSRegularExpression.escapedPattern(for: term))\\b", options: .regularExpression) != nil
                    : lower.contains(term)
            }
        }
        guard !mentions(lookupTerms), !mentions(technicalTerms), !mentions(workVerbs), !mentions(statusQuestions) else { return false }
        // A question, not an order that happens to contain "왜" or "where":
        // asked with "?", no "!", and no command ending (…봐, …줘, …해, …라, …자,
        // "빼", "가져와" — "생각해?" asked with "?" is still a question). Replayed over the owner's 369 messages (2026-10-02),
        // the looser test also took "Continue from where you left off." and
        // "…다 빼! …왜 넣어!".
        guard lower.contains("?"), !lower.contains("!"),
              lower.range(of: #"(?:봐|줘|해|라|자|빼|가져와|와봐)(?=[\s.,~]|$)"#, options: .regularExpression) == nil
        else { return false }
        return mentions(interrogatives) || lower.range(of: #"(?:니|나|까|냐|가|지|야|어|요)\?"#, options: .regularExpression) != nil
    }
    /// English work verbs: "Continue from where you left off." is an order.
    static let workVerbs = ["continue", "resume", "proceed", "go on", "keep going", "fix", "make", "build", "create",
                            "write", "add", "remove", "delete", "change", "run", "start", "do it", "finish"]
    /// "Did you do it" is a question about real state, which only the agent
    /// that can look at it should answer.
    static let statusQuestions = ["올린", "올렸", "보낸", "보냈", "만든", "만들었", "끝난", "끝났", "다 한", "다했", "한거야",
                                  "된거야", "했는지", "됐는지", "됐나", "했나", "뭐하는", "어디까지"]

    /// The chat lane's own arguments: every customization off, no tools, and a
    /// workspace the turn never reads. Kept next to the rule that selects it so
    /// the two cannot drift apart.
    public static let claudeArguments = ["--safe-mode", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}"]

    /// The owner picked this lane on the rail (`--provider claude-chat`), so the
    /// narrow auto-trigger above is not required. Everything else the lane needs
    /// — read-only ticket, no attached source, no shell, no named path, no image
    /// — still has to hold, and a request that fails one of those is refused
    /// before dispatch rather than quietly promoted to the full lane.
    ///
    /// Process-scoped: one `os1 run` serves one owner selection, and the flag is
    /// set from the argument parse before any routing decision.
    nonisolated(unsafe) private static var explicitSelection = false
    public static func selectExplicitly() { explicitSelection = true }
    public static var ownerSelected: Bool { explicitSelection }
    /// A route fan-out (`RouteFanout`) runs its parts one after another in one
    /// process; each part sets the lane its name selected before it starts.
    public static func setExplicitSelection(_ selected: Bool) { explicitSelection = selected }
}

/// OpenAI's side of the chat-shaped lane (`--provider gpt-chat`, or the same
/// narrow auto-trigger on a Codex ticket): GPT through the Codex app-server
/// with every tool and customization off, in a workspace the turn never reads.
/// The lane predicate is `ClaudeChatLane`'s; only the transport differs.
public enum CodexChatLane {
    /// Built-in tools, apps, plugins, hooks and memories off. Each key was
    /// read back through the app-server's `config/read` (2026-10-01).
    public static let featureOverrides = [
        "features.shell_tool=false", "features.unified_exec=false", "features.apps=false",
        "features.plugins=false", "features.hooks=false", "features.web_search_request=false",
        "features.memories=false",
    ]

    /// `mcp_servers={}` does not replace configured servers (config/read still
    /// lists them enabled); each one has to be disabled by name.
    public static func mcpServerNames(configToml: String) -> [String] {
        var names: [String] = []
        for line in configToml.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard let match = trimmed.range(of: #"^\[mcp_servers\.([A-Za-z0-9_-]+)\]$"#, options: .regularExpression) else { continue }
            let name = String(trimmed[match].dropFirst("[mcp_servers.".count).dropLast())
            if !names.contains(name) { names.append(name) }
        }
        return names
    }

    public static func overrides(configToml: String?) -> [String] {
        featureOverrides + mcpServerNames(configToml: configToml ?? "").map { "mcp_servers.\($0).enabled=false" }
    }
}
