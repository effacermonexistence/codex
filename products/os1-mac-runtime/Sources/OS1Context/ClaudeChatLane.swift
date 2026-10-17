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

    /// The chat lane's own arguments: every customization off, no tools, and a
    /// workspace the turn never reads. Kept next to the rule that selects it so
    /// the two cannot drift apart.
    public static let claudeArguments = ["--safe-mode", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}"]
}
