#!/usr/bin/env python3
"""Read-only SOURCE ADVISORY for the single OpenClaw owner and sealed resources.

This checks source branch/resource wiring, not runtime reachability, installed
package identity, task completion, quality parity, or a successful model call.
Swift compilation, Node fixtures and installed-path observation are separate
gates. No provider, network, live state, user HOME or other product is touched.
"""
from pathlib import Path
import hashlib
import re

ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "Sources/OS1/main.swift").read_text()
APP = (ROOT / "Sources/OS1App/OS1App.swift").read_text()
FLEET = (ROOT / "Sources/OS1/Fleet.swift").read_text()
BRIDGE = (ROOT / "Sources/OS1/LocalRouterBridge.swift").read_text()
CLIENT = (ROOT / "Sources/OS1/RCCRuntimeGatewayClient.swift").read_text()
SEAL = (ROOT / "Sources/OS1Context/InstalledResourceSeal.swift").read_text()
RELEASE = (ROOT / "scripts/build-release.sh").read_text()
INSTALLER = (ROOT / "scripts/install-os1.sh").read_text()
PLUGIN_ROOT = ROOT / "Resources/openclaw-os1-bridge"
INDEX = (PLUGIN_ROOT / "index.mjs").read_text()
PLUGIN = (PLUGIN_ROOT / "rcc-plugin.mjs").read_text()
RUNTIME = (PLUGIN_ROOT / "rcc-runtime.mjs").read_text()
checks = 0


def check(condition, message):
    global checks
    if not condition:
        raise AssertionError(message)
    checks += 1


def section(text, start, end):
    check(start in text and end in text, "source section exists: " + start)
    return text.split(start, 1)[1].split(end, 1)[0]


for entry, legacy_marker in (("func runTask(", "AttemptLatencyTrace.beginSubmission()"),
                             ("func runWorkflowTask(", "let policy = try loadCurrentOwnerPolicy()")):
    body = section(MAIN, entry, legacy_marker)
    check("return try await runOpenClawRCCTask(" in body,
          "ordinary shared task entry returns to ONE core before legacy coordinator: " + entry)
    check("ParallelAgentRuntime.fixtureHooks == nil" in body and "!ConcurrentRouteFanoutRuntime.child" in body,
          "source fixture/library delegation is separated from ordinary owner requests: " + entry)

cli = section(MAIN, "if !parallelAgentChild && !parallelFanoutChild {", "if surface == .chatgpt {")
check("summary = try await runOpenClawRCCTask(" in cli and "rcc_transport_preserved" in cli and
      "rcc_connection_or_policy_unavailable" in cli and "return" in cli,
      "ordinary CLI success AND transport failure return without legacy route fallback")
check("runTask(" not in cli and "runTaskWithOwnerPolicy(" not in cli,
      "CLI core connection failure never starts another task coordinator")
check("(error as? RCCRuntimeGatewayClient.Failure)?.rawValue" in cli and "rccTransportFailure: code" in cli,
      "ordinary core failures preserve typed sanitized failure instead of raw private stderr")
warmup = section(MAIN, 'case "rcc-warmup":', 'case "rcc-quiesce":')
check("loadCurrentOwnerPolicy()" in warmup and "OwnerPolicyContext.$snapshot.withValue(owner)" in warmup and
      "LocalRouterBridge.rccRuntimeConfiguration()" in warmup and "RCCRuntimeGatewayClient.warm(" in warmup,
      "CLI warmup binds current owner policy and sealed installed configuration")
check("runOpenClawRCCTask" not in warmup and "runTask(" not in warmup and '"provider_calls": 0' in warmup,
      "CLI warmup is health-only and cannot submit a user/provider task")
warm = section(CLIENT, "private static func warmBlocking(", "static func run(request:")
check(warm.count("checkInstallerMaintenance(root: root)") == 2 and "ensureGateway(" in warm and
      "rpc(" not in warm and "submit" not in warm,
      "warmup uses same startup owner and preserves installer gate before and after readiness")
