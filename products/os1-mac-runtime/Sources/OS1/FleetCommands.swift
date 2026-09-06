import Foundation

func fleetCommand(_ arguments: [String]) async throws -> Bool {
    guard let command = arguments.first else { return false }
    switch command {
    case "fleet-self-test": try fleetSelfTest()
            case "exo-doctor": try await exoDoctor(config: RuntimeConfig.load())
            case "exo-claude-hook": await runClaudeEXOHook()
            case "exo-codex-hook": await runCodexEXOHook()
            case "configure-claude-exo": try configureClaudeEXOHook()
            case "configure-codex-exo": try configureCodexEXOHook()
            case "configure-fleet-agent":
                guard arguments.count == 3, arguments[1] == "--role" else {
                    throw OS1Error.message("configure-fleet-agent requires --role auto|pro|air")
                }
                try await configureFleetAgent(role: arguments[2])
            case "agent", "fleet-agent":
                var role: String?
                var once = false
                var index = 1
                while index < arguments.count {
                    switch arguments[index] {
                    case "--role" where index + 1 < arguments.count:
                        role = arguments[index + 1]; index += 2
                    case "--once": once = true; index += 1
                    default: throw OS1Error.message("Unknown fleet-agent argument")
                    }
                }
                guard let role else { throw OS1Error.message("fleet-agent requires --role pro|air") }
                try await runFleetAgent(role: role, once: once)
            case "fleet-run":
                var workspace: String?
                var prompt: String?
                var profile = "os1"
                var minMemoryMiB = 2_048
                var cpuWeight = 50
                var preferDeviceID: String?
                var index = 1
                while index < arguments.count {
                    switch arguments[index] {
                    case "--workspace" where index + 1 < arguments.count:
                        workspace = arguments[index + 1]; index += 2
                    case "--prompt" where index + 1 < arguments.count:
                        prompt = arguments[index + 1]; index += 2
                    case "--profile" where index + 1 < arguments.count:
                        profile = arguments[index + 1]; index += 2
                    case "--min-memory-mib" where index + 1 < arguments.count:
                        guard let value = Int(arguments[index + 1]), value >= 0 else {
                            throw OS1Error.message("--min-memory-mib must be a non-negative integer")
                        }
                        minMemoryMiB = value; index += 2
                    case "--cpu-weight" where index + 1 < arguments.count:
                        guard let value = Int(arguments[index + 1]), (0...100).contains(value) else {
                            throw OS1Error.message("--cpu-weight must be 0...100")
                        }
                        cpuWeight = value; index += 2
                    case "--prefer-device" where index + 1 < arguments.count:
                        preferDeviceID = arguments[index + 1]; index += 2
                    default: throw OS1Error.message("Unknown fleet-run argument")
                    }
                }
                guard let workspace, let prompt, !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw OS1Error.message("fleet-run requires --workspace and --prompt")
                }
                try await submitFleetTask(
                    workspace: workspace,
                    prompt: prompt,
                    profile: profile,
                    minMemoryMiB: minMemoryMiB,
                    cpuWeight: cpuWeight,
                    preferDeviceID: preferDeviceID
                )
            case "fleet-wait":
                var jobID: String?
                var timeoutSeconds = 3_600
                var index = 1
                while index < arguments.count {
                    switch arguments[index] {
                    case "--job" where index + 1 < arguments.count:
                        jobID = arguments[index + 1]; index += 2
                    case "--timeout-seconds" where index + 1 < arguments.count:
                        guard let value = Int(arguments[index + 1]), (5...3_600).contains(value) else {
                            throw OS1Error.message("--timeout-seconds must be 5...3600")
                        }
                        timeoutSeconds = value; index += 2
                    default: throw OS1Error.message("Unknown fleet-wait argument")
                    }
                }
                guard let jobID else { throw OS1Error.message("fleet-wait requires --job UUID") }
                print(try await waitForFleetTask(jobID: jobID, timeoutSeconds: timeoutSeconds))
            case "fleet-snapshot":
                guard arguments.count == 1 else { throw OS1Error.message("fleet-snapshot takes no arguments") }
                print(try await fleetSnapshotJSON())
    case "fleet-resume-submit":
        guard arguments.count == 3, arguments[1] == "--intent" else { throw OS1Error.message("Expected --intent SHA256") }
        let receipt = try await resumeFleetSubmission(arguments[2])
        print(String(decoding: try JSONEncoder().encode(receipt), as: UTF8.self))
    default: return false
    }
    return true
}
