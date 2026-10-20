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
    static func main() async throws {
        let fm = FileManager.default
        let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("os1-rcc-client-fixture-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var ownedPID: Int32?
        var passed = false
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
            if passed { try? fm.removeItem(at: root) }
            else { print("Offline fixture failure evidence preserved privately: " + root.path) }
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
            counter=root/'boots.json'; boots=(read(counter) if counter.exists() else 0)+1; write(counter,boots)
            delay=float(os.environ.get('OS1_RCC_FIXTURE_READY_DELAY_SECONDS','0'))
            time.sleep(delay if boots==1 else min(delay,.8))
            (root/'ready').write_text('ready')
            listener=socket.socket(); listener.bind(('127.0.0.1',int(sys.argv[-1]))); listener.listen()
            while True: time.sleep(.1)
        method=os.environ['OS1_RCC_RPC_METHOD']
        params=read(pathlib.Path(os.environ['OS1_RCC_RPC_PARAMS']))
        audit=root/'argv.json'; write(audit,sys.argv)
        if method=='health':
            probes=root/'health-probes.json'; write(probes,(read(probes) if probes.exists() else 0)+1)
            bootstrap=root/'rpc-bootstrap-delay'; delay=float(bootstrap.read_text()) if bootstrap.exists() else 0
            time.sleep(delay)
            if (root/'unreachable').exists(): sys.exit(2)
            if not (root/'ready').exists(): print(json.dumps({'ok':False,'status':'starting'})); sys.exit(0)
            print(json.dumps({'ok':True})); sys.exit(0)
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
            name=params['task_id']
            if name.startswith('observer_'):
                countfile=root/'observer-reads.json'; counts=read(countfile) if countfile.exists() else {}
                if method=='os1.rcc.status':
                    counts[name]=counts.get(name,0)+1;write(countfile,counts)
                    if name in ['observer_multiple_loss','observer_multi_epoch_loss','observer_retry_rejected','observer_cancel_multiple','observer_missing_source']:
                        lose = counts[name] <= 2 if name=='observer_multiple_loss' else counts[name] in ([1,3] if name=='observer_multi_epoch_loss' else [1])
                        if lose:
                            (root/('status-started-'+name)).write_text('metadata only')
                            sys.exit(2)
                        if name=='observer_retry_rejected':
                            print(json.dumps({'ok':False,'error':{'type':'gateway_request_error','code':'INVALID_REQUEST'}}));sys.exit(1)
                        if name=='observer_multi_epoch_loss' and counts[name]==2:
                            obj['revision']=4;write(task,obj)
                        else:
                            obj['state']='returned_unverified';obj['revision']+=1
                            obj['result']={'output':'2','execution_verified':True,'task_verified':False,'parity_state':'unverified','native_receipt':None};write(task,obj)
                        print(json.dumps(obj));sys.exit(0)
                    if name=='observer_rejected':
                        print(json.dumps({'ok':False,'error':{'type':'gateway_request_error','code':'INVALID_REQUEST'}}));sys.exit(1)
                    if counts[name]==1:
                        if name not in ['observer_cancel_active','observer_permanent_timeout']:
                            obj['state']='returned_unverified';obj['revision']=4
                            obj['result']={'output':'2','execution_verified':True,'task_verified':False,'parity_state':'unverified','native_receipt':None}
                            write(task,obj)
                        (root/('status-started-'+name)).write_text('metadata only')
                        if name=='observer_owner_mismatch': os.kill(read(root/'transport-owner.json')['pid'],15)
                        time.sleep(4)
                    elif name=='observer_permanent_timeout':time.sleep(4)
                    elif name=='observer_wrong_revision':obj['revision']=2
                    elif name=='observer_wrong_hash':obj['request_sha256']='0'*64
                    elif name=='observer_wrong_source':obj['source_fingerprint']='0'*64
                    print(json.dumps(obj));sys.exit(0)
                if method=='os1.rcc.cancel':
                    cancels=root/'observer-cancels.json';counts=read(cancels) if cancels.exists() else {};counts[name]=counts.get(name,0)+1;write(cancels,counts)
                    if name=='observer_cancel_rejected':
                        print(json.dumps({'ok':False,'error':{'type':'gateway_request_error','code':'INVALID_REQUEST'}}));sys.exit(1)
                    # A terminal Core result wins over a later local Stop.
                    if obj['state'] not in ['completed','returned_unverified','held','failed','cancelled','effects_uncertain']:
                        obj['state']='cancelled';obj['revision']+=1;write(task,obj)
                    print(json.dumps(obj));sys.exit(0)
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
            baseConfig: try JSONSerialization.data(withJSONObject: base, options: [.sortedKeys]),
            bridgeEnvironment: ["OS1_RCC_FIXTURE_READY_DELAY_SECONDS": "21.1"])
        let privateRoot = root.appendingPathComponent("runtime", isDirectory: true)
        let maintenance = root.appendingPathComponent("self-update/install-maintenance.pid")
        try fm.createDirectory(at: maintenance.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try Data(String(getpid()).utf8).write(to: maintenance)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: maintenance.path)
        do {
            try RCCRuntimeGatewayClient.checkMaintenanceForOfflineFixture(root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "live installer admitted a new task"])
        } catch RCCRuntimeGatewayClient.Failure.installerMaintenance { }
        do {
            _ = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "warmup raced active installation"])
        } catch RCCRuntimeGatewayClient.Failure.installerMaintenance { }
        try require(!fm.fileExists(atPath: privateRoot.appendingPathComponent("boots.json").path), "blocked warmup spawned owner")
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
                "request_sha256": hash(Data(raw.utf8)), "source_fingerprint": hash(Data("fixture source:".utf8)),
                "policy_sha256": hash(Data("fixture policy".utf8)), "budget": ["max_duration_ms": 5_000]], options: [.sortedKeys])
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
        try require(RCCRuntimeGatewayClient.startupReadinessBudget == 60, "startup readiness regressed to task/RPC timeout")
        // An observer can expire while the exact owned Gateway is starting.
        // The next health-only warmup must wait for THAT process, not replace
        // it or invent a task. The first fake owner becomes ready after the
        // old 20-second boundary; this uses no OpenClaw/model or live HOME.
        let coldStartedAt = Date()
        do {
            _ = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration,
                root: privateRoot, readinessTimeout: 0.25)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "delayed startup declared ready before health"])
        } catch RCCRuntimeGatewayClient.Failure.gatewayNotReady { }
        let beforeWarm = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("transport-owner.json"))) as! [String: Any]
        ownedPID = (beforeWarm["pid"] as! NSNumber).int32Value
        let warmed = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration, root: privateRoot,
            readinessTimeout: RCCRuntimeGatewayClient.startupReadinessBudget)
        try require(Date().timeIntervalSince(coldStartedAt) > 20, "cold-start fixture did not cross original readiness deadline")
        try require(warmed.ownerPID == ownedPID && warmed.ready && warmed.gatewayIdentityVerified,
            "delayed existing owner not reconciled through verified readiness")
        try require(!warmed.taskSubmitted && warmed.providerCalls == 0 &&
            !fm.fileExists(atPath: privateRoot.appendingPathComponent("submits.json").path), "warmup dispatched a task/provider")
        try require(try Data(contentsOf: privateRoot.appendingPathComponent("boots.json")) == Data("1".utf8), "warmup replaced starting owner")
        let warmedJSON = try JSONSerialization.jsonObject(with: JSONEncoder().encode(warmed)) as! [String: Any]
        try require(warmedJSON["gateway_identity_verified"] as? Bool == true && warmedJSON["task_submitted"] as? Bool == false &&
            warmedJSON["provider_calls"] as? Int == 0 && warmedJSON["state"] as? String == "ready", "warmup output contract not verified")
        // A healthy owner's authenticated CLI may take >5s to bootstrap before
        // its 1s fixture RPC starts. The old timeout+2 watchdog killed that
        // observer even though the owned Gateway was already healthy.
        let probeCountBefore = try JSONDecoder().decode(Int.self, from: Data(contentsOf: privateRoot.appendingPathComponent("health-probes.json")))
        let ownerBytesBeforeSlowProbe = try Data(contentsOf: privateRoot.appendingPathComponent("transport-owner.json"))
        let bootstrapDelay = privateRoot.appendingPathComponent("rpc-bootstrap-delay")
        try Data("5.2".utf8).write(to: bootstrapDelay)
        let slowStarted = Date()
        let slowWarm = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration, root: privateRoot,
            readinessTimeout: 9)
        try require(Date().timeIntervalSince(slowStarted) > 5 && Date().timeIntervalSince(slowStarted) < 9,
            "slow CLI bootstrap not isolated from RPC network timeout")
        try require(slowWarm.ownerPID == ownedPID && !slowWarm.taskSubmitted && slowWarm.providerCalls == 0,
            "slow observer changed owner or dispatched model work")
        let probeCountAfter = try JSONDecoder().decode(Int.self, from: Data(contentsOf: privateRoot.appendingPathComponent("health-probes.json")))
        try require(probeCountAfter == probeCountBefore + 1, "healthy slow bootstrap caused a CLI retry storm")
        try require(try Data(contentsOf: privateRoot.appendingPathComponent("transport-owner.json")) == ownerBytesBeforeSlowProbe,
            "readiness rewrote existing owner identity")
        // Contention must consume the SAME readiness budget as probing. Hold
        // only this isolated fixture's lock, then let a slow CLI hit the
        // remaining deadline. The persistent fixture owner must survive.
        let lockFD = open(privateRoot.appendingPathComponent("transport-start.lock").path, O_RDWR)
        try require(lockFD >= 0 && flock(lockFD, LOCK_EX | LOCK_NB) == 0, "fixture lock unavailable")
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.8) { _ = flock(lockFD, LOCK_UN) }
        let boundedStarted = Date()
        do {
            _ = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration, root: privateRoot,
                readinessTimeout: 1.5)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "slow bootstrap escaped readiness ceiling"])
        } catch RCCRuntimeGatewayClient.Failure.existingGatewayUnavailable { }
        _ = close(lockFD)
        try require(Date().timeIntervalSince(boundedStarted) < 2.1, "lock wait restarted readiness deadline")
        try require(kill(ownedPID!, 0) == 0 &&
            (try Data(contentsOf: privateRoot.appendingPathComponent("boots.json"))) == Data("1".utf8),
            "expired health observer killed or replaced the owned Gateway")
        try fm.removeItem(at: bootstrapDelay)
        let unreachable = privateRoot.appendingPathComponent("unreachable")
        try Data("offline only".utf8).write(to: unreachable)
        let unreachableStarted = Date()
        do {
            _ = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration, root: privateRoot,
                readinessTimeout: 0.8)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "unreachable owner declared ready"])
        } catch RCCRuntimeGatewayClient.Failure.existingGatewayUnavailable { }
        try require(Date().timeIntervalSince(unreachableStarted) < 1.4 && kill(ownedPID!, 0) == 0,
            "unreachable health exceeded deadline or killed owner")
        try fm.removeItem(at: unreachable)
        try require(!fm.fileExists(atPath: privateRoot.appendingPathComponent("submits.json").path),
            "readiness regression tests submitted a task")
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
        // Derived from actual396's saved Core terminal + lost GUI result.
        // Fake transport only: A status observer times out AFTER Core saved
        // the real answer, and a later read must recover that same task once.
        let immutable = try request("observer_timeout")
        let observedTerminal = try RCCRuntimeGatewayClient.runForOfflineFixture(request: immutable,
            configuration: configuration, root: privateRoot)
        try require(try state(observedTerminal) == "returned_unverified", "later terminal lost after one observer timeout")
        try require(try request("observer_timeout") == immutable, "recovery rebuilt original source/policy request")
        var reads = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("observer-reads.json"))) as! [String: Int]
        try require(reads["observer_timeout"] == 2, "status recovery was not one bounded same-task read")
        // Reconnect is a task-lifetime read policy, not one retry for the
        // entire run. Two consecutive losses and a later independent loss
        // both preserve the original task, request and monotonic projection.
        for (id, count) in [("observer_multiple_loss", 3), ("observer_multi_epoch_loss", 4)] {
            let original = try request(id)
            let answer = try RCCRuntimeGatewayClient.runForOfflineFixture(request: original,
                configuration: configuration, root: privateRoot)
            try require(try state(answer) == "returned_unverified", "repeated transport loss detached live task: " + id)
            let observed = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("observer-reads.json"))) as! [String: Int]
            try require(observed[id] == count && (try request(id)) == original, "reconnect changed request or read sequence")
        }
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("observer_retry_rejected"), configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "reconnect retried authenticated refusal"])
        } catch RCCRuntimeGatewayClient.Failure.rpcRejected { }
        var unacknowledged = try JSONSerialization.jsonObject(with: request("observer_missing_source")) as! [String: Any]
        unacknowledged.removeValue(forKey: "source_fingerprint"); unacknowledged.removeValue(forKey: "policy_sha256")
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: JSONSerialization.data(withJSONObject: unacknowledged, options: [.sortedKeys]),
                configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "missing source admission gained reconnect authority"])
        } catch RCCRuntimeGatewayClient.Failure.rpcFailed { }
        let stopDuringReconnect = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("observer_cancel_multiple"), configuration: configuration, root: privateRoot,
            cancelled: { fm.fileExists(atPath: privateRoot.appendingPathComponent("status-started-observer_cancel_multiple").path) })
        try require(try state(stopDuringReconnect) == "cancelled", "Stop during reconnect lost same-task cancellation")
        for id in ["observer_wrong_revision", "observer_wrong_hash", "observer_wrong_source"] {
            do {
                _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request(id), configuration: configuration, root: privateRoot)
                throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "invalid recovery snapshot accepted: " + id])
            } catch RCCRuntimeGatewayClient.Failure.snapshotInvalid { }
        }
        for id in ["observer_rejected", "observer_cancel_rejected"] {
            var stop = false
            do {
                _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request(id), configuration: configuration, root: privateRoot,
                    cancelled: { stop }, progress: { _ in if id == "observer_cancel_rejected" { stop = true } })
                throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "authenticated refusal was retried: " + id])
            } catch RCCRuntimeGatewayClient.Failure.rpcRejected { }
        }
        for (id, expected) in [("observer_cancel_active", "cancelled"), ("observer_cancel_terminal", "returned_unverified")] {
            let answer = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request(id), configuration: configuration, root: privateRoot,
                cancelled: { fm.fileExists(atPath: privateRoot.appendingPathComponent("status-started-" + id).path) })
            try require(try state(answer) == expected, "Stop/terminal race lost original Core state: " + id)
        }
        let disconnectedStarted = Date()
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("observer_permanent_timeout"), configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "unbounded unavailable observer fabricated a result"])
        } catch RCCRuntimeGatewayClient.Failure.observationEnded { }
        try require(Date().timeIntervalSince(disconnectedStarted) < 6.5, "disconnected observer escaped original task budget")
        reads = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("observer-reads.json"))) as! [String: Int]
        try require(reads["observer_permanent_timeout"] == 2 && reads["observer_rejected"] == 1 && reads["observer_retry_rejected"] == 2 && reads["observer_missing_source"] == 1,
                    "original observation budget or authenticated/source boundary changed")
        let afterRecoverySubmits = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("submits.json"))) as! [String: Int]
        try require(afterRecoverySubmits.filter { $0.key.hasPrefix("observer_") }.values.allSatisfy { $0 == 1 },
                    "observer recovery submitted an existing task twice")
        let cancelCounts = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("observer-cancels.json"))) as! [String: Int]
        try require(cancelCounts.values.allSatisfy { $0 == 1 }, "cancel intent sent more than once")
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
        try fm.removeItem(at: privateRoot.appendingPathComponent("ready"))
        let nextRequest = try request("after_upgrade")
        let warmTask = Task.detached {
            try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration, root: privateRoot)
        }
        let requestTask = Task.detached {
            try RCCRuntimeGatewayClient.runForOfflineFixture(request: nextRequest, configuration: configuration, root: privateRoot)
        }
        let concurrentWarm = try await warmTask.value
        let concurrentResult = try await requestTask.value
        let newOwner = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("transport-owner.json"))) as! [String: Any]
        ownedPID = (newOwner["pid"] as! NSNumber).int32Value
        try require(concurrentWarm.ownerPID == ownedPID && concurrentWarm.taskSubmitted == false,
            "concurrent warm/request used different owners")
        try require(try state(concurrentResult) == "returned_unverified", "concurrent request lost its exact result")
        try require(try Data(contentsOf: privateRoot.appendingPathComponent("boots.json")) == Data("2".utf8), "new generation not started exactly once")
        let concurrentCounts = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("submits.json"))) as! [String: Int]
        try require(concurrentCounts["after_upgrade"] == 1, "concurrent warmup duplicated task submit")
        let oldTask = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("first.json"))) as! [String: Any]
        try require(oldTask["state"] as? String == "returned_unverified", "upgrade discarded durable task state")
        // A dead/replaced original owner is not a reason to start another
        // owner during recovery. This is the fixture's own isolated PID only.
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("observer_owner_mismatch"), configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "lost owner was replaced during recovery"])
        } catch RCCRuntimeGatewayClient.Failure.existingGatewayUnavailable { }
        let ownerReads = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("observer-reads.json"))) as! [String: Int]
        try require(ownerReads["observer_owner_mismatch"] == 1, "recovery queried a different owner")
        try require(try Data(contentsOf: privateRoot.appendingPathComponent("boots.json")) == Data("2".utf8), "recovery launched another owner")
        try Data("mutated".utf8).write(to: plugin.appendingPathComponent("rcc-runtime.mjs"))
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("mutated"), configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "mutated module accepted"])
        } catch RCCRuntimeGatewayClient.Failure.identityMismatch { }
        try require(progress == ["running", "returned_unverified"], "progress not monotonic exact task snapshots")
        passed = true
        print("RCC Runtime Gateway client: offline fake-transport checks PASS; same-task observer timeout/terminal/Stop/source/revision/rejection/owner/budget gates PASS; hosted/model calls 0; live task state untouched")
    }
}
