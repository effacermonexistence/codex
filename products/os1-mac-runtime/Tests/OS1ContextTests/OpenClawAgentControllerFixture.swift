import Foundation
import OS1Context

/// Offline transport/governance contract; no model, tool, provider or install calls.
func runOpenClawAgentControllerFixture() throws {
    typealias C = OpenClawAgentController
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "OpenClawAgentControllerFixture", code: 1,
                                       userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    func rejects(_ label: String, _ f: () throws -> Void) throws {
        do { try f() } catch is C.Rejection { checks += 1; return }
        throw NSError(domain: "OpenClawAgentControllerFixture", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: label])
    }
    let source = C.digest(Data("v26-owner-source-fixture".utf8))
    let state = C.State(objective: "Inspect an OS-1-approved snapshot", stage: .plan,
                        eligibleCandidateIDs: ["codex-approved"])
    func make(enabled: Bool = true, sourceSHA: String? = nil, request: String = "Read approved state",
              state override: C.State? = nil) throws -> C.PreparedTurn {
        try C.prepare(enabled: enabled, runID: "fixture-run", sessionID: "fixture-session",
                      request: request, policySourceSHA256: sourceSHA ?? source,
                      policy: "RCC before-run policy. Candidate is not final.", state: override ?? state,
                      pluginDirectory: "/signed/OS1/OpenClawBridge", workspace: "/private/os1/workspace")
    }
    try rejects("source tree alone cannot enable OpenClaw") { _ = try make(enabled: false) }
    try rejects("invalid policy source") { _ = try make(sourceSHA: "unknown") }
    try rejects("empty request") { _ = try make(request: "  ") }
    try rejects("duplicate candidate IDs") {
        _ = try make(state: .init(objective: "test", stage: .route, eligibleCandidateIDs: ["same", "same"]))
    }
    let turn = try make()
    try check(turn.contract.requestSHA256 == C.digest(Data(turn.request.utf8)), "request hash")
    try check(turn.contract.policySourceSHA256 == source && turn.contract.policySHA256.count == 64,
              "source/projection hashes separated")
    try check(turn.contractSHA256 == C.digest(turn.contractBytes), "contract bytes")
    try check(try JSONDecoder().decode(C.Contract.self, from: turn.contractBytes) == turn.contract,
              "contract round trip")
    let runRoot = FileManager.default.homeDirectoryForCurrentUser.path + "/.os1/openclaw-controller/fixture-run/"
    try rejects("agent exec is disabled after real hook-bypass evidence") {
        _ = try C.command(prepared: turn, privateHome: runRoot + "home",
                          nodePath: "/signed/node", entryPath: "/signed/openclaw.mjs",
                          configPath: runRoot + "config.json", contractPath: runRoot + "contract.json",
                          messagePath: runRoot + "request.txt", workspace: runRoot + "workspace")
    }
    let preparedGateway = try C.prepareGateway(turn: turn, port: 55_231)
    let gatewayConfig = try JSONSerialization.jsonObject(with: preparedGateway.configBytes) as! [String: Any]
    let gateway = gatewayConfig["gateway"] as! [String: Any]
    let auth = gateway["auth"] as! [String: Any]
    let token = auth["token"] as! String
    try check(gateway["mode"] as? String == "local" && gateway["bind"] as? String == "loopback" &&
              gateway["port"] as? Int == 55_231 && auth["mode"] as? String == "token" && token.count == 64,
              "disposable gateway is loopback/token only")
    try check((gateway["controlUi"] as! [String: Any])["enabled"] as? Bool == false &&
              (gateway["uploads"] as! [String: Any])["enabled"] as? Bool == false &&
              (gateway["terminal"] as! [String: Any])["enabled"] as? Bool == false,
              "no unrelated gateway surfaces")
    let otherToken = ((try JSONSerialization.jsonObject(with: C.prepareGateway(turn: turn, port: 55_231).configBytes)
                        as! [String: Any])["gateway"] as! [String: Any])["auth"] as! [String: Any]
    try check(token != otherToken["token"] as? String, "per-run token is freshly random")
    let commands = try C.gatewayCommands(prepared: preparedGateway, privateHome: runRoot + "home",
                                          nodePath: "/signed/node", entryPath: "/signed/openclaw.mjs",
                                          configPath: runRoot + "config.json", contractPath: runRoot + "contract.json",
                                          messagePath: runRoot + "request.txt", workspace: runRoot + "workspace")
    try check(commands.gateway.arguments.contains("gateway") && commands.gateway.arguments.contains("run") &&
              commands.gateway.arguments.contains("--bind") && commands.gateway.arguments.contains("loopback") &&
              !commands.gateway.arguments.contains("--force") && !commands.gateway.arguments.contains(token),
              "gateway exact child has no token in argv and cannot kill another listener")
    try check(commands.requestAndWait.arguments.contains("agent") &&
              commands.requestAndWait.arguments.contains("--session-key") &&
              commands.sessionKey == "agent:main:fixture-run" &&
              commands.requestAndWait.arguments.contains("--message-file") &&
              !commands.requestAndWait.arguments.contains("--local") &&
              !commands.requestAndWait.arguments.contains(turn.request) &&
              !commands.requestAndWait.arguments.contains(token),
              "gateway agent request/wait binds exact session without leaking prompt or token")
    try rejects("invalid gateway port") { _ = try C.prepareGateway(turn: turn, port: 18789) }
    try rejects("other product path cannot become gateway home") {
        _ = try C.gatewayCommands(prepared: preparedGateway, privateHome: "/tmp/other/home",
                                  nodePath: "/signed/node", entryPath: "/signed/openclaw.mjs",
                                  configPath: runRoot + "config.json", contractPath: runRoot + "contract.json",
                                  messagePath: runRoot + "request.txt", workspace: runRoot + "workspace")
    }
    let config = try JSONSerialization.jsonObject(with: turn.configBytes) as! [String: Any]
    let providers = (config["models"] as! [String: Any])["providers"] as! [String: Any]
    try check(Set(providers.keys) == ["ollama"], "Ollama only")
    let tools = config["tools"] as! [String: Any]
    try check(tools["profile"] as? String == "minimal" &&
              tools["alsoAllow"] as? [String] == ["os1_state_read"] &&
              tools["toolSearch"] as? Bool == false, "typed tool only")
    let plugins = config["plugins"] as! [String: Any]
    try check(plugins["allow"] as? [String] == ["os1-bridge"], "no ambient plugin")
    let defaults = (config["agents"] as! [String: Any])["defaults"] as! [String: Any]
    try check(defaults["contextInjection"] as? String == "never", "no ambient bootstrap")
    try check((defaults["model"] as! [String: Any])["fallbacks"] as? [String] == [], "no hosted fallback")
    func envelope(_ overrides: [String: Any] = [:]) throws -> Data {
        var value: [String: Any] = ["ok": true, "status": "ok", "final": "Candidate only",
                                    "provider": "ollama", "model": C.model, "sessionId": "ephemeral-id",
                                    "toolSummary": ["calls": 1, "tools": ["os1_state_read"]]]
        for (k, v) in overrides { value[k] = v }
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }
    let gate: [String: Any] = ["schema": 1, "run_id": "fixture-run", "session_id": "fixture-session",
                               "request_sha256": turn.contract.requestSHA256,
                               "policy_sha256": turn.contract.policySHA256,
                               "contract_sha256": turn.contractSHA256,
                               "gate": "before_agent_run_passed", "model_invoked": false]
    let gateData = try JSONSerialization.data(withJSONObject: gate, options: [.sortedKeys])
    let proposal = try C.propose(prepared: turn, gateReceipt: gateData, envelope: envelope(), exitCode: 0)
    try check(proposal.inputFingerprint == turn.contractSHA256 && proposal.candidate.qualityClaim == "unverified",
              "pre-dispatch gate and returned envelope bind, without quality adoption")
    try rejects("missing pre-dispatch gate") {
        _ = try C.propose(prepared: turn, gateReceipt: Data(), envelope: envelope(), exitCode: 0)
    }
    var wrongGate = gate; wrongGate["policy_sha256"] = C.digest(Data("wrong".utf8))
    try rejects("wrong policy gate") {
        _ = try C.propose(prepared: turn, gateReceipt: JSONSerialization.data(withJSONObject: wrongGate),
                          envelope: envelope(), exitCode: 0)
    }
    let candidate = try C.admit(envelope: envelope(), exitCode: 0)
    try check(candidate.final == "Candidate only" && candidate.toolCalls == 1 &&
              candidate.qualityClaim == "unverified", "agent reply is candidate only")
    try rejects("nonzero exit") { _ = try C.admit(envelope: envelope(), exitCode: 1) }
    try rejects("hosted model") { _ = try C.admit(envelope: envelope(["provider": "openai"]), exitCode: 0) }
    try rejects("shell tool") {
        _ = try C.admit(envelope: envelope(["toolSummary": ["calls": 1, "tools": ["exec"]]]), exitCode: 0)
    }
    try rejects("empty final") { _ = try C.admit(envelope: envelope(["final": "  "]), exitCode: 0) }
    try rejects("tool-call count without names") {
        _ = try C.admit(envelope: envelope(["toolSummary": ["calls": 1]]), exitCode: 0)
    }
    if let index = CommandLine.arguments.firstIndex(of: "--emit-openclaw-config"),
       CommandLine.arguments.count > index + 2 {
        let bytes = try C.configBytes(pluginDirectory: CommandLine.arguments[index + 1],
                                      workspace: "/tmp/os1-offline-inspect-workspace")
        try bytes.write(to: URL(fileURLWithPath: CommandLine.arguments[index + 2]), options: .atomic)
    }
    if let index = CommandLine.arguments.firstIndex(of: "--emit-openclaw-gateway-config"),
       CommandLine.arguments.count > index + 2 {
        let sourceSHA = C.digest(Data("offline-gateway-source".utf8))
        let smoke = try C.prepare(enabled: true, runID: "fixture-run", sessionID: "fixture-session",
                                  request: "Read approved state", policySourceSHA256: sourceSHA,
                                  policy: "Offline fixture only", state: state,
                                  pluginDirectory: CommandLine.arguments[index + 1],
                                  workspace: "/tmp/os1-offline-inspect-workspace")
        let gatewayConfig = try C.prepareGateway(turn: smoke, port: 55_231).configBytes
        try gatewayConfig.write(to: URL(fileURLWithPath: CommandLine.arguments[index + 2]), options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600],
                                              ofItemAtPath: CommandLine.arguments[index + 2])
    }
    print("OpenClaw agent controller fixture: \(checks) offline checks PASS")
}