check("startupReadinessBudget: TimeInterval = 60" in CLIENT and
      "var rpc: TimeInterval = 15" in CLIENT and "var observe: TimeInterval = 86_520" in CLIENT,
      "startup readiness is independent of unchanged RPC/model-task observation limits")
seal = section(BRIDGE, "private static func verifyInstalledResourceSeal(", "private static func verifyGatewayPolicyStillCurrent(")
check("InstalledResourceSeal.verify(app: app)" in seal and
      "commandOutput(executable, arguments, timeout: timeout).0" in seal and "timeout: 8" not in seal,
      "installed resource seal uses bounded signature observer rather than eight-second bootstrap cutoff")
check("verificationTimeout = 60" in SEAL and
      '["--verify", "--deep", "--strict", app.path]' in SEAL and '"/usr/bin/codesign"' in SEAL and
      "guard status == 0" in SEAL and "elapsed < TimeInterval(verificationTimeout)" in SEAL,
      "signature flags/status verification retained; invalid or expired result cannot establish seal")
check('"--rcc-task-id"' in APP and '"--request-file"' in APP and '"run"' in APP,
      "GUI passes immutable request bytes and its stable task ID to normal CLI ingress")
check("if summary.rccTransportFailure != nil" in APP and "if let core = summary.rccRuntime" in APP,
      "GUI preserves core transport failure and consumes the core's progress/result snapshot")
check("run = try await runOpenClawRCCTask(" in FLEET and "taskID: assignment.jobID" in FLEET,
      "ordinary Fleet checkout execution submits the same job ID to the core")
check("runTaskWithOwnerPolicy(" not in FLEET and "runWorkflowTask(" not in FLEET,
      "Fleet custody does not introduce a second routing/workflow owner")

check("import { registerRCCRuntime } from './rcc-plugin.mjs';" in INDEX,
      "sealed plugin entry imports the new core lifecycle integration")
register = section(INDEX, "if (process.env.OS1_RCC_RUNTIME === '1') {", "// This modifier")
check("registerRCCRuntime(api);" in register and "return;" in register,
      "runtime mode does not fall through to legacy candidate hook registration")
check("createRCCRuntime" in PLUGIN and "api.registerGatewayMethod('os1.rcc.'" in PLUGIN,
      "Gateway plugin owns the real task loop and typed RPC ingress")
check("'OS1_RCC_RUNTIME'" in BRIDGE or '"OS1_RCC_RUNTIME"' in BRIDGE,
      "runtime configuration explicitly activates its one owner mode")
check("os1.rcc.submit" in CLIENT and "os1.rcc.status" in CLIENT and "os1.rcc.cancel" in CLIENT,
      "transport carries submit/observe/cancel, not a second planner")
check("createRCCRuntime" not in CLIENT and "runTaskWithOwnerPolicy" not in CLIENT,
      "Swift transport never becomes an independent core/scheduler")
check("_validateExecution" in RUNTIME and "selected_config" in RUNTIME and "configuration_sha256" in RUNTIME,
      "same runtime reconciles exact configured execution records")
check("config = try RCCModelResidencyConfiguration.applying(to: config)" in BRIDGE and
      'defaults["models"] as!' not in BRIDGE and
      "OLLAMA_KEEP_ALIVE" not in BRIDGE,
      "finite private RCC residency uses the actual optional-constructor helper, never a template forced cast")
native = section(MAIN, "private func rccNativeAdapter(", "func runOpenClawRCCTask(")
preparation = section(native, "let observations = try RCCNativePreparation.collect(", "let supported = ")
check('provider: provider, codex: {' in preparation and '}, claude: {' in preparation and
      preparation.index("ModelAvailability.codexCatalog(") < preparation.index("}, claude: {") <
      preparation.index("ModelAvailability.claudeCatalogs(") < preparation.index("ModelAvailability.claudeQuota("),
      "native preparation probes only the selected provider through mutually exclusive readers")
check("providerQuotaContext(codex: observations.codex?.quotaSnapshot, claude: observations.claude?.quota," in native and
      native.count("ModelAvailability.claudeQuota(") == 1 and native.count("ModelAvailability.codexCatalog(") == 1,
      "native admission keeps fresh selected quota without an unrelated provider re-probe")
