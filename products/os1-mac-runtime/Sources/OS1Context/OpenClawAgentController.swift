import CryptoKit
import Foundation

/// A host-prepared, read-only controller turn. OS-1 remains the authority for
/// permissions, signed execution tickets, worktree isolation and REVAS adoption.
/// This value does not launch OpenClaw or grant a backend. The installed bridge
/// must be verified and the caller must explicitly enable it before dispatch.
public enum OpenClawAgentController {
    public static let version = "2026.9.9"
    public static let model = "qwen3.5:4b"
    public static let modelDigest = "d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04"
    public static let maximumContractBytes = 65_536
    public static let maximumEnvelopeBytes = 65_536
    public static let maximumPolicyBytes = 16_384
    public static let maximumRequestBytes = 12_000

    public enum Stage: String, Codable, Sendable { case ingress, plan, route, execute, verify, adopt }
    public struct State: Codable, Equatable, Sendable {
        public let objective: String
        public let stage: Stage
        public let eligibleCandidateIDs: [String]
        public let qualityClaim: String
        private enum CodingKeys: String, CodingKey {
            case objective, stage
            case eligibleCandidateIDs = "eligible_candidate_ids"
            case qualityClaim = "quality_claim"
        }
        public init(objective: String, stage: Stage, eligibleCandidateIDs: [String]) {
            self.objective = objective
            self.stage = stage
            self.eligibleCandidateIDs = eligibleCandidateIDs
            self.qualityClaim = "unverified"
        }
    }
    public struct Contract: Codable, Equatable, Sendable {
        public let schema: Int
        public let runID: String
        public let sessionID: String
        public let requestSHA256: String
        public let policySourceSHA256: String
        public let policySHA256: String
        public let policy: String
        public let state: State
        private enum CodingKeys: String, CodingKey {
            case schema, policy, state
            case runID = "run_id", sessionID = "session_id"
            case requestSHA256 = "request_sha256"
            case policySourceSHA256 = "policy_source_sha256"
            case policySHA256 = "policy_sha256"
        }
    }
    public struct PreparedTurn: Sendable {
        public let request: String
        public let contract: Contract
        public let contractBytes: Data
        public let contractSHA256: String
        public let configBytes: Data
    }
    public enum Rejection: String, Error, Sendable {
        case controllerDisabled = "controller_disabled"
        case invalidSource = "invalid_policy_source"
        case invalidInput = "invalid_input"
        case unsupportedEnvelope = "unsupported_envelope"
        case backendFailure = "backend_failure"
        case wrongModel = "wrong_model"
        case unauthorizedTool = "unauthorized_tool"
        case unboundedOutput = "unbounded_output"
        case missingPreDispatchGate = "missing_pre_dispatch_gate"
    }
    public struct Candidate: Sendable {
        public let final: String
        public let sessionID: String
        public let usage: [String: Int]?
        public let toolCalls: Int
        public let envelopeSHA256: String
        /// A successful agent loop is still a candidate, never task-quality proof.
        public let qualityClaim = "unverified"
    }

