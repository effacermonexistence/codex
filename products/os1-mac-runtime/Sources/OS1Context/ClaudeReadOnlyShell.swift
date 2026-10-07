import Foundation

/// The bounded shell of Claude's read-only lane. Each entry is a Claude Code
/// Bash prefix allow rule; under `--permission-mode dontAsk` every other
/// command is denied without a prompt. Only inspection commands whose write
/// forms need a different subcommand are listed — no generic `cat`, `ls` or
/// `curl`, because a redirection or a method flag would turn those into
/// writes, and Read/Glob/Grep already cover files. `wrangler r2 object get`
/// downloads into the working directory; that is a read of R2, not a write
/// to the project.
public enum ClaudeReadOnlyShell {
    public static let allowRules: [String] = [
        "Bash(git status:*)", "Bash(git log:*)", "Bash(git diff:*)", "Bash(git show:*)",
        "Bash(git branch --show-current)", "Bash(git branch -a)", "Bash(git branch -r)", "Bash(git branch -vv)",
        "Bash(git remote -v)", "Bash(git rev-parse:*)", "Bash(git ls-remote:*)", "Bash(git ls-files:*)", "Bash(git describe:*)",
        "Bash(gh auth status:*)", "Bash(gh run list:*)", "Bash(gh run view:*)", "Bash(gh pr list:*)", "Bash(gh pr view:*)",
        "Bash(gh pr checks:*)", "Bash(gh pr diff:*)", "Bash(gh workflow list:*)", "Bash(gh release list:*)", "Bash(gh repo view:*)",
        "Bash(railway status:*)", "Bash(railway logs:*)",
        "Bash(wrangler r2 object get:*)", "Bash(pnpm exec wrangler r2 object get:*)",
        "Bash(os1 doctor)", "Bash(os1 version)", "Bash(os1 connection-status:*)",
        "Bash(node --version)", "Bash(swift --version)", "Bash(codex --version)", "Bash(claude --version)",
    ]

    /// Session settings for the lane: the listed inspection commands run outside
    /// Claude Code's process sandbox so `gh`/`git`/`railway`/`wrangler` can reach
    /// the network and the keychain (the sandbox would otherwise auto-deny them
    /// under dontAsk). Everything else stays sandboxed and prefix-gated.
    /// The same read-only account check must not gain or lose network access
    /// according to whether the caller uses a CLI or its pinned node wrapper.
    /// These hosts permit inspection, not additional shell tools or write
    /// authority. All existing prefix, managed-permission and source guards
    /// remain in force.
    public static let inspectionHosts = [
        "api.github.com", "github.com", "api.cloudflare.com", "dash.cloudflare.com",
    ]
    public static let allowedNetworkHosts = ReadOnlyLookup.registryHosts + inspectionHosts

    public static let sandboxSettings = #"{"sandbox":{"excludedCommands":["git","gh","railway","wrangler","pnpm exec wrangler","os1","node --version","swift --version","codex --version","claude --version"],"network":{"allowedDomains":["#
        + allowedNetworkHosts.map { "\"\($0)\"" }.joined(separator: ",") + "]}}}"

    public static var directive: String {
        "\nThis read-only lane allows only these shell commands: " + allowRules.joined(separator: ", ") +
        ". For GitHub and Cloudflare/R2 connectivity use exactly `os1 connection-status --json`: this trusted read-only helper uses the existing authenticated official CLIs without exposing credentials. Do not reconstruct absolute node/CLI wrappers or copy authentication caches. A denied inspection is not evidence that credentials expired; distinguish permission denial, unreachable service and verified authentication failure. MCP integrations are intentionally excluded from this read-only lane (apart from OS-1's explicitly supplied memory tools); their absence here is not evidence that the owner's integrations disconnected. Explicit user/managed denies and the read-only scope remain binding. If a needed command is outside this set, say exactly which command could not be run and answer with what was verified. Do not ask the user to move to another backend, broaden access or replay completed side effects.\n"
    }

    /// Classifies an unexpected failure of an inspection capability; it grants
    /// no permission, changes no ticket and never requests full-access replay.
    /// This prevents a success-shaped final answer from hiding a denied status
    /// check, while denial of a write remains the read-only boundary working.
    public static func isAllowedInspectionDenial(_ denial: [String: Any]) -> Bool {
        guard let tool = denial["tool_name"] as? String else { return false }
        if ["Read", "Glob", "Grep", "WebFetch", "WebSearch"].contains(tool) { return true }
        guard tool == "Bash", let input = denial["tool_input"] as? [String: Any],
              let command = input["command"] as? String, let words = inspectionWords(command),
              !words.isEmpty else { return false }
        let executable = URL(fileURLWithPath: words[0]).lastPathComponent
        let arguments = Array(words.dropFirst())
        // CLI-prefix rules are represented by the same table as the actual
        // launch. Exact rules stay exact; prefix rules match token boundaries.
        let normalized = ([executable] + arguments).joined(separator: " ")
        if allowRules.contains(where: { rule in
            let pattern = String(rule.dropFirst("Bash(".count).dropLast())
            if pattern.hasSuffix(":*") {
                let prefix = String(pattern.dropLast(2))
                return normalized == prefix || normalized.hasPrefix(prefix + " ")
            }
            return normalized == pattern
        }) { return true }
        // These are known inspection attempts even though users should use
        // the helper instead of expanding the executable allowlist. Only the
        // fixed authenticated identity endpoint qualifies, never arbitrary
        // `gh api` methods, body flags or mutation endpoints.
        if executable == "gh", arguments == ["api", "user"] { return true }
        if executable == "wrangler", arguments == ["whoami"] { return true }
        if ["pnpm", "npm"].contains(executable), arguments == ["exec", "wrangler", "whoami"] { return true }
        if executable == "node", arguments.count == 2, arguments[1] == "whoami" {
            let script = arguments[0]
            return script.hasSuffix("/node_modules/wrangler/bin/wrangler.js")
                || script.hasSuffix("/node_modules/wrangler/bin/wrangler.mjs")
                || script.hasSuffix("/node_modules/.bin/wrangler")
        }
        return false
    }

    /// Conservative tokenization only for classification. Reject shell
    /// composition, substitutions and redirects, including quoted variants;
    /// uncertain syntax cannot acquire inspection status by prefix matching.
    private static func inspectionWords(_ command: String) -> [String]? {
        guard !command.isEmpty, !command.contains(where: { ";|&<>`$\\\n\r".contains($0) }) else { return nil }
        var words: [String] = [], word = "", quote: Character?
        var started = false
        for character in command {
            if let activeQuote = quote {
                if character == activeQuote { quote = nil }
                else { word.append(character) }
                started = true
            } else if character == "\"" || character == "'" {
                quote = character; started = true
            } else if character.isWhitespace {
                if started { words.append(word); word = ""; started = false }
            } else { word.append(character); started = true }
        }
        guard quote == nil else { return nil }
        if started { words.append(word) }
        return words
    }
}