check("try ModelAvailability.codexCatalog(" in preparation and "try ModelAvailability.claudeCatalogs(" in preparation and
      "try?" not in preparation and 'source: "unavailable"' not in preparation and
      "inventoryObserved: !catalogs.configured.isEmpty" in preparation and
      native.count("catalogProvedUnavailable = observations.codex != nil || observations.claude?.inventoryObserved == true") == 1,
      "metadata failures propagate; only observed catalog evidence, not Claude's empty cooldown shortcut, proves tuple absence")
authorization = section(native, "timing.mark(.authorizationStarted)", "var custody = OS1AttemptSourceState()")
authorization_steps = ["timing.mark(.credentialStarted)", "let credential = try githubToken()", "timing.mark(.credentialReady)",
    "timing.mark(.deviceIdentityStarted)", "let authorizationDeviceID = try deviceID()", "timing.mark(.deviceIdentityReady)",
    "timing.mark(.authorizationHTTPStarted)", 'post("/v1/execution-authorizations"', "timing.mark(.authorizationHTTPReturned)",
    "timing.mark(.ticketVerificationStarted)", "try verifyTicket(signed, config: config, requiresStartupContract: true)",
    "guard signed.provider == provider", "timing.mark(.ticketVerified)", "record.acknowledgedConfig = t.selectedConfig",
    "timing.mark(.authorizationReady)"]
check(all(step in authorization for step in authorization_steps) and
      [authorization.index(step) for step in authorization_steps] == sorted(authorization.index(step) for step in authorization_steps),
      "credential, device, HTTP and verified-ticket phases surround the unchanged exact authorization gates")
check("timing.recordFailure(category: diagnosticCategory, httpStatus: diagnosticHTTPStatus," in native and
      "nsErrorCode: (error as NSError).code)" in native and
      native.index("timing.recordFailure(") < native.index("timing.mark(.attemptFailed)") and
      "case .service(let status, _, _)" in native and "authorizationRefused = true" not in native,
      "safe first-failure phase and bounded codes are captured before failure/persistence; opaque HTTP400 is not model refusal")
check("let report = RCCNativePreparation.preserveFailureBoundary(observedReport," in native and
      "catalogProvedUnavailable: catalogProvedUnavailable)" in native and
      native.index("let report = RCCNativePreparation.preserveFailureBoundary(") < native.index("record.error = report.error"),
      "predispatch error boundary is normalized without changing execution receipt schema or authorizing a retry")
PREPARATION = (ROOT / "Sources/OS1Context/RCCNativePreparation.swift").read_text()
OUTCOME = (ROOT / "Sources/OS1Context/RCCNativeAttemptOutcome.swift").read_text()
diagnostic = section(PREPARATION, "public func recordFailure(", "/// The existing private runtime root")
check("category: ErrorCategory" in diagnostic and "httpStatus: Int?" in diagnostic and "nsErrorCode: Int?" in diagnostic and
      "guard failure == nil" in diagnostic and "(100...599).contains($0)" in diagnostic and
      not any(term in diagnostic for term in ["localizedDescription", "userInfo", "NSError", "URL(", "Error)"]),
      "private diagnostics accept finite categories and numeric codes only, never arbitrary errors, bodies or credentials")
check('preDispatchFailed = "native_pre_dispatch_failed"' in OUTCOME and
      'verifiedConfigurationUnavailable = "native_configuration_unavailable"' in OUTCOME and
      'configurationUnavailable = "native_configuration_or_authorization_unavailable"' in OUTCOME and
      "catalogProvedUnavailable ? RCCNativeAttemptOutcome.verifiedConfigurationUnavailable" in PREPARATION,
      "new catalog-negative and predispatch labels remain distinct from historical mixed receipts")
