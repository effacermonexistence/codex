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
    /// Real Core public projection with a synthetic executor, then the real
    /// Swift Gateway parser and UI contract. No OpenClaw/provider/native call.
    static func resourceProjectionFixture(root: URL) throws {
        let fm = FileManager.default
        let runtimeModule = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Resources/openclaw-os1-bridge/rcc-runtime.mjs")
        let node = ProcessInfo.processInfo.environment["OS1_RCC_CONTRACT_NODE"] ??
            fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OS-1/tools/node-v24.20.0/bin/node").path
        let destination = root.appendingPathComponent("actual-core-public.json")
        // Actual Swift GUI-handoff encoding, passed as an opaque string to
        // Node. Do not rebuild it with JS JSON.stringify or erase its metadata.
        let conversation = UUID()
        let context = TaskContext.migrated(conversationID: conversation, request: "1+1", workspace: root.path,
            sourceContext: nil, codexSessionID: nil, claudeSessionID: nil,
            now: Date(timeIntervalSince1970: 1_790_000_000))
        let paging = MemoryPagingReference(conversationID: conversation.uuidString.lowercased(),
            projectID: context.project?.projectID ?? "fixture-project", archivedMessages: 1,
            snapshot: SourceReference(kind: .snapshot, id: UUID(), sha256: hash(Data("synthetic paging snapshot".utf8))),
            allowedSessionIDs: [conversation.uuidString.lowercased()])
        var retained = context
        retained.facts.append(TaskContext.Fact(text: "1+1 denotes a retained retail offer, not a fresh arithmetic request", verified: true))
        let variants: [(String, TaskContext, Int?)] = [("fresh", context, 0), ("prior", context, 1),
            ("retained", retained, 0), ("missing", context, nil)]
        let handoffs = try variants.map { name, state, prior -> [String: String] in
            ["name": name, "conversation_id": conversation.uuidString.lowercased(),
             "raw_context": try SessionHandoff(transcript: "", source: nil, taskContext: state,
                memoryPaging: paging, priorMessageCount: prior).encoded()]
        }
        let swiftContexts = root.appendingPathComponent("actual-swift-contexts.json")
        try JSONSerialization.data(withJSONObject: handoffs).write(to: swiftContexts)
        let source = #"""
        import {createRCCRuntime, hostContextFingerprint} from 'MODULE';
        import {createHash} from 'node:crypto';
        import {readFile,writeFile} from 'node:fs/promises';
        const root=process.argv[1], out=process.argv[2], contextsPath=process.argv[3];
        const timer=setTimeout(()=>process.exit(90),8000);
        const sha=x=>createHash('sha256').update(x).digest('hex');
        const request='SYNTHETIC_RESOURCE_PROJECTION';
        const host={workspace:root,context:null,provider_preference:'auto',codex_session_id:null,
          claude_session_id:null,require_read_only:true,owner_policy:null};
        const task={schema:1,task_id:'resource_projection',request,request_sha256:sha(request),objective:request,
          policy_sha256:sha('synthetic policy'),policy:{source_sha256:sha('synthetic source'),projection_sha256:sha('synthetic policy'),text:'synthetic policy'},
          source_fingerprint:hostContextFingerprint(host),mode:'auto',material_refs:[],
          budget:{max_attempts:1,max_parallel:1,max_cost_units:null,max_duration_ms:3000},host_context:host};
        const now=Date.now();
        const row={id:'synthetic-row',surface:'codex',transport:'codex_app_server',account_id:'synthetic-account',
          model:'synthetic-model',effort:'low',tools:['read','execute'],scope:'read_only',permission_profile:'read_only',
          quota_pool:'openai_codex',allowed_paths:[],configuration_sha256:sha('synthetic config'),availability:'available',
          availability_observed_at_ms:now,availability_valid_until_ms:now+60000,quota_remaining_fraction:.5,
          quota_observed_at_ms:now,quota_valid_until_ms:now+60000,quality_state:'policy_admitted',estimated_cost_units:null};
        const runtime=await createRCCRuntime({hostAutoPlan:true,stateDir:root+'/fake-core',catalog:async()=>({schema:1,task_id:task.task_id,
          request_sha256:task.request_sha256,candidates:[row]}),execute:async t=>({schema:1,task_id:t.task_id,node_id:t.node_id,
          attempt_id:t.attempt_id,candidate_id:t.candidate_id,configuration_sha256:t.configuration_sha256,
          selected_config:t.selected_config,acknowledged_config:t.selected_config,observed_config:null,status:'succeeded',
          dispatch_stage:'dispatched',side_effects:'none',output:'synthetic response',execution_verified:true,
          task_verified:false,task_quality:'execution_only',parity_state:'unverified',native_receipt:root+'/synthetic-receipt.json',
          usage:{input_tokens:17,output_tokens:3,provider_calls:1,metric:'native_usage_observation'},native_summary:'synthetic'})});
        try {await runtime.submit(task);const answer=await runtime.wait({schema:1,task_id:task.task_id},{timeoutMs:5000});
          if(answer.state!=='returned_unverified'||!answer.resource_usage)throw Error('public projection absent: '+answer.state+':'+answer.error);
          await writeFile(out,JSON.stringify(answer),{mode:0o600});
          const localTask={...task,task_id:'resource_local_exact',request:'1+1',objective:'1+1',request_sha256:sha('1+1')};
          const local=await createRCCRuntime({stateDir:root+'/fake-local-core',
            catalog:async()=>{throw Error('local exact must not inspect provider catalog');},
            execute:async()=>{throw Error('local exact must never execute a provider');}});
          try{await local.submit(localTask);const exact=await local.wait({schema:1,task_id:localTask.task_id},{timeoutMs:3000});
            if(exact.state!=='completed')throw Error('local exact did not complete');
            await writeFile(out+'.local.json',JSON.stringify(exact),{mode:0o600});}
          finally{await local.close();}
          const variants=JSON.parse(await readFile(contextsPath,'utf8')),checks=[];
          for(const v of variants){
            let catalogCalls=0,executeCalls=0;
            const h={...host,context:v.raw_context,conversation_id:v.conversation_id};
            const input={...localTask,task_id:'swift_'+v.name,host_context:h,source_fingerprint:hostContextFingerprint(h)};
            const core=await createRCCRuntime({stateDir:root+'/swift-'+v.name,
              catalog:async()=>{catalogCalls++;throw Error('synthetic abstention catalog');},
              execute:async()=>{executeCalls++;throw Error('no actual provider');}});
            try{await core.submit(input);const answer=await core.wait({schema:1,task_id:input.task_id},{timeoutMs:3000});
              const expected=v.name==='fresh';
              if(expected?(answer.state!=='completed'||answer.result?.output!=='2'||catalogCalls!==0||executeCalls!==0):
                (answer.state!=='held'||catalogCalls!==1||executeCalls!==0))throw Error('Swift handoff boundary failed: '+v.name+':'+answer.state);
              await writeFile(out+'.swift-'+v.name+'.json',JSON.stringify(answer),{mode:0o600});
              checks.push({name:v.name,raw_sha256:sha(v.raw_context),catalog_calls:catalogCalls,execute_calls:executeCalls,state:answer.state});
            }finally{await core.close();}
          }
          await writeFile(out+'.swift-checks.json',JSON.stringify(checks),{mode:0o600});}
        finally{await runtime.close();clearTimeout(timer);}
        """#.replacingOccurrences(of: "MODULE", with: runtimeModule.absoluteString)
        let process = Process(), errors = Pipe()
        process.executableURL = URL(fileURLWithPath: node)
        process.arguments = ["--input-type=module", "-e", source, root.path, destination.path, swiftContexts.path]
        process.standardOutput = FileHandle.nullDevice; process.standardError = errors
        try process.run(); process.waitUntilExit()
        let diagnostic = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        try require(process.terminationStatus == 0, "synthetic Core projection failed: " + String(diagnostic.prefix(1_024)))
        let data = try Data(contentsOf: destination)
        let original = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let id = original["task_id"] as! String, requestHash = original["request_sha256"] as! String
        _ = try RCCRuntimeGatewayClient.validateSnapshotForOfflineFixture(data, id: id, requestSHA256: requestHash)
        let typed = try RCCRuntimeContract.decodeSnapshot(data)
        try require(typed.resourceUsage?.nativeTokensObserved == 20 && typed.resourceUsage?.localTokensObserved == 0 &&
                    typed.resourceUsage?.accountingComplete == false && typed.resourceUsage?.totalTokensObserved == nil &&
                    typed.resourceUsage?.issues.contains("local_resource_events_missing_or_unbounded") == true &&
                    typed.result?.taskVerified == false,
                    "resource observation was lost or promoted: " + String(describing: typed.resourceUsage))
        let localData = try Data(contentsOf: URL(fileURLWithPath: destination.path + ".local.json"))
        let localValue = try JSONSerialization.jsonObject(with: localData) as! [String: Any]
        _ = try RCCRuntimeGatewayClient.validateSnapshotForOfflineFixture(localData,
            id: "resource_local_exact", requestSHA256: localValue["request_sha256"] as! String)
        let localTyped = try RCCRuntimeContract.decodeSnapshot(localData)
        try require(localTyped.state == .completed && localTyped.result?.taskVerified == true &&
                    localTyped.result?.nativeReceipt == nil && localTyped.resourceUsage?.accountingComplete == true &&
                    localTyped.resourceUsage?.totalTokensObserved == 0 && localTyped.resourceUsage?.nativeAttempts == 0 &&
                    localTyped.children.first?.selectedConfig?.transport == .local &&
                    localTyped.children.first?.selectedConfig?.model == "none", "Core local exact public projection was rejected or promoted")
        let crossRows = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: destination.path + ".swift-checks.json"))) as! [[String: Any]]
        try require(crossRows.count == handoffs.count, "Swift handoff cases missing")
        for handoff in handoffs {
            let name = handoff["name"]!, expectedID = "swift_" + name
            let bytes = try Data(contentsOf: URL(fileURLWithPath: destination.path + ".swift-" + name + ".json"))
            let typed = try RCCRuntimeContract.decodeSnapshot(bytes)
            _ = try RCCRuntimeGatewayClient.validateSnapshotForOfflineFixture(bytes, id: expectedID, requestSHA256: hash(Data("1+1".utf8)))
            let row = crossRows.first { $0["name"] as? String == name }
            try require(row?["raw_sha256"] as? String == hash(Data(handoff["raw_context"]!.utf8)) && row?["execute_calls"] as? Int == 0,
                        "Swift encoded bytes were changed or native execution occurred")
            if name == "fresh" {
                try require(typed.result?.output == "2" && typed.resourceUsage?.totalTokensObserved == 0 &&
                    typed.resourceUsage?.nativeAttempts == 0 && typed.children.first?.selectedConfig?.transport == .local &&
                    row?["catalog_calls"] as? Int == 0, "actual Swift first-turn handoff did not stay zero-model")
            } else {
                try require(typed.state == .held && typed.result == nil && row?["catalog_calls"] as? Int == 1,
                            "retained/prior/unknown handoff was erased into local exact")
            }
        }
        var checks = 4 + handoffs.count * 2
        func rejects(_ label: String, _ mutate: (inout [String: Any]) -> Void) throws {
            var value = original; mutate(&value)
            do {
                _ = try RCCRuntimeGatewayClient.validateSnapshotForOfflineFixture(
                    JSONSerialization.data(withJSONObject: value), id: id, requestSHA256: requestHash)
            } catch RCCRuntimeGatewayClient.Failure.snapshotInvalid { checks += 1; return }
            throw NSError(domain: "resourceProjection", code: 1, userInfo: [NSLocalizedDescriptionKey: label])
        }
        try rejects("negative usage count") { value in
            var usage = value["resource_usage"] as! [String: Any]; usage["native_attempts"] = -1; value["resource_usage"] = usage
        }
        try rejects("unknown nested field") { value in
            var usage = value["resource_usage"] as! [String: Any]; usage["inferred_bill"] = 0; value["resource_usage"] = usage
        }
        try rejects("inconsistent known total") { value in
            var usage = value["resource_usage"] as! [String: Any]; usage["total_tokens_observed"] = 19; value["resource_usage"] = usage
        }
        try rejects("future quota claim") { value in
            var usage = value["resource_usage"] as! [String: Any]; usage["quota_savings"] = "free"; value["resource_usage"] = usage
        }
        try rejects("null is not typed resource block") { $0["resource_usage"] = NSNull() }
        try rejects("unsupported state") { $0["state"] = "quality_proven" }
        try rejects("unknown top-level field") { $0["made_up_field"] = true }
        try rejects("wrong identity") { $0["task_id"] = "other-task" }
        try rejects("revision cannot regress") { $0["revision"] = -1 }
        var legacy = original; legacy.removeValue(forKey: "resource_usage")
        _ = try RCCRuntimeGatewayClient.validateSnapshotForOfflineFixture(JSONSerialization.data(withJSONObject: legacy),
            id: id, requestSHA256: requestHash)
        checks += 1
        print("RCC resource projection → Gateway: \(checks) strict fake integration checks PASS; actual hosted/native/model calls 0; usage counts synthetic")
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
        try resourceProjectionFixture(root: root)
        if CommandLine.arguments.contains("--resource-projection-only") { passed = true; return }
        let plugin = root.appendingPathComponent("plugin", isDirectory: true)
        try fm.createDirectory(at: plugin, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var pluginHashes: [String: String] = [:]
        for file in ["index.mjs", "openclaw.plugin.json", "package.json", "rcc-runtime.mjs", "rcc-plugin.mjs", "resource-usage.mjs", "adaptive-plan-host.mjs", "adaptive-routing-policy.mjs", "joint-route-selector.mjs", "local-plan-planner.mjs", "local-plan-proposal.mjs", "routing-outcome.mjs", "routing-outcome-capture.mjs", "frozen-route-artifacts.mjs", "frozen-route-predictor.mjs", "offline-route-calibration.mjs", "frozen-route-evidence.mjs", "calibrated-route-evidence.mjs", "calibrated-route-predictor.mjs"] {
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
            if name in ['rejected','witness_rejected','witness_clock_rejected','witness_unknown_rejected']:
                print(json.dumps({'ok':False,'error':{'type':'gateway_request_error','code':'INVALID_REQUEST','message':'idempotency_conflict','retryable':False}})); sys.exit(1)
            obj={'schema':1,'task_id':name,'request_sha256':params['request_sha256'],'state':state,'revision':revision,'children':[],'result':None,'error':None}
            if name.startswith('witness_'):
                obj['state']='returned_unverified'
                obj['result']={'output':'2','execution_verified':True,'task_verified':False,'parity_state':'unverified','native_receipt':None}
            if name=='awaiting_install':
                obj['state']='awaiting_install'
                obj['install_handoff']={'schema':1,'task_id':name,'request_sha256':params['request_sha256'],'node_id':'writer','parent_attempt_id':'attempt','source_fingerprint':'a'*64,'source_root':'/tmp/fixture','source_head':'b'*40,'protected_source_sha256':'c'*64,'staged_intent_id':'fixture-intent','staged_receipt_sha256':'d'*64,'state':'staged','installed_receipt':None}
            write(task,obj)
            if name in ['lost_ack','witness_lost_ack']: sys.exit(2)
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
        // Production opt-in follows independent review. Offline entry points
        // still default OFF; positive reuse is explicitly tested only here.
        try require(RCCRuntimeGatewayClient.enableTaskReadinessWitness &&
            RCCRuntimeGatewayClient.taskReadinessWitnessMaximumAge == 60, "witness source gate/max-age changed")
        let witnessOwner = try JSONSerialization.jsonObject(with:
            Data(contentsOf: privateRoot.appendingPathComponent("transport-owner.json"))) as! [String: Any]
        let witnessDirectory = URL(fileURLWithPath: witnessOwner["directory"] as! String)
        let witnessPath = witnessDirectory.appendingPathComponent("last-successful-health.json")
        func healthCount() throws -> Int {
            try JSONDecoder().decode(Int.self, from: Data(contentsOf: privateRoot.appendingPathComponent("health-probes.json")))
        }
        func runWitness(_ id: String, expectedHealth: Int, enabled: Bool = true) throws {
            let before = try healthCount()
            let answer = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request(id),
                configuration: configuration, root: privateRoot, readinessWitnessEnabled: enabled)
            try require(try state(answer) == "returned_unverified" && healthCount() == before + expectedHealth,
                        "witness health callcount/result mismatch: " + id)
        }
        func refreshWitness() throws {
            _ = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration,
                root: privateRoot, readinessWitnessEnabled: true)
            try require(fm.fileExists(atPath: witnessPath.path), "positive health did not record a witness")
        }
        func writeWitness(_ value: [String: Any]) throws {
            try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: witnessPath)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: witnessPath.path)
        }
        try runWitness("witness_default_off", expectedHealth: 1, enabled: false)
        try require(!fm.fileExists(atPath: witnessPath.path) &&
            !fm.fileExists(atPath: witnessDirectory.appendingPathComponent("health-witness.lock").path),
            "default OFF created witness artifacts")
        try runWitness("witness_first", expectedHealth: 1)
        try runWitness("witness_reused", expectedHealth: 0)
        let warmHealth = try healthCount()
        try refreshWitness()
        try require(try healthCount() == warmHealth + 1, "explicit warm reused stale health")
        let statusHealth = try healthCount()
        _ = try RCCRuntimeGatewayClient.statusForOfflineFixture(taskID: "witness_first",
            requestSHA256: hash(Data("SENSITIVE_FIXTURE_REQUEST_DO_NOT_EXPOSE".utf8)), configuration: configuration, root: privateRoot)
        try require(try healthCount() == statusHealth + 1, "explicit status skipped fresh health")
        let cancelHealth = try healthCount()
        _ = try RCCRuntimeGatewayClient.statusForOfflineFixture(taskID: "witness_first",
            requestSHA256: hash(Data("SENSITIVE_FIXTURE_REQUEST_DO_NOT_EXPOSE".utf8)), configuration: configuration,
            root: privateRoot, cancelling: true)
        try require(try healthCount() == cancelHealth + 1, "explicit cancel skipped fresh health")
        let witnessLock = open(witnessDirectory.appendingPathComponent("health-witness.lock").path, O_RDWR | O_NOFOLLOW)
        try require(witnessLock >= 0 && flock(witnessLock, LOCK_EX | LOCK_NB) == 0, "fixture witness lock unavailable")
        let lockStarted = Date()
        try runWitness("witness_held_lock", expectedHealth: 1)
        try require(Date().timeIntervalSince(lockStarted) < 3, "held advisory lock blocked original fresh-readiness fallback")
        _ = flock(witnessLock, LOCK_UN); _ = close(witnessLock)
        var stale = try JSONSerialization.jsonObject(with: Data(contentsOf: witnessPath)) as! [String: Any]
        // Exercise the uptime-age bound independently. Moving wall time61s
        // back in this young fake owner would instead be a before-owner
        // invalid/foreign fixture, which is deliberately preserved below.
        stale["observedUptime"] = (stale["observedUptime"] as! Double) - 61
        try writeWitness(stale)
        try runWitness("witness_expired", expectedHealth: 1)
        try runWitness("witness_refreshed_after_expiry", expectedHealth: 0)
        let badWitnesses: [(String, (inout [String: Any]) -> Void)] = [
            ("future", { $0["observedUptime"] = ProcessInfo.processInfo.systemUptime + 60 }),
            ("wall_future", { $0["observedUnix"] = Date().timeIntervalSince1970 + 60 }),
            ("before_owner", { $0["observedUnix"] = (witnessOwner["startedAt"] as! Double) - 1 }),
            ("schema", { $0["schema"] = 9 }), ("nonpositive", { $0["healthOK"] = false }),
            ("starting", { $0["notStarting"] = false }), ("unknown_field", { $0["untrusted"] = true }),
            ("numeric_bool", { $0["healthOK"] = 1 }),
            ("owner_pid", { var o = $0["owner"] as! [String: Any]; o["pid"] = 1; $0["owner"] = o }),
            ("owner_start", { var o = $0["owner"] as! [String: Any]; o["startedAt"] = 1.0; $0["owner"] = o }),
            ("owner_executable", { var o = $0["owner"] as! [String: Any]; o["executable"] = "/untrusted"; $0["owner"] = o }),
            ("owner_port", { var o = $0["owner"] as! [String: Any]; o["port"] = 1; $0["owner"] = o }),
            ("owner_directory", { var o = $0["owner"] as! [String: Any]; o["directory"] = "/untrusted"; $0["owner"] = o }),
            ("owner_identity", { var o = $0["owner"] as! [String: Any]; o["identitySHA256"] = String(repeating: "0", count: 64); $0["owner"] = o }),
            ("owner_config", { var o = $0["owner"] as! [String: Any]; o["configurationSHA256"] = String(repeating: "0", count: 64); $0["owner"] = o }),
            ("owner_full_config", { var o = $0["owner"] as! [String: Any]; o["configSHA256"] = String(repeating: "0", count: 64); $0["owner"] = o }),
        ]
        for (name, mutate) in badWitnesses {
            var value = try JSONSerialization.jsonObject(with: Data(contentsOf: witnessPath)) as! [String: Any]
            mutate(&value); try writeWitness(value)
            let original = try Data(contentsOf: witnessPath)
            try runWitness("witness_bad_" + name, expectedHealth: 1)
            try require(try Data(contentsOf: witnessPath) == original, "foreign/invalid witness overwritten: " + name)
            try fm.removeItem(at: witnessPath); try refreshWitness()
        }
        for name in ["malformed", "oversize", "public_mode", "hardlink", "symlink"] {
            let alias = witnessDirectory.appendingPathComponent("fixture-foreign-" + name)
            if name == "malformed" { try Data("{".utf8).write(to: witnessPath) }
            if name == "oversize" { try Data(repeating: 32, count: 4097).write(to: witnessPath) }
            if name == "public_mode" { try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: witnessPath.path) }
            if name == "hardlink" { try require(link(witnessPath.path, alias.path) == 0, "fixture hardlink failed") }
            if name == "symlink" {
                try fm.moveItem(at: witnessPath, to: alias)
                try fm.createSymbolicLink(at: witnessPath, withDestinationURL: alias)
            }
            let original = try Data(contentsOf: witnessPath)
            try runWitness("witness_custody_" + name, expectedHealth: 1)
            try require(try Data(contentsOf: witnessPath) == original, "unknown custody witness modified: " + name)
            if name == "symlink" { try require(try fm.destinationOfSymbolicLink(atPath: witnessPath.path) == alias.path, "foreign symlink replaced") }
            try fm.removeItem(at: witnessPath)
            if fm.fileExists(atPath: alias.path) { try fm.removeItem(at: alias) }
            try refreshWitness()
        }
        // Reject special files before attempting a blocking payload read.
        try fm.removeItem(at: witnessPath)
        try require(mkfifo(witnessPath.path, 0o600) == 0, "fixture FIFO unavailable")
        let fifoStarted = Date()
        try runWitness("witness_fifo", expectedHealth: 1)
        var fifoInfo = stat(); try require(lstat(witnessPath.path, &fifoInfo) == 0 &&
            (fifoInfo.st_mode & S_IFMT) == S_IFIFO && Date().timeIntervalSince(fifoStarted) < 3,
            "foreign FIFO blocked readiness or was replaced")
        try fm.removeItem(at: witnessPath); try refreshWitness()
        // Unknown witness bytes are not authority for failure revocation.
        // Negative ACK still preserves the existing rejection/no-replay path.
        let malformedWitness = Data("{".utf8)
        try malformedWitness.write(to: witnessPath)
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("witness_unknown_rejected"),
                configuration: configuration, root: privateRoot, readinessWitnessEnabled: true)
            throw NSError(domain: "fixture", code: 1)
        } catch RCCRuntimeGatewayClient.Failure.rpcRejected { }
        try require(try Data(contentsOf: witnessPath) == malformedWitness &&
            !fm.fileExists(atPath: witnessDirectory.appendingPathComponent("health-witness-owner-disabled").path),
            "unknown witness failure mutated optional generation state")
        try fm.removeItem(at: witnessPath); try refreshWitness()
        // Revoke even if clock rollback rejects reuse AND another observer
        // holds the optional lock. Failure must not revive on time recovery.
        let barrierPath = witnessDirectory.appendingPathComponent("health-witness-owner-disabled")
        var clockFuture = try JSONSerialization.jsonObject(with: Data(contentsOf: witnessPath)) as! [String: Any]
        let recoverUptime = ProcessInfo.processInfo.systemUptime + 3
        clockFuture["observedUptime"] = recoverUptime
        clockFuture["observedUnix"] = Date().timeIntervalSince1970 + 3
        try writeWitness(clockFuture)
        let futureBytes = try Data(contentsOf: witnessPath)
        let failureLock = open(witnessDirectory.appendingPathComponent("health-witness.lock").path, O_RDWR | O_NOFOLLOW)
        try require(failureLock >= 0 && flock(failureLock, LOCK_EX | LOCK_NB) == 0, "fixture failure lock unavailable")
        let beforeClockFailure = try healthCount(), failureStarted = Date()
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("witness_clock_rejected"),
                configuration: configuration, root: privateRoot, readinessWitnessEnabled: true)
            throw NSError(domain: "fixture", code: 1)
        } catch RCCRuntimeGatewayClient.Failure.rpcRejected { }
        try require(try healthCount() == beforeClockFailure + 1 && Data(contentsOf: witnessPath) == futureBytes &&
            fm.fileExists(atPath: barrierPath.path) && Date().timeIntervalSince(failureStarted) < 3,
            "held-lock/future-clock failure stalled or failed to disable owner reuse")
        _ = flock(failureLock, LOCK_UN); _ = close(failureLock)
        let barrierBytes = try Data(contentsOf: barrierPath)
        try await Task.sleep(for: .seconds(max(0, recoverUptime - ProcessInfo.processInfo.systemUptime + 0.05)))
        try runWitness("witness_clock_recovered", expectedHealth: 1)
        try runWitness("witness_clock_sticky", expectedHealth: 1)
        try require(try Data(contentsOf: witnessPath) == futureBytes && Data(contentsOf: barrierPath) == barrierBytes,
            "fresh health cleared sticky barrier or refreshed the failed owner witness")
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("witness_rejected"),
                configuration: configuration, root: privateRoot, readinessWitnessEnabled: true)
            throw NSError(domain: "fixture", code: 1)
        } catch RCCRuntimeGatewayClient.Failure.rpcRejected { }
        try require(!fm.fileExists(atPath: witnessPath.path), "negative ACK did not archive known witness")
        // A barrier with unknown content still denies caching and is never
        // overwritten or cleared by fresh health or failure invalidation.
        let unknownBarrier = Data("unknown pre-existing generation barrier".utf8)
        try unknownBarrier.write(to: barrierPath)
        _ = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration,
            root: privateRoot, readinessWitnessEnabled: true)
        try runWitness("witness_lost_ack", expectedHealth: 1)
        try runWitness("witness_unknown_barrier", expectedHealth: 1)
        try require(!fm.fileExists(atPath: witnessPath.path) && (try Data(contentsOf: barrierPath)) == unknownBarrier,
            "unknown barrier was cleared/overwritten or failed generation witness reissued")
        // Reuse never skips the current private full-config digest check.
        let currentConfig = witnessDirectory.appendingPathComponent("config.json")
        let originalConfig = try Data(contentsOf: currentConfig)
        let beforeConfigTamper = try healthCount()
        try Data("{}".utf8).write(to: currentConfig)
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("witness_live_config_tamper"),
                configuration: configuration, root: privateRoot, readinessWitnessEnabled: true)
            throw NSError(domain: "fixture", code: 1)
        } catch RCCRuntimeGatewayClient.Failure.privateStateInvalid { }
        try originalConfig.write(to: currentConfig)
        try require(try healthCount() == beforeConfigTamper, "current config mismatch sent a health/submit")
        let concurrentHealth = try healthCount()
        let witnessConcurrentRequest = try request("witness_concurrent")
        let witnessWarmTask = Task.detached {
            try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration, root: privateRoot,
                readinessWitnessEnabled: true)
        }
        let witnessRunTask = Task.detached {
            try RCCRuntimeGatewayClient.runForOfflineFixture(request: witnessConcurrentRequest,
                configuration: configuration, root: privateRoot, readinessWitnessEnabled: true)
        }
        _ = try await witnessWarmTask.value; _ = try await witnessRunTask.value
        try require(try healthCount() == concurrentHealth + 2, "sticky generation skipped fresh health during concurrent warm/task")
        let witnessCounts = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("submits.json"))) as! [String: Int]
        try require(witnessCounts.filter { $0.key.hasPrefix("witness_") }.allSatisfy { $0.value == 1 },
            "negative/lost/concurrent witness path duplicated submit")
        print("RCC readiness witness: productionON/fixtureDefaultOFF, exact health callcounts, invalid/foreign preservation, explicit warm/status/cancel, sticky failure barrier, rejection/loss and concurrency PASS; synthetic transport only")
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
        _ = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration,
            root: privateRoot, readinessWitnessEnabled: true)
        try require(fm.fileExists(atPath: barrierPath.path) && !fm.fileExists(atPath: witnessPath.path),
            "fresh warm cleared disabled owner generation")
        try Data("busy".utf8).write(to: privateRoot.appendingPathComponent("busy"))
        do {
            _ = try RCCRuntimeGatewayClient.quiesceForOfflineFixture(configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "active Gateway stopped"])
        } catch RCCRuntimeGatewayClient.Failure.upgradeNotQuiescent { }
        try require(!fm.fileExists(atPath: witnessPath.path), "quiesce recreated disabled readiness witness")
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
        // Only actual retirement/replacement creates a different generation.
        // Its fresh positive health may issue/reuse its own private witness;
        // the previous generation's unknown barrier remains unchanged.
        let newWitnessDirectory = URL(fileURLWithPath: newOwner["directory"] as! String)
        let newWitnessPath = newWitnessDirectory.appendingPathComponent("last-successful-health.json")
        try require(newWitnessDirectory != witnessDirectory, "owner generation directory was reused")
        _ = try RCCRuntimeGatewayClient.warmForOfflineFixture(configuration: configuration,
            root: privateRoot, readinessWitnessEnabled: true)
        try require(fm.fileExists(atPath: newWitnessPath.path) &&
            !fm.fileExists(atPath: newWitnessDirectory.appendingPathComponent("health-witness-owner-disabled").path),
            "new owner inherited disabled cache generation")
        try runWitness("witness_new_generation", expectedHealth: 0)
        try require(try Data(contentsOf: barrierPath) == unknownBarrier, "retirement deleted unknown old-generation barrier")
        try Data("busy".utf8).write(to: privateRoot.appendingPathComponent("busy"))
        do {
            _ = try RCCRuntimeGatewayClient.quiesceForOfflineFixture(configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1)
        } catch RCCRuntimeGatewayClient.Failure.upgradeNotQuiescent { }
        try require(!fm.fileExists(atPath: newWitnessPath.path) &&
            fm.fileExists(atPath: newWitnessDirectory.appendingPathComponent("health-witness-owner-disabled").path) &&
            kill(ownedPID!, 0) == 0, "quiescence failed to revoke positive witness or signalled busy owner")
        try fm.removeItem(at: privateRoot.appendingPathComponent("busy"))
        // A dead/replaced original owner is not a reason to start another
        // owner during recovery. This is the fixture's own isolated PID only.
        do {
            _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("observer_owner_mismatch"), configuration: configuration, root: privateRoot)
            throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "lost owner was replaced during recovery"])
        } catch RCCRuntimeGatewayClient.Failure.existingGatewayUnavailable { }
        let ownerReads = try JSONSerialization.jsonObject(with: Data(contentsOf: privateRoot.appendingPathComponent("observer-reads.json"))) as! [String: Int]
        try require(ownerReads["observer_owner_mismatch"] == 1, "recovery queried a different owner")
        try require(try Data(contentsOf: privateRoot.appendingPathComponent("boots.json")) == Data("2".utf8), "recovery launched another owner")
        func fixtureConfiguration(_ hashes: [String: String]) -> RCCRuntimeGatewayClient.Configuration {
            .init(identity: .init(nodePath: identity.nodePath, nodeSHA256: identity.nodeSHA256,
                entryPath: identity.entryPath, entrySHA256: identity.entrySHA256,
                pluginDirectory: identity.pluginDirectory, pluginFileSHA256: hashes,
                nativeOS1Path: identity.nativeOS1Path, nativeOS1SHA256: identity.nativeOS1SHA256),
                baseConfig: configuration.baseConfig, bridgeEnvironment: configuration.bridgeEnvironment)
        }
        var missingCompanion = pluginHashes
        missingCompanion.removeValue(forKey: "routing-outcome-capture.mjs")
        var extraCompanion = pluginHashes
        extraCompanion["unreviewed.mjs"] = hash(Data("not admitted".utf8))
        for hashes in [missingCompanion, extraCompanion] {
            do {
                _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("invalid-required-module-set"),
                    configuration: fixtureConfiguration(hashes), root: privateRoot)
                throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "nonclosed module identity accepted"])
            } catch RCCRuntimeGatewayClient.Failure.identityMismatch { }
        }
        // Each signed companion is part of the same owner identity. Hash or
        // required-set failure happens before any fixture transport can run.
        for name in ["adaptive-plan-host.mjs", "adaptive-routing-policy.mjs", "joint-route-selector.mjs", "local-plan-planner.mjs", "local-plan-proposal.mjs", "routing-outcome.mjs", "routing-outcome-capture.mjs", "frozen-route-artifacts.mjs", "frozen-route-predictor.mjs", "offline-route-calibration.mjs", "frozen-route-evidence.mjs", "calibrated-route-evidence.mjs", "calibrated-route-predictor.mjs"] {
            let file = plugin.appendingPathComponent(name), original = try Data(contentsOf: file)
            try Data("mutated companion".utf8).write(to: file)
            do {
                _ = try RCCRuntimeGatewayClient.runForOfflineFixture(request: request("mutated-companion"), configuration: configuration, root: privateRoot)
                throw NSError(domain: "fixture", code: 1, userInfo: [NSLocalizedDescriptionKey: "mutated companion accepted"])
            } catch RCCRuntimeGatewayClient.Failure.identityMismatch { }
            try original.write(to: file)
        }
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
