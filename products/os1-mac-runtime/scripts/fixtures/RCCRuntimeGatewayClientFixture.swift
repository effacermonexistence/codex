import CryptoKit
import Darwin
import Foundation
import OS1Context

#if RCC_CLIENT_STANDALONE
enum ExecutionCancellation {
    static var isCancelled: Bool { false }
}
enum PendingOS1Repair {
    static func processStartTime(_ pid: Int32) -> Date? {
        var info = kinfo_proc(); var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0, info.kp_proc.p_pid == pid else { return nil }
        let start = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000)
    }
}
#endif

@main
struct RCCRuntimeGatewayClientFixture {
    static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    static func require(_ condition: @autoclosure () throws -> Bool, _ note: String) throws {
        guard try condition() else { throw NSError(domain: "RCCRuntimeGatewayClientFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: note]) }
    }
    static func main() throws {
        let fm = FileManager.default
        let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("os1-rcc-client-fixture-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var ownedPID: Int32?
        defer {
            if ownedPID == nil,
               let data = try? Data(contentsOf: root.appendingPathComponent("runtime/transport-owner.json")),
               let info = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let directory = info["directory"] as? String, directory.hasPrefix(root.path + "/"),
               let number = info["pid"] as? NSNumber { ownedPID = number.int32Value }
            if let pid = ownedPID, pid > 0 {
                _ = kill(pid, SIGTERM)
                usleep(100_000)
                if kill(pid, 0) == 0 { _ = kill(pid, SIGKILL) }
            }
            try? fm.removeItem(at: root)
        }
        let plugin = root.appendingPathComponent("plugin", isDirectory: true)
        try fm.createDirectory(at: plugin, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var pluginHashes: [String: String] = [:]
        for file in ["index.mjs", "rcc-runtime.mjs", "rcc-plugin.mjs", "openclaw.plugin.json", "package.json"] {
            let bytes = Data((file + " fake fixture bytes\n").utf8)
            try bytes.write(to: plugin.appendingPathComponent(file)); pluginHashes[file] = hash(bytes)
        }
        let entry = root.appendingPathComponent("fake-node.py")
        let script = #"""
        import os,sys,json,time,socket,pathlib
        root=pathlib.Path(os.environ['OS1_RCC_STATE_ROOT'])
        def read(p): return json.loads(p.read_text())
        def write(p,v): p.write_text(json.dumps(v))
        if len(sys.argv)>1 and sys.argv[1]=='gateway':
            counter=root/'boots.json'; write(counter,(read(counter) if counter.exists() else 0)+1)
            listener=socket.socket(); listener.bind(('127.0.0.1',int(sys.argv[-1]))); listener.listen()
            while True: time.sleep(.1)
        method=os.environ['OS1_RCC_RPC_METHOD']
        params=read(pathlib.Path(os.environ['OS1_RCC_RPC_PARAMS']))
        audit=root/'argv.json'; write(audit,sys.argv)
        if method=='health': print(json.dumps({'ok':True})); sys.exit(0)
        if method=='os1.rcc.quiesce':
            owner=read(root/'transport-owner.json');busy=(root/'busy').exists()
            print(json.dumps({'schema':1,'request_id':params['request_id'],'owner_pid':owner['pid'],'active_dispatches':1 if busy else 0,'safe_to_stop':not busy,'queued_preserved':True,'queued_tasks':2,'accepting_submissions':False}));sys.exit(0)
        task=root/(params['task_id']+'.json')
        counter=root/'submits.json'
        if method=='os1.rcc.submit':
            counts=read(counter) if counter.exists() else {}; counts[params['task_id']]=counts.get(params['task_id'],0)+1; write(counter,counts)
            name=params['task_id']; state='running'; revision=3
            if name=='rejected':
                print(json.dumps({'ok':False,'error':{'type':'gateway_request_error','code':'INVALID_REQUEST','message':'idempotency_conflict','retryable':False}})); sys.exit(1)
            obj={'schema':1,'task_id':name,'request_sha256':params['request_sha256'],'state':state,'revision':revision,'children':[],'result':None,'error':None}
            if name=='awaiting_install':
                obj['state']='awaiting_install'
                obj['install_handoff']={'schema':1,'task_id':name,'request_sha256':params['request_sha256'],'node_id':'writer','parent_attempt_id':'attempt','source_fingerprint':'a'*64,'source_root':'/tmp/fixture','source_head':'b'*40,'protected_source_sha256':'c'*64,'staged_intent_id':'fixture-intent','staged_receipt_sha256':'d'*64,'state':'staged','installed_receipt':None}
            write(task,obj)
            if name=='lost_ack': sys.exit(2)
            if name=='wrong_binding': obj['request_sha256']='0'*64; write(task,obj)
        else:
            obj=read(task)
            if method=='os1.rcc.cancel': obj['state']='cancelled'; obj['revision']+=1; write(task,obj)
            elif params['task_id']=='regression': obj['revision']=2
            elif params['task_id'] in ['cancel','awaiting_install']: pass
            else:
                obj['state']='returned_unverified'; obj['revision']+=1
                obj['result']={'output':'2','execution_verified':True,'task_verified':False,'parity_state':'unverified','native_receipt':None}
                write(task,obj)
        print(json.dumps(obj))
        """#
        try Data(script.utf8).write(to: entry)
        let suggestedPython = URL(fileURLWithPath: ProcessInfo.processInfo.environment["PYTHON_BIN"] ?? "/usr/bin/python3").resolvingSymlinksInPath()
        let frameworkPython = suggestedPython.deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Resources/Python.app/Contents/MacOS/Python")
        let python = fm.fileExists(atPath: frameworkPython.path) ? frameworkPython.path : suggestedPython.path
        let native = "/bin/cat"
        let identity = RCCRuntimeGatewayClient.InstalledIdentity(nodePath: python,
            nodeSHA256: hash(try Data(contentsOf: URL(fileURLWithPath: python))), entryPath: entry.path,
            entrySHA256: hash(Data(script.utf8)), pluginDirectory: plugin.path, pluginFileSHA256: pluginHashes,
            nativeOS1Path: native, nativeOS1SHA256: hash(try Data(contentsOf: URL(fileURLWithPath: native))))
        let base: [String: Any] = ["models": ["mode": "replace", "providers": ["ollama": ["baseUrl": "http://127.0.0.1:11434"]]],
            "plugins": ["enabled": true, "allow": ["os1-bridge"], "load": ["paths": [plugin.path]]],
            "browser": ["enabled": false], "agents": ["defaults": ["model": ["primary": "ollama/qwen3.5:4b", "fallbacks": []]]], "tools": ["deny": ["*"]]]
        let configuration = RCCRuntimeGatewayClient.Configuration(identity: identity,
            baseConfig: try JSONSerialization.data(withJSONObject: base, options: [.sortedKeys]))
        let privateRoot = root.appendingPathComponent("runtime", isDirectory: true)
        let maintenance = root.appendingPathComponent("self-update/install-maintenance.pid")
        try fm.createDirectory(at: maintenance.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try Data(String(getpid()).utf8).write(to: maintenance)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: maintenance.path)
        do {
            try RCCRuntimeGatewayClient.checkMaintenanceForOfflineFixture(root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "live installer admitted a new task"])
        } catch RCCRuntimeGatewayClient.Failure.installerMaintenance { }
        try Data("2147483000".utf8).write(to: maintenance)
        try RCCRuntimeGatewayClient.checkMaintenanceForOfflineFixture(root: privateRoot)
        try require(fm.fileExists(atPath: maintenance.path), "dead installer marker was erased")
        try Data("not-a-pid".utf8).write(to: maintenance)
        do {
            try RCCRuntimeGatewayClient.checkMaintenanceForOfflineFixture(root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "malformed installer marker admitted"])
        } catch RCCRuntimeGatewayClient.Failure.privateStateInvalid { }
        try fm.removeItem(at: maintenance)
        func request(_ id: String) throws -> Data {
            let raw = "SENSITIVE_FIXTURE_REQUEST_DO_NOT_EXPOSE"
            return try JSONSerialization.data(withJSONObject: ["schema": 1, "task_id": id, "request": raw,
                "request_sha256": hash(Data(raw.utf8)), "budget": ["max_duration_ms": 5_000]], options: [.sortedKeys])
        }
        func state(_ bytes: Data) throws -> String {
            (try JSONSerialization.jsonObject(with: bytes) as? [String: Any])?["state"] as? String ?? "missing"
        }
        let unresolved = root.appendingPathComponent("unresolved-start", isDirectory: true)
        try fm.createDirectory(at: unresolved, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        try Data("unresolved fixture launch".utf8).write(to: unresolved.appendingPathComponent("transport-starting.json"))
        do {
            _ = try RCCRuntimeGatewayClient.quiesceForOfflineFixture(configuration: configuration, root: unresolved)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "unrecorded launch declared absent"])
        } catch RCCRuntimeGatewayClient.Failure.existingGatewayUnavailable { }
        var progress = [String]()
        let first = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("first"), configuration: configuration, root: privateRoot,
            progress: { bytes in progress.append((try? state(bytes)) ?? "invalid") })
        try require(try state(first) == "returned_unverified", "unverified result incorrectly certified")
        let metadata = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("transport-owner.json"))) as! [String: Any]
        ownedPID = (metadata["pid"] as! NSNumber).int32Value
        let second = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("second"), configuration: configuration, root: privateRoot)
        try require(try state(second) == "returned_unverified", "reused Gateway did not return second task")
        try require(try Data(contentsOf: privateRoot.appendingPathComponent("boots.json")) == Data("1".utf8), "Gateway not reused")
        let recovered = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("lost_ack"), configuration: configuration, root: privateRoot)
        try require(try state(recovered) == "returned_unverified", "ambiguous submit not reconciled")
        let counts = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("submits.json"))) as! [String: Int]
        try require(counts["lost_ack"] == 1, "ambiguous accepted request replayed")
        let awaiting = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("awaiting_install"), configuration: configuration, root: privateRoot)
        try require(try state(awaiting) == "awaiting_install", "installation must release observer without completion")
        let taskHash = try JSONSerialization.jsonObject(with: request("awaiting_install")) as! [String: Any]
        let observed = try RCCRuntimeGatewayClient.statusForOfflineFixture(taskID: "awaiting_install", requestSHA256: taskHash["request_sha256"] as! String,
            configuration: configuration, root: privateRoot)
        try require(try state(observed) == "awaiting_install", "same task installation status observed")
        let statusCounts = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("submits.json"))) as! [String: Int]
        try require(statusCounts["awaiting_install"] == 1, "status observation must never submit/replay task")
        let cancelledInstall = try RCCRuntimeGatewayClient.statusForOfflineFixture(taskID: "awaiting_install", requestSHA256: taskHash["request_sha256"] as! String,
            configuration: configuration, root: privateRoot, cancelling: true)
        try require(try state(cancelledInstall) == "cancelled", "cancel sent to original staged task without submit")
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("rejected"), configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "explicit rejection reused old state"])
        } catch RCCRuntimeGatewayClient.Failure.rpcRejected { }
        var cancel = false
        let cancelled = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("cancel"), configuration: configuration, root: privateRoot,
            cancelled: { cancel }, progress: { _ in cancel = true })
        try require(try state(cancelled) == "cancelled", "cancel intent not delivered to core")
        for id in ["wrong_binding", "regression"] {
            do {
                _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request(id), configuration: configuration, root: privateRoot)
                throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "invalid snapshot accepted"])
            } catch RCCRuntimeGatewayClient.Failure.snapshotInvalid { }
        }
        let args = try String(contentsOf: privateRoot.appendingPathComponent("argv.json"), encoding: .utf8)
        try require(!args.contains("SENSITIVE_FIXTURE_REQUEST_DO_NOT_EXPOSE"), "request leaked in argv")
        let ownerDirectory = URL(fileURLWithPath: metadata["directory"] as! String)
        let ownedConfig = try JSONSerialization.jsonObject(with: Data(contentsOf: ownerDirectory.appendingPathComponent("config.json"))) as! [String: Any]
        let scopedPlugins = ownedConfig["plugins"] as! [String: Any]
        let scopedEntries = scopedPlugins["entries"] as! [String: Any]
        let scopedEntry = scopedEntries["os1-bridge"] as! [String: Any]
        let subagent = scopedEntry["subagent"] as! [String: Any]
        try require(subagent["allowModelOverride"] as? Bool == true &&
            subagent["allowedModels"] as? [String] == ["ollama/qwen3.5:4b"], "background planner authority was not exact local-only")
        let configAttributes = try fm.attributesOfItem(atPath: ownerDirectory.appendingPathComponent("config.json").path)
        try require((configAttributes[.posixPermissions] as! NSNumber).intValue & 0o077 == 0, "token config not private")
        try Data("busy".utf8).write(to: privateRoot.appendingPathComponent("busy"))
        do {
            _ = try RCCRuntimeGatewayClient.quiesceForOfflineFixture(configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "active Gateway stopped"])
        } catch RCCRuntimeGatewayClient.Failure.upgradeNotQuiescent { }
        try require(kill(ownedPID!, 0) == 0, "active owner was signalled")
        try fm.removeItem(at: privateRoot.appendingPathComponent("busy"))
        let upgrade = try RCCRuntimeGatewayClient.quiesceForOfflineFixture(configuration: configuration, root: privateRoot)
        try require(upgrade.hadGateway && upgrade.queuedTasks == 2 && upgrade.receiptPath != nil, "safe upgrade receipt missing")
        ownedPID = nil
        _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("after_upgrade"), configuration: configuration, root: privateRoot)
        let newOwner = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("transport-owner.json"))) as! [String: Any]
        ownedPID = (newOwner["pid"] as! NSNumber).int32Value
        try require(try Data(contentsOf: privateRoot.appendingPathComponent("boots.json")) == Data("2".utf8), "new generation not started exactly once")
        let oldTask = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("first.json"))) as! [String: Any]
        try require(oldTask["state"] as? String == "returned_unverified", "upgrade discarded durable task state")
        try Data("mutated".utf8).write(to: plugin.appendingPathComponent("rcc-runtime.mjs"))
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("mutated"), configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "mutated module accepted"])
        } catch RCCRuntimeGatewayClient.Failure.identityMismatch { }
        try require(progress == ["running", "returned_unverified"], "progress not monotonic exact task snapshots")
        print("RCC Runtime Gateway client: 25 offline fake-transport checks PASS; hosted/model calls 0; live task state untouched")
    }
}