check("RCCNativePreparationTiming(taskID: t.taskID, nodeID: t.nodeID, attemptID: t.attemptID," in native and
      "configurationSHA256: t.configurationSHA256, sourceFingerprint: t.sourceFingerprint, provider: provider)" in native and
      "try? timing.persist(root: root.deletingLastPathComponent(), receiptPersisted: receiptPersisted," in native and
      "executionStatus: record.status.rawValue, executionVerified: record.executionVerified)" in native,
      "optional timing record is attempt/config/source bound and cannot rewrite execution outcome")
check(all("timing.mark(." + phase + ")" in native for phase in ["inventoryStarted", "inventoryReady",
          "authorizationStarted", "authorizationReady", "workspaceHashStarted", "workspaceHashReady",
          "executeStarted", "executeReturned", "attemptFailed", "receiptPersistStarted", "receiptPersisted"]) and
      native.index("timing.mark(.receiptPersistStarted)") < native.index("RCCRuntimeContract.encode(record)") <
      native.index('"RCC native receipt readback failed"') < native.index("receiptPersisted = true"),
      "phase timings surround existing checks and mark receipt persistence only after its unchanged readback gate")
check("input.completionFeedback = PublicCompletionFeedback(" in native and
      "objectiveSHA256: sha256Hex(Data(objective.utf8)), observations: []" in native,
      "first native attempt explicitly binds empty feedback to its immutable authorization objective")
check(native.index("input.completionFeedback = PublicCompletionFeedback(") <
      native.index("let request = StartExecutionRequest(task: objective") <
      native.index('post("/v1/execution-authorizations"'),
      "task-bound feedback is present before exact-profile admission; no fake prior quality observations")
# Build 381: one delegated envelope for every provider. Work first with its
# binding rules, the owner request as delimited background whose constraints
# still bind, ids last as audit references; the direct lead and answer-only
# line only for a read-only child in the exact verifier's arithmetic family
# (or a chat lane for the lead), carried into the developer/system channel.
ENVELOPE = (ROOT / "Sources/OS1Context/RCCDelegatedEnvelope.swift").read_text()
CONTRACT = (ROOT / "Sources/OS1Context/OutputContract.swift").read_text()
check("let answerOnly = !isFullAccess && RCCDelegatedEnvelope.answerOnly(instruction: t.instruction," in native and
      "surface: t.selectedConfig.surface, scope: t.selectedConfig.scope, explicitRoutes: h.explicitRoutes)" in native and
      "let delegated = RCCDelegatedEnvelope.prompt(instruction: t.instruction, ownerRequest: objective," in native and
      "answerOnly: answerOnly, surface: t.selectedConfig.surface," in native and
      "scope: t.selectedConfig.scope, sourceCompletion: sourceCompletion," in native and
      "taskID: t.taskID, nodeID: t.nodeID, attemptID: t.attemptID)" in native,
      "every provider's child message comes from the one envelope with scope, surface, source rules and ids")
check("ORIGINAL OWNER OBJECTIVE" not in native and "DELEGATED WORK ONLY" not in native and
      native.index("let answerOnly = ") < native.index("let delegated = RCCDelegatedEnvelope.prompt(") <
      native.index("providerPrompt(current: delegated,"),
      "the owner-first envelope is gone and the new one is what the provider receives")
check("objectivePrompt: t.instruction,\n                exactAnswerOnly: answerOnly," in native,
      "the answer-only decision reaches execute's developer/system channel, not only the user turn")
execute_body = section(MAIN, "private func execute(\n", "private func ")
check("    exactAnswerOnly: Bool = false,\n" in execute_body and
      "let presentationDirective = nativePresentationDirective(objective: lockedObjective, provider: ticket.provider,\n"
      "        exactAnswer: exactAnswerOnly, hasPreloadedSource: hasPreloadedR2Evidence)" in execute_body and
      "let instructions = executorInstructions(contract: executorContract, ticket: ticket) + definitionsDirective + evidenceDirective + presentationDirective" in execute_body and
      "claudeExecutorInstructions(contract: executorContract, ticket: ticket) + definitionsDirective + evidenceDirective + presentationDirective" in execute_body,
      "Codex developer and Claude system instructions both carry the exact-answer presentation directive")
