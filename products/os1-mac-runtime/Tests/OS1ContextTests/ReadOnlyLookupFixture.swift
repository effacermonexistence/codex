import Foundation
import OS1Context

/// Owner, 2026-10-02: a domain-naming turn ran on the read-only lane, whose
/// sandboxed shell refused every registry check, so the answer could not say
/// which names were free. Domain turns get the lookup card, and the lane's
/// sandbox reaches public registries and explicitly named connection-check
/// hosts, without broadening shell/write authority.
func runReadOnlyLookupFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Read-only lookup: " + message); count += 1
    }
    let conversation = "아니 일단 가능한 도메인 주소를 다 줘봐 인마. 최대한 간단하고 단순해야 돼. 그럼 무조건 닷컴으로 끝나야 돼."
    for request in [
        "쓰고 있으면 다른 거 하자. 다른 거 좀 줘봐. 짧고 단순한 거. 근데 무조건 닷컴이어야 돼.",
        "u-sung.com야 너 비싸다. 이걸로 하자. 왜 이렇게 비싸?",
        "usungcorp.com 지금 살 수 있어?",
        "https://usung-demo-20260919-production.up.railway.app이거 왜 올라왔잖아. 유성 도메인 하나 만들어라.",
        "theusung.co.kr도 돼?",
        "is usungltd.com still free?",
    ] {
        check(ReadOnlyLookup.relevant(request: request, context: nil), "domain turn: \(request)")
    }
    check(ReadOnlyLookup.relevant(request: "이걸로 하자", context: conversation), "short follow-up of a domain conversation")
    check(ReadOnlyLookup.relevant(request: "다른 거 좀 줘봐", context: conversation), "short follow-up asking for more names")
    for request in [
        "README.md 예시 좀 보여줘",
        "Sources/OS1/main.swift 고쳐",
        "야 나 R2에 QMGR 통합하는 자료 있거든? 그거 가져와.",
        "오늘 날씨 어때?",
        "package.json 버전 올려",
    ] {
        check(!ReadOnlyLookup.relevant(request: request, context: nil), "not a domain turn: \(request)")
    }
    let longRequest = String(repeating: "이 기능 테스트를 다시 돌리고 결과를 정리해서 알려줘. ", count: 6)
    check(!ReadOnlyLookup.relevant(request: longRequest, context: conversation),
          "a long new request does not inherit the card from an earlier domain turn")
    check(ReadOnlyLookup.capabilityCard.contains("https://rdap.verisign.com/com/v1/domain/NAME.com")
          && ReadOnlyLookup.capabilityCard.contains("404"), "the card names the .com registry and what 404 means")
    check(ReadOnlyLookup.capabilityCard.contains("*.up.railway.app"),
          "a company domain is a registrable name, not a free platform subdomain")
    check(ReadOnlyLookup.capabilityCard.contains("Never rename, remove or replace")
          && ReadOnlyLookup.capabilityCard.contains("explicit owner request"),
          "domain registration cannot authorize replacing an existing service URL")
    check(ReadOnlyLookup.capabilityCard.contains("native agent's existing tools")
          && !ReadOnlyLookup.capabilityCard.contains("give the checkout link)"),
          "registration preparation uses native execution, not a mandatory link-only handoff")

    let settings = try JSONSerialization.jsonObject(with: Data(ClaudeReadOnlyShell.sandboxSettings.utf8)) as? [String: Any]
    let sandbox = settings?["sandbox"] as? [String: Any]
    let network = sandbox?["network"] as? [String: Any]
    check(network?["allowedDomains"] as? [String] == ClaudeReadOnlyShell.allowedNetworkHosts,
          "the lane's sandbox reaches exactly the registry and inspection hosts")
    check(ClaudeReadOnlyShell.inspectionHosts == ["api.github.com", "github.com", "api.cloudflare.com", "dash.cloudflare.com"],
          "only named GitHub and Cloudflare inspection endpoints are added")
    check(!ClaudeReadOnlyShell.allowedNetworkHosts.contains("*")
          && Set(ClaudeReadOnlyShell.allowedNetworkHosts).count == ClaudeReadOnlyShell.allowedNetworkHosts.count,
          "network access has no wildcard or duplicate host")
    check(ReadOnlyLookup.registryHosts.contains("rdap.verisign.com"), "the .com registry is reachable")
    check(sandbox?["excludedCommands"] as? [String] == [
        "git", "gh", "railway", "wrangler", "pnpm exec wrangler", "os1",
        "node --version", "swift --version", "codex --version", "claude --version",
    ], "the commands that run outside the sandbox are unchanged")
    check(Set(settings?.keys.map { $0 } ?? []) == ["sandbox"] && Set(sandbox?.keys.map { $0 } ?? []) == ["excludedCommands", "network"]
          && Set(network?.keys.map { $0 } ?? []) == ["allowedDomains"], "no other sandbox setting changed")
    check(ClaudeReadOnlyShell.allowRules.contains("Bash(os1 connection-status:*)")
          && !ClaudeReadOnlyShell.allowRules.contains("Bash(*)")
          && !ClaudeReadOnlyShell.allowRules.contains("Bash(gh api:*)"),
          "trusted connection-status is allowed without arbitrary shell or API methods")
    check(ClaudeReadOnlyShell.directive.contains("MCP integrations are intentionally excluded")
          && ClaudeReadOnlyShell.directive.contains("not evidence that credentials expired")
          && ClaudeReadOnlyShell.directive.contains("os1 connection-status"),
          "capability card distinguishes missing MCP and denied checks from disconnected credentials")
    func denied(_ tool: String, command: String? = nil) -> [String: Any] {
        var value: [String: Any] = ["tool_name": tool]
        if let command { value["tool_input"] = ["command": command] }
        return value
    }
    for tool in ["Read", "Glob", "Grep", "WebFetch", "WebSearch"] {
        check(ClaudeReadOnlyShell.isAllowedInspectionDenial(denied(tool)), "unexpected denial: \(tool)")
    }
    for command in [
        "gh auth status --hostname github.com", "gh api user", "/opt/homebrew/bin/gh api user",
        "git status --short", "git branch --show-current", "os1 connection-status",
        "os1 connection-status --json", "'/Users/LUA/Applications/OS-1 CLODEX.app/Contents/MacOS/os1' connection-status",
        "wrangler whoami", "pnpm exec wrangler whoami",
        "/opt/homebrew/bin/node /tmp/repo/node_modules/wrangler/bin/wrangler.js whoami",
    ] {
        check(ClaudeReadOnlyShell.isAllowedInspectionDenial(denied("Bash", command: command)),
              "denied inspection is preserved: \(command)")
    }
    for command in [
        "rm -rf scratch", "git push origin main", "gh api repos/example/repo -X DELETE",
        "gh api user -X POST", "wrangler deploy", "os1-exo-monitor-sync air",
        "gh api user && touch changed", "gh api user; rm -rf scratch",
        "gh api user > file", "gh api user $(touch changed)", "git branch --show-current extra",
        "node /tmp/arbitrary.js whoami", "os1 connection-status\nrm file",
    ] {
        check(!ClaudeReadOnlyShell.isAllowedInspectionDenial(denied("Bash", command: command)),
              "write or untrusted command denial stays bounded: \(command)")
    }
    for tool in ["Write", "Edit", "MultiEdit", "NotebookEdit", "mcp__example__write", "mcp__example__read"] {
        check(!ClaudeReadOnlyShell.isAllowedInspectionDenial(denied(tool)),
              "outside-lane tool denial does not grant escalation: \(tool)")
    }
    check(!ClaudeReadOnlyShell.isAllowedInspectionDenial([:])
          && !ClaudeReadOnlyShell.isAllowedInspectionDenial(denied("Bash")),
          "malformed denial cannot invent authority")
    print("Read-only lookup fixtures: \(count) checks")
}
