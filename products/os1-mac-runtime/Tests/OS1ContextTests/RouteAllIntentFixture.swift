import Foundation
import OS1Context

/// Build 381 incident (task ac5a5fd6): "너 라우팅 할 수 있는 쪽으로 최대한 다 라우팅
/// 해봐. 엄청 간단한 알제브라 계산 있잖아.\n뭐 원플러스원 투플러스투 이런 거 있잖아."
/// named no surface, ran on Auto as ONE task and escalated to gpt-6-astra/max.
/// A route-all order is an explicit route test on every available surface,
/// one exact expression each; never a single worker task.
func runRouteAllIntentFixtures() throws {
    try RouteAllIntent.selfTest()
    var count = 0
    func check(_ value: Bool, _ message: String) { precondition(value, "Route-all: " + message); count += 1 }
    let incident = "너 라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐. 엄청 간단한 알제브라 계산 있잖아.\n뭐 원플러스원 투플러스투 이런 거 있잖아."
    check(RouteFanout.plan(incident) == nil, "the named-part parser still finds nothing to split (no surface is named)")
    guard let plan = RouteAllIntent.plan(incident, available: RouteAllIntent.surfaceOrder) else {
        preconditionFailure("Route-all: the incident has no plan")
    }
    check(plan.routes.map(\.surface) == [.local, .codex, .claude, .claudeChat], "every execution surface, local first")
    check(plan.routes.map(\.instruction) == ["1+1", "2+2", "1+1", "2+2"], "the owner's expressions, round robin")
    check(plan.routes.allSatisfy { RCCDelegatedEnvelope.exactArithmeticInstruction($0.instruction) },
          "every route is in the exact verifier's arithmetic family")
    check(plan.routes.allSatisfy { !$0.instruction.contains("라우팅") }, "no route carries the routing order")
    // The host contract accepts the routes as an explicit route test.
    let host = RCCRuntimeContract.HostContext(workspace: "/tmp", context: nil, providerPreference: "auto",
        codexSessionID: nil, claudeSessionID: nil, requireReadOnly: true, ownerPolicy: nil, explicitRoutes: plan.routes)
    check((try? RCCRuntimeContract.validate(host)) != nil, "host context with the four routes validates")
    check(RouteAllIntent.plan(incident, available: [.claudeChat, .local])?.routes.map(\.surface) == [.local, .claudeChat],
          "route order is fixed, not the order availability was listed in")
    // End to end across the wire: the Swift builder's catalog (with its local
    // row) and the Swift routes run through the REAL Node Core, the plugin's
    // local executor and the exact verifier (fake completion and fake native
    // records: no model or provider), and the snapshot decodes and projects here.
    typealias B = RCCNativeCatalogBuilder
    let taskID = "task-route-all-" + UUID().uuidString.lowercased()
    var input = B.Input(taskID: taskID, requestSHA256: RCCRuntimeContract.digest(Data(incident.utf8)), request: incident,
        providerPreference: "auto", requireReadOnly: true, hasMaterialRefs: false,
        capacityPlan: .init(codex: 30, claude: 100), executorContractSHA256: String(repeating: "c", count: 64),
        now: Date(), showCodex: true, chatLaneEligible: true,
        profiles: [.init(action: "a", provider: "codex", model: "gpt-6-luna", effort: "low"),
                   .init(action: "b", provider: "codex", model: "gpt-6-astra", effort: "max"),
                   .init(action: "c", provider: "claude", model: "claude-sonnet-5-5", effort: "low"),
                   .init(action: "d", provider: "claude", model: "claude-fable-5-1", effort: "max")])
    input.codexModels = [.init(slug: "gpt-6-astra", supportedEfforts: ["low", "max"], priority: 0),
                         .init(slug: "gpt-6-luna", supportedEfforts: ["low", "max"], priority: 1)]
    input.claudeModels = [.init(model: "claude-fable-5-1", supportedEfforts: ["low", "max"]),
                          .init(model: "claude-sonnet-5-5", supportedEfforts: ["low", "max"])]
    input.auth = ["codex": .subscription, "claude": .subscription]
    input.accountIDs = ["codex": "acct-codex", "claude": "acct-claude"]
    for (provider, account) in [("codex", "acct-codex"), ("claude", "acct-claude")] {
        let quota = BackendHealth.QuotaSnapshot(accountID: account, observedAt: Date().addingTimeInterval(-5), source: .codexNative,
            windows: [.init(bucket: "primary", usedPercent: 20, resetsAt: Date().addingTimeInterval(3_600))])
        if provider == "codex" { input.codexQuota = quota } else { input.claudeQuota = quota }
    }
    input.explicitRouteSurfaces = plan.routes.map(\.surface.rawValue)
    input.explicitRouteIntents = plan.routes.map { RoutingIntent.parse($0.instruction) }
    input.localModel = .init(ready: true, at: Date())
    let catalogData = try B.catalogData(B.build(input), taskID: taskID, requestSHA256: input.requestSHA256)
    let wire = try JSONSerialization.data(withJSONObject: [
        "task_id": taskID, "request": incident,
        "routes": plan.routes.map { ["surface": $0.surface.rawValue, "instruction": $0.instruction] },
        "catalog": try JSONSerialization.jsonObject(with: catalogData)])
    let snapshotBytes = try routeAllNodeRun(wire)
    let snapshot = try RCCRuntimeContract.decodeSnapshot(snapshotBytes)
    check(snapshot.state == .completed && snapshot.result?.taskVerified == true,
          "the real Core completes and verifies the four routes (state \(snapshot.state.rawValue), error \(snapshot.error ?? "none"))")
    check(snapshot.children.map { $0.selectedConfig?.surface } == [.local, .codex, .claude, .claudeChat] &&
          snapshot.children.map(\.requestedSurface) == [.local, .codex, .claude, .claudeChat],
          "each route ran on the surface it was routed to")
    check(snapshot.children.first?.selectedConfig?.model == B.localWorkerModel &&
          snapshot.children.first?.routingDecision?.reason == "resolver;route_explicit;explicit_route_surface_local;class_trivial;local_model",
          "the local route ran on the local model, bound explicitly")
    check(snapshot.children.dropFirst().allSatisfy { !["gpt-6-astra", "claude-fable-5-1"].contains($0.selectedConfig?.model ?? "") },
          "no route ran on a frontier max reference: the trivial answers stayed cheap")
    check(snapshot.result?.output == "requested-1: 2\n\nrequested-2: 4\n\nrequested-3: 2\n\nrequested-4: 4",
          "each route's own answer is returned")
    let graph = try RCCRuntimeProjection.project(snapshot, conversationID: UUID(), submissionID: UUID(), objective: incident,
        observedAt: Date(), firstObservedAt: Date().addingTimeInterval(-600), maxParallelism: 4,
        expectedRequestSHA256: input.requestSHA256)
    check(["Local · 1+1", "Codex · 2+2", "Claude Code · 1+1", "Claude chat · 2+2"].allSatisfy { title in
        graph.nodes.contains { $0.title == title } }, "the task graph names every surface with its own expression")
    print("Route-all intent: \(count) checks passed (incident, number table, negatives, unsupported holds, real Node Core)")
}