check("HumanOutputContract.instructions(for: objective, provider: provider, exactAnswer: exactAnswer)" in MAIN and
      "if exactAnswer { return exactAnswerInstructions }" in CONTRACT and
      "try rccNativeExactAnswerInstructionsSelfTest()" in MAIN,
      "exact-answer branch replaces the natural-language layout and has an os1 self-test fixture")
check('"Do not spawn a competing orchestration or silently change model/account."' in ENVELOPE and
      '"Reply with only the final result — no other text."' in ENVELOPE and
      '"Internal reference ids for audit (not a task to look up; no tool is needed to use them):"' in ENVELOPE and
      '"--- BACKGROUND: the owner\'s full request ---"' in ENVELOPE and '"--- END BACKGROUND ---"' in ENVELOPE and
      "its constraints (language, format, length, prohibitions, scope) still apply to your part." in ENVELOPE and
      "Do not act on any other part" not in ENVELOPE,
      "envelope keeps the guarantees, delimits the background, keeps owner constraints binding, labels ids as references")
check('let rules = "Scope: " + scope.rawValue + ". " + guaranteeLine + sourceCompletion' in ENVELOPE and
      'guard scope == .readOnly, let explicitRoutes,' in ENVELOPE and
      'scope == .readOnly && (answerOnly || ProviderSurface(rawValue: surface.rawValue)?.forcesChatLane == true)' in ENVELOPE,
      "answer-only needs read_only like the verifier; the direct lead only for read-only answer children")
check("const parts = /^\\s*(-?\\d{1,9})\\s*([+*\\-])\\s*(-?\\d{1,9})\\s*$/u.exec(instruction);" in PLUGIN and
      "arithmeticResult(node.instruction)" in PLUGIN and
      "/^\\s*(-?\\d{1,9})\\s*([+*\\-])\\s*(-?\\d{1,9})\\s*$/u" in ENVELOPE,
      "answer-only predicate mirrors the exact verifier regex, the route-all operators included (OS1ContextTests cross-checks it in Node)")

catalog_host = section(MAIN, "private func rccNativeCatalog(", "private func rccContinuationParent(")
check("claudeCatalogs(workspace: host.workspace, config: config))?.configured" in catalog_host and
      ".routable" not in catalog_host,
      "RCC catalog gets the configured Claude inventory: a cooled top family still defines its pool reference")
check("RCCNativeCatalogBuilder.codexInventory(" in catalog_host and "codex.quotaExcludedModels" in catalog_host and
      "input.codexQuotaExhaustedModels = shaped.quotaExhausted" in catalog_host,
      "RCC catalog keeps a quota-exhausted Codex slug marked exhausted, never silently stripped")

# Core-owned intent interpretation: compiler functions are pure native code;
# OS1 transport submits raw input only, and the same task owns its lifecycle.
ingress = section(MAIN, "func runOpenClawRCCTask(", "\n}")
check("mode: .auto" in ingress and "explicitRoutes: nil" in ingress and
      "request: prompt" in ingress and "objective: prompt" in ingress,
      "ingress submits original input/settings once, not a precomputed semantic plan")
check(all(name not in ingress for name in ["RouteFanout.plan", "interpretRoutingOrder(",
      "ollamaAsk", "routeAllRouting(", "BackendHealth.load", "localModelReady()"]),
      "ingress has no interpreter, availability selector or pre-Core semantic hold")
check('case "rcc-intent":' in MAIN and 'RCCCoreRoutingCompiler.compileEnvelope(rccPrivateInput(arguments[2]))' in MAIN,
      "native bridge exposes only pure source-bound intent compilation")
check("routingIntentResolver" in PLUGIN and "resolveIntent: routingIntentResolver({stateDir," in PLUGIN and
      "api.runtime.llm.complete(request)" in PLUGIN and "model_schema_json" in PLUGIN,
      "same OpenClaw service performs optional intent completion with original schema order")
check("snapshot.intent_resolution" in RUNTIME and "snapshot.effective_task" in RUNTIME and
      "executionTask(snapshot)" in RUNTIME and "intent_resolution_invalid" in RUNTIME,
      "original task and source-bound derivation stay separate across execution")
