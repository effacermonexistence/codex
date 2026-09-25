import Foundation

/// Claude Code and Claude chat are the same app, the same sign-in and the same
/// Anthropic plan; only Claude Code has a programmatic interface, so OS-1 runs
/// every Claude turn through it. What the chat side really is, for a request
/// that needs nothing from the machine, is the same model without the coding
/// agent's baggage: no CLAUDE.md, no skills or MCP servers, no tools, and a
/// workspace it never reads.
///
/// Measured on this Mac, 2026-09-25, same question ("2의 10제곱은?"), same
/// account, sonnet/medium: the repo lane spent 359,147 cache-creation tokens
/// (35,937 weighted) in 5.4 s; the chat lane spent 641 weighted in 1.2 s — 56x
/// cheaper for the same answer, on the subscription, with no API key.
///
/// This decides only whether a request is answerable that way. It has to be a
/// pure function of the owner's objective: the same answer picks the execution
/// workspace before dispatch and hashes it again afterwards, so a request that
/// mentions anything on the machine keeps the full lane.
public enum ClaudeChatLane {
    /// Words that put the machine, its files or its history in scope. Matching
    /// is deliberately generous: a false "needs the workspace" only costs the
    /// usual lane, while a false "chat" answers without the material.
    static let workspaceTerms = [
        "저장소", "레포", "리포지", "코드", "파일", "폴더", "디렉터리", "디렉토리", "소스", "로그",
        "커밋", "브랜치", "빌드", "테스트", "스크립트", "설정", "환경변수", "함수", "클래스", "변수",
        "버그", "에러", "오류", "실행", "설치", "배포", "터미널", "명령", "프로젝트", "앱", "화면",
        "버전", "패치", "수정", "고쳐", "고치", "만들어", "작성해", "저장해", "지워", "삭제",
        "여기", "이거", "그거", "아까", "방금", "지금 상태", "확인해",
        "repo", "repository", "codebase", "code", "file", "folder", "directory", "source",
        "log", "commit", "branch", "diff", "build", "test", "script", "config", "settings",
        "function", "class", "variable", "bug", "error", "install", "deploy", "terminal",
        "command", "project", "app", "screen", "version", "patch", "fix", "create", "write to",
        "delete", "check", "workspace", "session", "account", "quota", "usage",
    ]

    /// Names OS-1 answers about itself or a registered project.
    static let projectTerms = ["os1", "os-1", "clodex", "클로덱스", "코덱스", "codex", "클로드", "claude",
                               "rcc", "instagram", "인스타", "scv", "fleet", "플릿"]

    /// True when the request puts something on this machine in scope, so the
    /// answer needs the full Claude Code lane.
    public static func needsWorkspaceMaterial(_ prompt: String) -> Bool {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        if projectTerms.contains(where: value.contains) { return true }
        if workspaceTerms.contains(where: value.contains) { return true }
        // A path, a URL or an identifier with a file extension is material too.
        return value.range(of: #"(?:^|\s)(?:~|\.{1,2})?/[^\s]|\bhttps?://|[A-Za-z0-9_-]+\.[A-Za-z]{1,6}\b"#,
                           options: .regularExpression) != nil
    }

    /// The chat lane's own arguments: every customization off, no tools, and a
    /// workspace the turn never reads. Kept next to the rule that selects it so
    /// the two cannot drift apart.
    public static let claudeArguments = ["--safe-mode", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}"]
}
