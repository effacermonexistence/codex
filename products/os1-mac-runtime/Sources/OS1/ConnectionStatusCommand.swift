import Foundation
import OS1Context

/// Bounded read-only native connectivity executor. No model, login, account
/// switch, credential copy, tool installation, or business write.
enum ConnectionStatusCommand {
    private struct Observation: Codable {
        let service: String
        let state: String
        let check: String
        let detail: String
    }

    static func selfTest() throws {
        let denied = failed("github", "GET /user", output: (1, Data(),
            Data("bad credentials\n<sandbox_violations>deny network-outbound api.github.com:443 (user denied)</sandbox_violations>".utf8)))
        guard denied.state == "execution_restricted",
              failed("r2", "metadata", output: (1, Data(), Data("HTTP 401".utf8))).state == "authentication_required",
              failed("r2", "metadata", output: nil).state == "unverified" else {
            throw OS1Error.message("Connection inspection must preserve network/auth/unknown distinctions")
        }
        do { try run(["connection-status", "--login"]); throw OS1Error.message("Invalid inspection argument was accepted") }
        catch let error as OS1Error {
            guard error.description.contains("Expected: os1 connection-status") else { throw error }
        }
        print("Native connectivity executor: network/auth/unknown and no-login argument fixtures PASS; network calls 0")
    }

    static func run(_ arguments: [String]) throws {
        guard arguments.dropFirst().allSatisfy({ $0 == "--json" }), arguments.count <= 2 else {
            throw OS1Error.message("Expected: os1 connection-status [--json]")
        }
        let observations = [github(), cloudArchive()]
        if arguments.contains("--json") {
            let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
            print(String(decoding: try encoder.encode(observations), as: UTF8.self))
        } else {
            for value in observations { print("\(value.service): \(value.state) — \(value.detail)") }
        }
    }

    private static func failed(_ service: String, _ check: String, output: (Int32, Data, Data)?) -> Observation {
        let text = output.map { String(decoding: $0.1 + $0.2, as: UTF8.self).lowercased() } ?? ""
        let state: String
        if text.contains("deny network-outbound") || text.contains("sandbox_violations") {
            state = "execution_restricted"
        } else if text.contains("http 401") || text.contains("bad credentials") || text.contains("not logged in") {
            state = "authentication_required"
        } else if text.contains("http 403") || text.contains("forbidden") { state = "access_denied" }
        else if text.contains("network") || text.contains("fetch failed") || text.contains("timed out") || text.contains("could not resolve") {
            state = "network_unverified"
        } else { state = "unverified" }
        return Observation(service: service, state: state, check: check,
            detail: "The read-only check did not pass. No login, account, or permission was changed.")
    }

    private static func github() -> Observation {
        guard let executable = try? findExecutable("gh") else {
            return Observation(service: "github", state: "missing", check: "GET /user", detail: "GitHub CLI is not installed.")
        }
        let output = try? commandOutput(executable, ["api", "user", "--method", "GET", "--jq", ".id"], timeout: 15)
        guard let output, output.0 == 0,
              let identity = Int(String(decoding: output.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)), identity > 0 else {
            return failed("github", "GET /user", output: output)
        }
        return Observation(service: "github", state: "available", check: "GET /user", detail: "The existing GitHub login reached the authenticated API.")
    }

    private static func cloudArchive() -> Observation {
        // managedR2Executable() can install a missing tool. Inspection must
        // only use an already installed pinned Wrangler, never do setup.
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/tools/wrangler-\(managedWranglerVersion)")
        let executable = root.appendingPathComponent("node_modules/.bin/wrangler")
        let package = root.appendingPathComponent("node_modules/wrangler/package.json")
        guard let data = try? Data(contentsOf: package),
              let metadata = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              metadata["version"] as? String == managedWranglerVersion,
              executable.resolvingSymlinksInPath().path.hasPrefix(root.path + "/"),
              FileManager.default.isExecutableFile(atPath: executable.path) else {
            return Observation(service: "r2", state: "missing", check: "bucket metadata", detail: "The pinned Wrangler tool is not installed. Inspection did not install it.")
        }
        let output = try? commandOutput(executable.path,
            ["r2", "bucket", "info", "omar-private-archive", "--json"], timeout: 25,
            currentDirectory: FileManager.default.temporaryDirectory.path,
            environmentOverrides: ["CI": "true", "WRANGLER_SEND_METRICS": "false"])
        guard let output, output.0 == 0,
              let metadata = try? JSONSerialization.jsonObject(with: output.1) as? [String: Any],
              metadata["name"] as? String == "omar-private-archive" else {
            return failed("r2", "bucket metadata", output: output)
        }
        return Observation(service: "r2", state: "available", check: "bucket metadata", detail: "The existing Cloudflare login read omar-private-archive metadata. Object contents were not read.")
    }
}