check("this.intentControllers" in RUNTIME and "intent_cancelled" in PLUGIN and
      "intent_resolution_timeout" in RUNTIME,
      "intent operation belongs to Core cancellation and bounded lifetime")
plan_activity = section(MAIN, "if plannerActivity.firstEngagement(state)", "if let graph")
check("model: nil, effort: nil" in plan_activity and "OpenClaw execution plan is ready" in plan_activity and
      "RCCNativeCatalogBuilder.localWorkerModel" not in plan_activity,
      "a deterministic DAG does not fabricate planner-model execution in UI activity")
pins = {
    "index.mjs": "pinnedPluginIndexSHA256",
    "openclaw.plugin.json": "pinnedPluginManifestSHA256",
    "package.json": "pinnedPluginPackageSHA256",
    "rcc-runtime.mjs": "rccRuntimeModuleSHA256",
    "rcc-plugin.mjs": "rccRuntimePluginSHA256",
}
for filename, symbol in pins.items():
    file = PLUGIN_ROOT / filename
    check(file.is_file() and not file.is_symlink(), "expected bridge file is regular: " + filename)
    declared = re.search(r"(?:private )?static let " + re.escape(symbol) + r' = "([a-f0-9]{64})"', BRIDGE)
    check(declared is not None and hashlib.sha256(file.read_bytes()).hexdigest() == declared.group(1),
          "sealed source pin matches exact module bytes: " + filename)
    resource = "Contents/Resources/openclaw-os1-bridge/" + filename
    check(RELEASE.count(resource) >= 2 and resource in INSTALLER,
          "exact bridge file appears in staged, expanded and installer allowlists: " + filename)

exact_bridge_list = "index.mjs openclaw.plugin.json package.json rcc-runtime.mjs rcc-plugin.mjs"
check("for resource in " + exact_bridge_list in RELEASE and "cmp \"$runtime_root/Resources/openclaw-os1-bridge/$resource\"" in RELEASE,
      "release copies exact five resources and compares source/staged/packaged bytes")
check("expected_payload_files=38" in INSTALLER and "expected_component_files=41" in INSTALLER and
      "release_patch >= 302" in INSTALLER and "expected_payload_files=36" in INSTALLER,
      "new two-module package has exact version-gated counts; older recovery stays exact")
check("requires signed RCC task-runtime module" in INSTALLER and
      "refused an RCC task-runtime module in a legacy release" in INSTALLER,
      "new required modules cannot silently disappear or contaminate a legacy recovery package")
check('"--append-system-prompt"' in MAIN and '"developerInstructions": instructions' in MAIN,
      "native execution retains real provider-supported governance channels")
DISPLAY = (ROOT / "Sources/OS1Context/RCCNativeDisplayReceipts.swift").read_text()
PROJECTION = (ROOT / "Sources/OS1Context/RCCRuntimeProjection.swift").read_text()
check(MAIN.count("nativeReceipts: RCCNativeDisplayReceipts.load(") == 2 and
      "nativeReceipts: RCCNativeDisplayReceipts.load(snapshot)" in APP,
      "running, terminal and installation-observer graph paths attach the same read-only receipt evidence")
check('".os1", "rcc-runtime", "native-receipts"' in DISPLAY and
      'openat(' in DISPLAY and "O_NOFOLLOW" in DISPLAY and "AT_SYMLINK_NOFOLLOW" in DISPLAY and
      "getuid()" in DISPLAY and "st_nlink == 1" in DISPLAY and "st_mode & 0o077 == 0" in DISPLAY,
      "graph receipt observer only opens exact private no-link custody files")
check("RCCRuntimeContract.decodeRecord(bytes)" in PROJECTION and
      "record.taskID == core.taskID" in PROJECTION and "record.nodeID == child.id" in PROJECTION and
      "record.attemptID == attempt" in PROJECTION and "record.candidateID == candidate" in PROJECTION and
      "record.selectedConfig == selected" in PROJECTION and "record.nativeReceipt == path" in PROJECTION,
      "display witness cannot inherit a neighboring task, child, attempt, configuration or receipt")
