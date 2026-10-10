import CryptoKit
import Darwin
import Foundation

@main
struct LocalOpenClawGatewayRunnerFixture {
    static func sha(_ url: URL) throws -> String {
        let bytes = try Data(contentsOf: url)
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    static func runCase(_ mode: String, fixtureRoot: URL) throws {
        let fm = FileManager.default
        let node = fixtureRoot.appendingPathComponent("fake-node-\(mode)")
        let entry = fixtureRoot.appendingPathComponent("fake-openclaw.mjs")
        let plugin = fixtureRoot.appendingPathComponent("OS-1 CLODEX.app/Contents/Resources/openclaw-os1-bridge")
        let runID = "offline-\(mode)-\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        let root = fm.homeDirectoryForCurrentUser.appendingPathComponent(".os1/openclaw-controller/\(runID)")
        defer { try? fm.removeItem(at: root) }
        let script = """
        #!\(ProcessInfo.processInfo.environment["PYTHON_BIN"] ?? "/usr/bin/python3")
        import json, os, signal, socket, sys, time
        mode = '\(mode)'
        args = sys.argv[2:]
        root = os.path.dirname(os.environ['OPENCLAW_CONFIG_PATH'])
        if args[:2] == ['gateway', 'run']:
            port = int(args[args.index('--port') + 1])
            s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(('127.0.0.1', port)); s.listen(3); s.settimeout(.2)
            with open(os.path.join(root, 'gateway.pid'), 'w') as f: f.write(str(os.getpid()))
            while True:
                try:
                    c, _ = s.accept(); c.close()
                except socket.timeout: pass
        if args[:2] == ['health', '--json']:
            if mode == 'never-ready': print(json.dumps({'status':'starting'})); sys.exit(0)
            c = json.load(open(os.environ['OPENCLAW_CONFIG_PATH']))
            s = socket.socket(); s.settimeout(.1)
            try:
                s.connect(('127.0.0.1', c['gateway']['port']))
                print(json.dumps({'ok': True})); sys.exit(0)
            except OSError:
                print(json.dumps({'status':'starting'})); sys.exit(0)
        if args[:2] == ['agent', '--agent']:
            c = json.load(open(os.path.join(root, 'contract.json')))
            import hashlib
            gate = dict(schema=1, run_id=c['run_id'], session_id=c['session_id'],
                        request_sha256=c['request_sha256'], policy_sha256=c['policy_sha256'],
                        contract_sha256=hashlib.sha256(open(os.path.join(root, 'contract.json'),'rb').read()).hexdigest(),
                        gate='before_agent_run_passed', model_invoked=False)
            if mode != 'no-gate':
                with open(os.path.join(root, 'gate-receipt.json'), 'x') as f: json.dump(gate, f)
                os.chmod(os.path.join(root, 'gate-receipt.json'), 0o600)
            time.sleep(3 if mode == 'client-timeout' else .30)
            if mode == 'client-fail': sys.exit(7)
            if mode == 'client-flood':
                print('X' * 70000, flush=True); time.sleep(2); sys.exit(0)
            print(json.dumps({'status':'ok', 'runId':'fake-gateway-run', 'result':{'payloads':[{'text':'candidate'}]}}))
            sys.exit(0)
        sys.exit(19)
        """
        try script.write(to: node, atomically: true, encoding: .utf8)
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: node.path)
        let state = OpenClawAgentController.State(objective: "Offline fixture", stage: .plan,
                                                   eligibleCandidateIDs: ["codex"])
        let turn = try OpenClawAgentController.prepare(
            enabled: true, runID: runID, sessionID: "fixture-session", request: "Read approved state",
            policySourceSHA256: OpenClawAgentController.digest(Data("source".utf8)),
            policy: "Fixture policy; candidate only", state: state,
            pluginDirectory: plugin.path, workspace: root.appendingPathComponent("workspace").path)
        let identity = LocalOpenClawGatewayRunner.InstalledIdentity(
            nodePath: node.path, nodeSHA256: try sha(node), entryPath: entry.path,
            entrySHA256: try sha(entry), pluginDirectory: plugin.path,
            pluginIndexSHA256: try sha(plugin.appendingPathComponent("index.mjs")),
            pluginManifestSHA256: try sha(plugin.appendingPathComponent("openclaw.plugin.json")),
            pluginPackageSHA256: try sha(plugin.appendingPathComponent("package.json")))
        if mode == "identity-mismatch" {
            let wrong = LocalOpenClawGatewayRunner.InstalledIdentity(
                nodePath: node.path, nodeSHA256: String(repeating: "0", count: 64),
                entryPath: entry.path, entrySHA256: identity.entrySHA256,
                pluginDirectory: plugin.path, pluginIndexSHA256: identity.pluginIndexSHA256,
                pluginManifestSHA256: identity.pluginManifestSHA256,
                pluginPackageSHA256: identity.pluginPackageSHA256)
            do {
                _ = try LocalOpenClawGatewayRunner.runForOfflineFixture(turn: turn, installed: wrong)
                throw NSError(domain: "GatewayFixture", code: 5)
            } catch LocalOpenClawGatewayRunner.Failure.identityMismatch {
                guard !fm.fileExists(atPath: root.path) else { throw NSError(domain: "GatewayFixture", code: 6) }
                print("PASS identity-mismatch blocked before launch")
                return
            }
        }
        let result: LocalOpenClawGatewayRunner.Terminal?
        do {
            let start = Date()
            result = try LocalOpenClawGatewayRunner.runForOfflineFixture(
                turn: turn, installed: identity,
                cancelled: { mode == "cancelled" && Date().timeIntervalSince(start) > 0.25 },
                clientTimeoutSeconds: mode == "client-timeout" ? 0.35 : 45)
        } catch {
            result = nil
            let expected: LocalOpenClawGatewayRunner.Failure = mode == "never-ready" ? .gatewayNotReady :
                mode == "client-fail" ? .clientFailed : mode == "cancelled" ? .cancelled :
                mode == "client-timeout" ? .clientTimeout : mode == "client-flood" ? .unboundedOutput : .missingGate
            guard let failure = error as? LocalOpenClawGatewayRunner.Failure, failure == expected else {
                throw NSError(domain: "GatewayFixture", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "Unexpected failure in \(mode): \(error)"])
            }
        }
        if mode == "success" {
            guard let result, result.gateObservedBeforeTerminal,
                  result.qualityClaim == "unverified", result.exitCode == 0,
                  result.gatewayEnvelopeSHA256 == OpenClawAgentController.digest(result.gatewayEnvelope),
                  result.gateReceiptSHA256 == OpenClawAgentController.digest(result.gateReceipt) else {
                throw NSError(domain: "GatewayFixture", code: 2)
            }
        } else if result != nil { throw NSError(domain: "GatewayFixture", code: 3) }
        guard !fm.fileExists(atPath: root.appendingPathComponent("config.json").path),
              let pidText = try? String(contentsOf: root.appendingPathComponent("gateway.pid"), encoding: .utf8),
              let pid = Int32(pidText), kill(pid, 0) != 0, errno == ESRCH else {
            throw NSError(domain: "GatewayFixture", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "Owned Gateway or token config survived \(mode)"])
        }
        print("PASS \(mode) offline Gateway process/gate/cleanup")
    }

    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        try runCase("success", fixtureRoot: root)
        try runCase("identity-mismatch", fixtureRoot: root)
        try runCase("client-fail", fixtureRoot: root)
        try runCase("no-gate", fixtureRoot: root)
        try runCase("cancelled", fixtureRoot: root)
        try runCase("client-timeout", fixtureRoot: root)
        try runCase("client-flood", fixtureRoot: root)
        try runCase("never-ready", fixtureRoot: root)
    }
}