    private static let idPattern = try! NSRegularExpression(pattern: #"^[A-Za-z0-9_-]{1,128}$"#)
    private static let hashPattern = try! NSRegularExpression(pattern: #"^[a-f0-9]{64}$"#)
    private static func valid(_ value: String, pattern: NSRegularExpression) -> Bool {
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        return pattern.firstMatch(in: value, range: range)?.range == range
    }
    public static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    public struct GateReceipt: Codable, Equatable, Sendable {
        public let schema: Int
        public let runID: String
        public let sessionID: String
        public let requestSHA256: String
        public let policySHA256: String
        public let contractSHA256: String
        public let gate: String
        public let modelInvoked: Bool
        private enum CodingKeys: String, CodingKey {
            case schema, gate
            case runID = "run_id", sessionID = "session_id"
            case requestSHA256 = "request_sha256", policySHA256 = "policy_sha256"
            case contractSHA256 = "contract_sha256", modelInvoked = "model_invoked"
        }
    }
    public struct Proposal: Sendable {
        public let candidate: Candidate
        public let gateReceipt: GateReceipt
        public let gateReceiptSHA256: String
        public let inputFingerprint: String
    }

    /// Called only after an actual agent-exec process returns. OpenClaw's
    /// pre-model hook must have written this exact gate receipt; otherwise a
    /// fluent final text is rejected. This is still not a task-quality proof.
    public static func propose(prepared: PreparedTurn, gateReceipt: Data,
                               envelope: Data, exitCode: Int32) throws -> Proposal {
        guard gateReceipt.count > 20, gateReceipt.count <= 2_048,
              let object = try? JSONSerialization.jsonObject(with: gateReceipt) as? [String: Any],
              Set(object.keys) == Set(["schema", "run_id", "session_id", "request_sha256",
                                       "policy_sha256", "contract_sha256", "gate", "model_invoked"]),
              let gate = try? JSONDecoder().decode(GateReceipt.self, from: gateReceipt),
              gate.schema == 1, gate.runID == prepared.contract.runID,
              gate.sessionID == prepared.contract.sessionID,
              gate.requestSHA256 == prepared.contract.requestSHA256,
              gate.policySHA256 == prepared.contract.policySHA256,
              gate.contractSHA256 == prepared.contractSHA256,
              gate.gate == "before_agent_run_passed", gate.modelInvoked == false else {
            throw Rejection.missingPreDispatchGate
        }
        let candidate = try admit(envelope: envelope, exitCode: exitCode)
        return Proposal(candidate: candidate, gateReceipt: gate,
                        gateReceiptSHA256: digest(gateReceipt),
                        inputFingerprint: prepared.contractSHA256)
    }

    /// `enabled` must come from a verified installed-resource identity. There
    /// is deliberately no implicit activation from a source checkout alone.
    public static func prepare(enabled: Bool = false, runID: String, sessionID: String,
                               request: String, policySourceSHA256: String, policy: String,
                               state: State, pluginDirectory: String, workspace: String) throws -> PreparedTurn {
        guard enabled else { throw Rejection.controllerDisabled }
        guard valid(policySourceSHA256, pattern: hashPattern), !policy.isEmpty,
              policy.utf8.count <= maximumPolicyBytes else { throw Rejection.invalidSource }
        guard valid(runID, pattern: idPattern), valid(sessionID, pattern: idPattern),
              !request.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              request.utf8.count <= maximumRequestBytes,
              !state.objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              state.objective.utf8.count <= 4_096,
              state.qualityClaim == "unverified", state.eligibleCandidateIDs.count <= 64,
              Set(state.eligibleCandidateIDs).count == state.eligibleCandidateIDs.count,
              state.eligibleCandidateIDs.allSatisfy({ valid($0, pattern: idPattern) }),
              pluginDirectory.hasPrefix("/"), workspace.hasPrefix("/") else { throw Rejection.invalidInput }
        let c = Contract(schema: 1, runID: runID, sessionID: sessionID,
                         requestSHA256: digest(Data(request.utf8)), policySourceSHA256: policySourceSHA256,
                         policySHA256: digest(Data(policy.utf8)), policy: policy, state: state)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let bytes = try encoder.encode(c)
        guard bytes.count <= maximumContractBytes else { throw Rejection.invalidInput }
        let config = try configBytes(pluginDirectory: pluginDirectory, workspace: workspace)
        return PreparedTurn(request: request, contract: c, contractBytes: bytes,
                            contractSHA256: digest(bytes), configBytes: config)
    }

    /// The one-shot OpenClaw config must not inherit an ambient model, plugin,
    /// tool, browser, provider credential, channel or skill. A separate host
    /// preflight verifies the signed plugin + OpenClaw + Node bytes and live
    /// Ollama model digest before materializing this config with mode 0600.
    public static func configBytes(pluginDirectory: String, workspace: String) throws -> Data {
        guard pluginDirectory.hasPrefix("/"), workspace.hasPrefix("/") else { throw Rejection.invalidInput }
        let modelEntry: [String: Any] = ["id": model, "name": "OS-1 Local Controller", "input": ["text"],
            "reasoning": true, "contextTokens": 8192, "contextWindow": 8192, "maxTokens": 768,
            "cost": ["input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0],
            "agentRuntime": ["id": "openclaw"],
            "params": ["temperature": 0, "num_ctx": 8192, "num_predict": 512, "think": false, "keep_alive": "5m"]]
        let config: [String: Any] = [
            "models": ["mode": "replace", "providers": ["ollama": ["baseUrl": "http://127.0.0.1:11434",
                "apiKey": "ollama-local", "api": "ollama", "agentRuntime": ["id": "openclaw"], "models": [modelEntry]]]],
            "agents": ["defaults": ["workspace": workspace, "skipBootstrap": true, "contextInjection": "never",
                "skills": [], "timeoutSeconds": 45, "model": ["primary": "ollama/" + model, "fallbacks": []]]],
            "tools": ["profile": "minimal", "alsoAllow": ["os1_state_read"],
                "deny": ["session_status", "gateway"], "toolSearch": false,
                "codeMode": ["enabled": false]],
            "browser": ["enabled": false],
            "plugins": ["enabled": true, "allow": ["os1-bridge"], "deny": [],
                "load": ["paths": [pluginDirectory]],
                "entries": ["os1-bridge": ["enabled": true,
                    "hooks": ["allowPromptInjection": true, "allowConversationAccess": true]]]],
            "env": ["shellEnv": ["enabled": false]]
        ]
        return try JSONSerialization.data(withJSONObject: config, options: [.sortedKeys])
    }

    public struct LaunchCommand: Sendable {
        public let executable: String
        public let arguments: [String]
        public let workingDirectory: String
    }

    /// Returns an argv-only invocation; it does not start a model or write a
    /// file. The host must first verify installed Node/OpenClaw/plugin hashes,
    /// Ollama's exact local digest, and atomically write config/contract/request
    /// as private regular files. The user request stays in --message-file, not
    /// process arguments. OS-1 owns conversation persistence outside OpenClaw.
    public static func command(prepared: PreparedTurn, privateHome: String,
                               nodePath: String, entryPath: String,
                               configPath: String, contractPath: String,
                               messagePath: String, workspace: String) throws -> LaunchCommand {
        let home = FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.path
        let prefix = home + "/.os1/openclaw-controller/" + prepared.contract.runID + "/"
        guard privateHome.hasPrefix(prefix), configPath.hasPrefix(prefix),
              contractPath.hasPrefix(prefix), messagePath.hasPrefix(prefix), workspace.hasPrefix(prefix),
              nodePath.hasPrefix("/"), entryPath.hasPrefix("/"),
              !nodePath.contains("/../"), !entryPath.contains("/../"),
              !privateHome.contains("/../"), !configPath.contains("/../"),
              !contractPath.contains("/../"), !messagePath.contains("/../"),
              !workspace.contains("/../") else { throw Rejection.invalidInput }
        let env = ["HOME=" + privateHome, "OPENCLAW_HOME=" + privateHome,
                   "OPENCLAW_STATE_DIR=" + privateHome + "/state",
                   "OPENCLAW_CONFIG_PATH=" + configPath,
                   "OS1_AGENT_CONTRACT_PATH=" + contractPath,
                   "OS1_AGENT_CONTRACT_SHA256=" + prepared.contractSHA256,
                   "OS1_AGENT_GATE_RECEIPT_PATH=" + URL(fileURLWithPath: contractPath).deletingLastPathComponent().appendingPathComponent("gate-receipt.json").path,
                   "PATH=" + URL(fileURLWithPath: nodePath).deletingLastPathComponent().path + ":/usr/bin:/bin"]
        let args = ["-i"] + env + [nodePath, entryPath, "agent", "exec", "--config", configPath,
            "--cwd", workspace, "--model", "ollama/" + model,
            "--thinking", "off", "--code-mode", "direct", "--message-file", messagePath,
            "--json", "--timeout", "45"]
        return LaunchCommand(executable: "/usr/bin/env", arguments: args, workingDirectory: workspace)
    }

    /// Admit only OpenClaw's *agent exec* stable JSON envelope, never the lean
    /// infer.model.run envelope or a claimed success in final text. This is a
    /// transport/tool-surface gate, not a quality-parity/adoption decision.
    public static func admit(envelope: Data, exitCode: Int32) throws -> Candidate {
        guard envelope.count <= maximumEnvelopeBytes,
              let object = try? JSONSerialization.jsonObject(with: envelope) as? [String: Any],
              exitCode == 0, object["ok"] as? Bool == true, object["status"] as? String == "ok"
        else { throw Rejection.backendFailure }
        guard object["provider"] as? String == "ollama", object["model"] as? String == model
        else { throw Rejection.wrongModel }
        guard let final = object["final"] as? String, !final.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              final.utf8.count <= 32_768, let session = object["sessionId"] as? String, !session.isEmpty
        else { throw Rejection.unboundedOutput }
        let tools = object["toolSummary"] as? [String: Any]
        let count = tools?["calls"] as? Int ?? 0
        let names = tools?["tools"] as? [String] ?? []
        guard count >= 0, count <= 8, (count == 0 || !names.isEmpty),
              names.allSatisfy({ $0 == "os1_state_read" }) else { throw Rejection.unauthorizedTool }
        let rawUsage = object["usage"] as? [String: Any]
        let usage = rawUsage?.compactMapValues { $0 as? Int }
        return Candidate(final: final, sessionID: session, usage: usage,
                         toolCalls: count, envelopeSHA256: digest(envelope))
    }
}