check("model: nil, effort: nil, nativeSessionID: native?.sessionID" in PROJECTION and
      "record.dispatchStage == .dispatched" in PROJECTION and "record.executionVerified" in PROJECTION,
      "receipt provenance cannot promote selected model/effort into observed settings or task/reference quality")
# Build 376 regression: catalog freshness is judged after every native probe.
catalog_fn = section(MAIN, "private func rccNativeCatalog(", "\n}\n")
check("input.now = Date()" in catalog_fn and
      catalog_fn.index("ModelAvailability.codexCatalog(") < catalog_fn.index("input.now = Date()") <
      catalog_fn.index("RCCNativeCatalogBuilder.build(input)") and
      catalog_fn.index("observeNativeSurfaceAuth(") < catalog_fn.index("input.now = Date()"),
      "catalog freshness instant is taken after the Codex/Claude/auth probes, before the builder")

# Build 378: dynamic tier routing. Provider-stated tiers travel in the
# catalog; the one core picks model and effort per graded node.
TIERS = (ROOT / "Sources/OS1Context/ModelTiers.swift").read_text()
BUILDER = (ROOT / "Sources/OS1Context/RCCNativeCatalogBuilder.swift").read_text()
table = section(TIERS, "public static let table: [String: ModelTier] = [", "]")
check('"gpt-6-astra": .frontier' in table and '"gpt-6.1-sol": .workhorse' in table and
      '"gpt-6-luna": .fast' in table and '"claude-fable-5-1": .frontier' in table and
      '"opus": .workhorse' in table and '"sonnet": .efficient' in table and
      not re.search(r'"gpt-(?:6-sol|5[^"]*|daybreak[^"]*)"\s*:', table),
      "tier table copies provider descriptions; previous-generation and specialized models have no tier")
check('object["model_tiers"] = output.modelTiers' in BUILDER and "ModelTiers.tier(of: $0.model) == .frontier" in BUILDER,
      "catalog builder emits model_tiers and the frontier reference explanation")
check("export const TIER_ROUTES" in RUNTIME and "'model_tiers'" in RUNTIME and "function tierRouteCandidate(" in RUNTIME and
      "referenceOnly: escalated" in RUNTIME and "pendingEscalation(" in RUNTIME,
      "core routes graded nodes by tier and escalates a failed read-only answer to the reference")
check("route_class picks the reasoning tier" in PLUGIN and "never name a model, provider, account, effort or candidate" in PLUGIN,
      "planner prompt states tier semantics and still never sees candidates")

# Build 380 regression: gateway-spawned os1 lacked USER, so Claude's Keychain
# sign-in looked signed out on every live catalog.
check("LoginIdentityEnvironment.applyToCurrentProcess()" in MAIN.split("static func main() async {", 1)[1][:600],
      "os1 fills USER/LOGNAME before any command or provider probe")
check("LoginIdentityEnvironment.missing(in: env" in CLIENT and "env[\"OS1_RCC_STATE_ROOT\"]" in CLIENT,
      "gateway process environment carries USER/LOGNAME for its native children")
check("'USER', 'LOGNAME'" in PLUGIN, "bridge forwards USER/LOGNAME to native children")

# Build387: existing route-all semantics move into the pure compiler, after
# Core accepted the original request. Availability belongs to the later catalog.
COMPILER = (ROOT / "Sources/OS1Context/RCCRuntimeContract.swift").read_text().split("public enum RCCCoreRoutingCompiler {", 1)[1]
check("RouteAllIntent.namesLocalRoute(request)" in COMPILER and "RouteFanout.plan(request)" in COMPILER and
      "RouteAllIntent.namedParts(request)" in COMPILER and "RouteAllIntent.order(request)" in COMPILER and
      "RouteAllIntent.plan(order, available: RouteAllIntent.surfaceOrder)" in COMPILER,
      "Core compiler preserves named/all grammar and all intended surfaces, without prefiltering by health")