/// Runs the incident through the real Node Core and plugin executor with a
/// fake local completion and fake native records; returns the final snapshot.
private func routeAllNodeRun(_ input: Data) throws -> Data {
    let bridge = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().appendingPathComponent("Resources/openclaw-os1-bridge")
    let script = """
    import {pathToFileURL} from 'node:url';
    import {readFileSync} from 'node:fs';
    import {chmod, mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    import {createHash, randomUUID} from 'node:crypto';
    const {createRCCRuntime, hostContextFingerprint} = await import(pathToFileURL(process.argv[1]).href);
    const {localModelExecutor, verifyExactExplicitArithmetic} = await import(pathToFileURL(process.argv[2]).href);
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const root = await realpath(await mkdtemp(join(tmpdir(), 'rcc-swift-route-all-')));
    await chmod(root, 0o700);
    const sha = s => createHash('sha256').update(s).digest('hex');
    const exact = s => String(s.split('+').reduce((sum, value) => sum + Number(value), 0));
    try {
      const host = {workspace: root, context: null, provider_preference: 'auto', codex_session_id: null,
        claude_session_id: null, require_read_only: true, owner_policy: null, explicit_routes: input.routes};
      const policy = 'route-all fixture policy';
      const task = {schema: 1, task_id: input.task_id, request: input.request, request_sha256: sha(input.request),
        objective: input.request, policy_sha256: sha(policy), source_fingerprint: hostContextFingerprint(host),
        mode: 'explicit_routing_test', material_refs: [],
        budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60000}, host_context: host,
        policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policy), text: policy}};
      const local = localModelExecutor({stateDir: root, complete: async request => ({provider: 'ollama',
        model: 'qwen3.5:4b', stopReason: 'stop', execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}},
        usage: {inputTokens: 20, outputTokens: 1}, text: exact(request.messages[0].content)})});
      const native = async ticket => {
        const directory = join(root, 'native-receipts');
        await mkdir(directory, {recursive: true, mode: 0o700}); await chmod(directory, 0o700);
        const path = join(directory, randomUUID() + '.json');
        const record = {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
          candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
          selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
          status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output: exact(ticket.instruction),
          execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
          native_receipt: path, usage: {input_tokens: 4, output_tokens: 1}, native_summary: null};
        await writeFile(path, JSON.stringify(record), {flag: 'wx', mode: 0o600});
        return record;
      };
      const runtime = await createRCCRuntime({stateDir: root, catalog: async () => input.catalog,
        plan: async () => ({schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
          nodes: input.routes.map((route, index) => ({id: `requested-${index + 1}`, instruction: route.instruction,
            dependencies: [], kind: 'agent', route_class: 'trivial', scope: 'read_only', owned_paths: [], context_refs: []}))}),
        execute: (ticket, signal) => ticket.selected_config.surface === 'local' ? local(ticket, signal) : native(ticket),
        verifyTask: evidence => verifyExactExplicitArithmetic(evidence, {stateDir: root})});
      try {
        let snapshot = await runtime.submit(task); const deadline = Date.now() + 10000;
        while (!['completed', 'returned_unverified', 'failed', 'held', 'effects_uncertain'].includes(snapshot.state)) {
          if (Date.now() > deadline) throw Error('route-all fixture timeout');
          await new Promise(resolve => setTimeout(resolve, 5)); snapshot = runtime.status({schema: 1, task_id: task.task_id});
        }
        process.stdout.write(JSON.stringify(snapshot));
      } finally { await runtime.close(); }
    } finally { await rm(root, {recursive: true, force: true}); }
    """
    let pinnedNode = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    let process = Process(), stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
    if let override = ProcessInfo.processInfo.environment["OS1_RCC_CONTRACT_NODE"] { process.executableURL = URL(fileURLWithPath: override) }
    else if FileManager.default.isExecutableFile(atPath: pinnedNode.path) { process.executableURL = pinnedNode }
    else { process.executableURL = URL(fileURLWithPath: "/usr/bin/env") }
    process.arguments = (process.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        ["--input-type=module", "-e", script, bridge.appendingPathComponent("rcc-runtime.mjs").path,
         bridge.appendingPathComponent("rcc-plugin.mjs").path]
    process.standardInput = stdin; process.standardOutput = stdout; process.standardError = stderr
    try process.run(); try stdin.fileHandleForWriting.write(contentsOf: input); try stdin.fileHandleForWriting.close()
    let output = stdout.fileHandleForReading.readDataToEndOfFile()
    let errors = stderr.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    guard process.terminationStatus == 0, !output.isEmpty else {
        throw NSError(domain: "RouteAllIntentFixture", code: 1, userInfo: [NSLocalizedDescriptionKey:
            "real Node route-all run failed: " + String(decoding: errors.prefix(2_000), as: UTF8.self)])
    }
    return output
}
