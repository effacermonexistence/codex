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
        "Bash(os1 doctor)", "Bash(os1 version)",
        "Bash(node --version)", "Bash(swift --version)", "Bash(codex --version)", "Bash(claude --version)",
    ]

    /// Session settings for the lane: the listed inspection commands run outside
    /// Claude Code's process sandbox so `gh`/`git`/`railway`/`wrangler` can reach
    /// the network and the keychain (the sandbox would otherwise auto-deny them
    /// under dontAsk). Everything else stays sandboxed and prefix-gated.
    public static let sandboxSettings = #"{"sandbox":{"excludedCommands":["git","gh","railway","wrangler","pnpm exec wrangler","os1","node --version","swift --version","codex --version","claude --version"]}}"#

    public static var directive: String {
        "\nThis read-only lane allows only these shell commands: " + allowRules.joined(separator: ", ") +
        ". Use them to verify; if a needed command is outside this set, say exactly which command could not be run and answer with what was verified. Do not ask the user to move to another backend.\n"
    }
}