check("bestEffort: true" in COMPILER and "explicit_routes_best_effort" in RUNTIME and
      "export function admittedTask(snapshot)" in RUNTIME and "unavailable.length === effective.length" in RUNTIME and
      "routeAllSkippedNotice(result.skippedRoutes)" in MAIN,
      "Core keeps best-effort route-all skipping visible and separate from mandatory named routes")
check("return result(.hold" in COMPILER and "if let hold = order.hold" in COMPILER and
      "snapshot.state = 'held'; snapshot.error = resolution.reason" in RUNTIME,
      "recognised missing/unsafe payload is held within Core before any worker dispatch")
check("LocalRouterBridge.localModelReady()" in catalog_fn and "input.localModel = .init(ready: ready, at: Date())" in catalog_fn and
      catalog_fn.index("LocalRouterBridge.localModelReady()") < catalog_fn.index("input.now = Date()") and
      "$0.surface == .local" in catalog_fn,
      "the local row's availability is a live probe taken only for an explicit local route, before the freshness instant")
check("static func localRow(" in BUILDER and 'input.explicitRouteSurfaces?.contains("local") == true' in BUILDER,
      "the builder emits a local row only for an explicit local route")
check("execute: (ticket, signal) => local(ticket) ? executeLocal(ticket, signal) :" in PLUGIN and
      "localModelExecutor({stateDir," in PLUGIN and
      "complete: request => plannerScope.runInAsyncScope(() => api.runtime.llm.complete(request))" in PLUGIN and
      "purpose: LOCAL_WORKER_PURPOSE" in PLUGIN,
      "a local route runs on the planner's model in the service scope; every other route keeps the native adapter")
check("if (explicitRoute?.surface === 'local')" in RUNTIME and "'local_agent_node_not_explicit'" in RUNTIME and
      "export const LOCAL_WORKER_MODEL = 'qwen3.5:4b';" in RUNTIME,
      "Core binds the local model only for an explicit local route")
# Existing interpreter semantics remain a deterministic candidate gate. The
# production local completion now belongs to Core, not the legacy test helper.
INTERPRETER = (ROOT / "Sources/OS1Context/RoutingOrderInterpreter.swift").read_text()
check("RoutingOrderInterpreter.screen(request, hasAttachments: false)" in COMPILER and
      "RoutingOrderInterpreter.decode(modelAnswer)" in COMPILER and
      "RoutingOrderInterpreter.verify(answer, facts: facts)" in COMPILER and
      COMPILER.index("if let order = RouteAllIntent.order(request)") <
      COMPILER.index("RoutingOrderInterpreter.screen(") and
      "model_schema_json" in COMPILER and "RoutingOrderInterpreter.schemaJSON" in COMPILER,
      "same strict recipient/payload verifier runs after grammar and preserves exact schema literal")
check("assertLocalModelCompletion(response, 'intent_local_model_receipt_invalid')" in PLUGIN and
      "native('rcc-intent', {schema: 1, task, answer}, combined)" in PLUGIN and
      "function deriveIntentTask(" in RUNTIME and "resolutionSHA256(modelAnswer: String?)" in COMPILER,
      "Core's candidate is independently compiled and bound before native execution")
check("try await routingOrderInterpreterHostSelfTest()" in MAIN and "try RoutingOrderInterpreter.selfTest()" in MAIN,
      "the interpreter's gate and host wiring run in os1 self-test with canned answers")
check("RouteAllIntent.plan(request, available: RouteAllIntent.surfaceOrder) != nil" in APP and
      "RouteAllIntent.recognizes(request)" not in APP,
      "the app runs a supported route-all order on Auto; a held one keeps its tile")
check("if (signals.some(value => value.aborted)) record.error = 'local_model_completion_aborted';" in PLUGIN and
      "'local_model_completion_failed'" in PLUGIN and "'native_outcome_uncertain_preserved'" not in
      section(PLUGIN, "export function localModelExecutor(", "async function readExactNativeReceipt("),
      "a failed or cancelled local completion is a finished no-effect turn, never an uncertain one")

print(f"PASS: {checks} RCC Runtime source/resource advisory checks; no runtime/quality proof; model calls 0; network calls 0")
