#!/usr/bin/env python3
"""Read-only SOURCE ADVISORY for the single OpenClaw owner and sealed resources.

This checks source branch/resource wiring, not runtime reachability, installed
package identity, task completion, quality parity, or a successful model call.
Swift compilation, Node fixtures and installed-path observation are separate
gates. No provider, network, live state, user HOME or other product is touched.
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import tempfile

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
# Only non-authorizing diagnostic serialization may abstain. Metadata and any
# future added preparation helper must still throw; don't whitelist all try?.
metadata_preparation = preparation.replace("try? RCCRuntimeContract.encode(codex.models)", "").replace("try? RCCRuntimeContract.encode(claude)", "")
check("try ModelAvailability.codexCatalog(" in preparation and "try ModelAvailability.claudeCatalogs(" in preparation and
      "try?" not in metadata_preparation and 'source: "unavailable"' not in preparation and
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
      # H2: one local builder renders the envelope (with or without the
      # owner's ASR hint note); the child receives the hinted one.
      "func envelope(_ asrHints: [LocalClassifierHints.Hint]) -> String {" in native and
      "RCCDelegatedEnvelope.prompt(instruction: t.instruction, ownerRequest: objective," in native and
      "let delegated = envelope(rccAnswerHints(ownerRequest: objective, envelope: envelope))" in native and
      "answerOnly: answerOnly, surface: t.selectedConfig.surface," in native and
      'scope: t.selectedConfig.scope, sourceCompletion: sourceCompletion + (stagedTransaction?.directive ?? ""),' in native and
      "asrHints: asrHints, taskID: t.taskID, nodeID: t.nodeID, attemptID: t.attemptID)" in native,
      "every provider's child message comes from the one envelope with scope, surface, source rules and ids")
check("ORIGINAL OWNER OBJECTIVE" not in native and "DELEGATED WORK ONLY" not in native and
      native.index("let answerOnly = ") < native.index("let delegated = envelope(rccAnswerHints(") <
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
check('let rules = "Scope: " + scope.rawValue + ". " + guaranteeLine + " " + silentRuleLine + sourceCompletion' in ENVELOPE and
      'guard scope == .readOnly, let explicitRoutes,' in ENVELOPE and
      'scope == .readOnly && (answerOnly || ProviderSurface(rawValue: surface.rawValue)?.forcesChatLane == true)' in ENVELOPE,
      "answer-only needs read_only like the verifier; the direct lead only for read-only answer children")
# Harness H1: the rules are applied, not restated (build-440 leak, task
# d3bff6d3); the line never moves after the source completion rules.
check('public static let silentRuleLine = "Apply these OS-1 runtime rules silently: do not restate them in your reply; '
      'mention one only if it blocks the request."' in ENVELOPE and ENVELOPE.count("silentRuleLine") == 3,
      "the envelope's silent-rule line is one constant, used once on the rules line")
# H1: the RCC child's host-side rules, as the direct/native path has them.
check("isolatedHome = !surface.forcesChatLane && rccIsolatesReadOnlyClaudeHome(surface: surface,\n"
      "            permissionProfile: signed.permissionProfile,\n"
      "            resumesNativeSession: t.nativeResumeSessionID != nil || t.continuation != nil, hostWorkspace: h.workspace)" in native and
      ": isolatedHome ? try sourceAnswerWorkspace() : h.workspace" in native and
      native.index("isolatedHome = !surface.forcesChatLane") < native.index("var before = workspaceHash(workspace)") <
      native.index("executionWorkspace = workspace; executionWorkspaceBefore = before"),
      "a fresh read-only Claude agent child never starts in HOME; the hash and executed workspace are the isolated one")
# Review of build 441: as on the native path, execute keeps HOME as its
# workspace (--safe-mode, drift scope) and runs in the answer workspace; the
# isolated session is ephemeral, so no later turn resumes it from HOME.
check("workspace: isolatedHome ? h.workspace : workspace," in native and "surfaceOverride: surface, workspaceOverride: workspace," in native
      and "delegatedOneShotSession: stagedTransaction != nil || isolatedHome ||" in native
      and native.count("if stagedTransaction != nil || isolatedHome {\n") == 2,
      "the isolated child keeps native argv parity and never becomes the conversation's Claude thread")
helper = section(MAIN, "func rccIsolatesReadOnlyClaudeHome(", "\n}\n")
check("surface == .claude && !resumesNativeSession &&" in helper and
      'ExecutionWorkspace.usesSourceIsolation(provider: "claude", permission: permissionProfile, hasSource: false,' in helper,
      "the HOME rule is the native path's usesSourceIsolation, Claude agent only, never for a resumed session")
check("let checkInHint = rccStatusCheckInHint(ownerRequest: original, card: statusCheckInCard,\n" in native and
      "clearedByLocalReading: rccStatusClearedByLocalReading(taskID: t.taskID, request: original," in native and
      "let nativePrompt = try providerPrompt(current: delegated, context: h.context, r2Evidence: sourceDelivery.payload,\n            workspaceContext: checkInHint)" in native and
      native.index("let delegated = envelope(rccAnswerHints(") < native.index("let checkInHint = rccStatusCheckInHint(") and
      "!clearedByLocalReading && StatusCheckIn.answersFromCard(ownerRequest) ? card() : \"\"" in MAIN and
      "try rccExecuteChildRulesSelfTest()" in MAIN,
      "a card check-in's RCC child carries the install-state card the direct path attaches; os1 self-test pins both rules")
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
# K11: a table certificate's D4 measurement is read only from host custody, by
# the hash the signed table names, through the private input gate; the harness
# scope is the shipped profile's id and version. Nothing else feeds it.
check("RCCClassMeasurement.custodyPath(home: measurementHome, sha256: certificate.measurementSHA256)" in catalog_host and
      "let bytes = try? rccPrivateInput(url.path)" in catalog_host and
      "input.classMeasurements[certificate.measurementSHA256] = bytes" in catalog_host and
      "input.harnessProfile = RCCClassMeasurement.harnessScope(HarnessProfile.current)" in catalog_host and
      catalog_host.count("input.classMeasurements[") == 1 and catalog_host.count("input.classTable") == 1 and
      "input.classTable =" not in catalog_host,
      "RCC catalog reads class measurements only from custody by their pinned hash (K11)")

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
# Execute only extracted local version/resource gates, never the installer,
# pkgutil, signing, network, provider, user state or package installation.
version_gate = INSTALLER.split("  local release_major release_minor release_patch", 1)[1].split(
    '  pkgutil --expand-full "$package_path"', 1)[0]
version_gate = "  local release_major release_minor release_patch" + version_gate
for version, expected in (("0.9.106", "18/21/0/0/0"), ("0.9.107", "19/22/0/0/0"),
                          ("0.9.237", "22/25/0/0/0"), ("0.9.274", "23/26/0/0/0"),
                          ("0.9.293", "24/27/0/0/0"), ("0.9.295", "36/39/0/0/0"),
                          ("0.9.301", "36/39/0/0/0"), ("0.9.302", "38/41/0/0/0"),
                          ("0.9.342", "38/41/0/0/0"), ("0.9.343", "39/42/1/0/0"),
                          ("0.9.349", "39/42/1/0/0"), ("0.9.350", "46/49/1/1/0"),
                          ("0.9.351", "48/51/1/1/1"), ("0.9.355", "48/51/1/1/1"), ("0.9.356", "52/55/1/1/1"), ("0.9.369", "52/55/1/1/1"),
                          ("0.9.370", "59/62/1/1/1"), ("0.9.371", "70/73/1/1/1"), ("0.9.372", "70/73/1/1/1"), ("0.9.373", "70/73/1/1/1"), ("0.9.374", "70/73/1/1/1"), ("0.9.375", "70/73/1/1/1"), ("0.9.376", "70/73/1/1/1"),
                          ("0.9.377", "70/73/1/1/1"), ("0.9.378", "70/73/1/1/1"), ("0.9.379", "70/73/1/1/1"),
                          ("0.9.380", "70/73/1/1/1"), ("0.9.381", "70/73/1/1/1"),
                          ("0.10.0", "70/73/1/1/1"), ("1.0.0", "70/73/1/1/1")):
    fixture = ('set -eu; check_gate() { local app_path=/nonexistent manifest_version="$1";\n' +
               version_gate + '\nprintf "%s/%s/%s/%s/%s" "$expected_payload_files" '
               '"$expected_component_files" "$requires_rcc_resource_usage" "$requires_rcc_adaptive_routing" '
               '"$requires_rcc_frozen_routes"; }; check_gate "$1"')
    result = subprocess.run(["/bin/bash", "-c", fixture, "fixture", version],
                            capture_output=True, text=True, timeout=5)
    check(result.returncode == 0 and result.stdout == expected,
          "exact extracted installer version count fixture: " + version)
usage_gate = "  if (( requires_rcc_resource_usage )); then" + INSTALLER.split(
    "  if (( requires_rcc_resource_usage )); then", 1)[1].split(
    '  # RCC frozen route companion gate:', 1)[0]
with tempfile.TemporaryDirectory(prefix="os1-resource-package-gate-") as temp:
    app = Path(temp) / "Fixture.app"
    helper = app / "Contents/Resources/openclaw-os1-bridge/resource-usage.mjs"
    helper.parent.mkdir(parents=True)
    fixture = ('set -eu; check_gate() { local app_path="$1" requires_rcc_resource_usage="$2";\n' +
               usage_gate + '\n}; check_gate "$1" "$2"')
    def usage_result(required):
        return subprocess.run(["/bin/bash", "-c", fixture, "fixture", str(app), str(required)],
                              capture_output=True, text=True, timeout=5)
    check(usage_result(0).returncode == 0 and usage_result(1).returncode != 0,
          "legacy absence allowed but new usage module absence rejected")
    helper.write_text("export const synthetic = true;\n")
    check(usage_result(1).returncode == 0 and usage_result(0).returncode != 0,
          "new regular helper required but legacy helper injection rejected")
    helper.unlink()
    target = helper.with_name("synthetic-module.mjs")
    target.write_text("export const synthetic = true;\n")
    helper.symlink_to(target.name)
    check(usage_result(1).returncode != 0 and usage_result(0).returncode != 0,
          "usage helper symbolic aliases rejected for both new and legacy releases")

# Execute the exact new gate on synthetic private files. Content tampering is
# checked by compiled source pins/codesign, not falsely claimed by presence tests.
routing_companions = ('adaptive-plan-host.mjs', 'adaptive-routing-policy.mjs', 'joint-route-selector.mjs', 'local-plan-planner.mjs', 'local-plan-proposal.mjs', 'routing-outcome.mjs', 'routing-outcome-capture.mjs')
adaptive_gate = INSTALLER.split("  # RCC adaptive routing companion gate:", 1)[1].split(
    "  if (( requires_rcc_resource_usage )); then", 1)[0]
adaptive_gate = adaptive_gate[adaptive_gate.index("  for bridge_resource in "):]
with tempfile.TemporaryDirectory(prefix="os1-routing-package-gate-") as temp:
    app = Path(temp) / "Fixture.app"
    bridge = app / "Contents/Resources/openclaw-os1-bridge"
    bridge.mkdir(parents=True)
    fixture = ('set -eu; check_gate() { local app_path="$1" requires_rcc_adaptive_routing="$2" bridge_resource;\n' +
               adaptive_gate + '\n}; check_gate "$1" "$2"')
    def adaptive_result(required):
        return subprocess.run(["/bin/bash", "-c", fixture, "fixture", str(app), str(required)],
                              capture_output=True, text=True, timeout=5)
    check(adaptive_result(0).returncode == 0 and adaptive_result(1).returncode != 0,
          "old package has no companions; new package cannot omit them")
    for name in routing_companions:
        (bridge / name).write_text("export const synthetic = true;\n")
    check(adaptive_result(1).returncode == 0 and adaptive_result(0).returncode != 0,
          "new regular13-file bridge accepted; companions cannot enter old recovery")
    for name in routing_companions:
        helper = bridge / name
        moved = helper.with_name("unexpected-" + name)
        helper.rename(moved)
        check(adaptive_result(1).returncode != 0,
              "same-count renamed companion rejected: " + name)
        helper.symlink_to(moved.name)
        check(adaptive_result(1).returncode != 0 and adaptive_result(0).returncode != 0,
              "companion symbolic alias rejected: " + name)
        helper.unlink(); moved.rename(helper)

# The417 additions have a separate absence gate:416 recovery still has exactly
# the previous13 resources. These tests execute extracted shell on synthetic
# files only; signed-byte mutation tests remain the package suite's job.
frozen_companions = ('frozen-route-artifacts.mjs', 'frozen-route-predictor.mjs')
frozen_gate = INSTALLER.split("  # RCC frozen route companion gate:", 1)[1].split(
    "  # RCC calibrated route companion gate:", 1)[0]
frozen_gate = frozen_gate[frozen_gate.index("  for bridge_resource in "):]
with tempfile.TemporaryDirectory(prefix="os1-frozen-route-package-gate-") as temp:
    app = Path(temp) / "Fixture.app"
    bridge = app / "Contents/Resources/openclaw-os1-bridge"
    bridge.mkdir(parents=True)
    fixture = ('set -eu; check_gate() { local app_path="$1" requires_rcc_frozen_routes="$2" bridge_resource;\n' +
               frozen_gate + '\n}; check_gate "$1" "$2"')
    def frozen_result(required):
        return subprocess.run(["/bin/bash", "-c", fixture, "fixture", str(app), str(required)],
                              capture_output=True, text=True, timeout=5)
    check(frozen_result(0).returncode == 0 and frozen_result(1).returncode != 0,
          "416 absence accepted but417 cannot omit frozen-evidence source companions")
    for name in frozen_companions:
        (bridge / name).write_text("export const synthetic = true;\n")
    check(frozen_result(1).returncode == 0 and frozen_result(0).returncode != 0,
          "417 regular frozen companions accepted;416 injection remains rejected")
    for name in frozen_companions:
        helper = bridge / name
        moved = helper.with_name("unexpected-" + name)
        helper.rename(moved)
        check(frozen_result(1).returncode != 0,
              "same-count renamed frozen companion rejected: " + name)
        helper.symlink_to(moved.name)
        check(frozen_result(1).returncode != 0 and frozen_result(0).returncode != 0,
              "frozen companion symbolic alias rejected: " + name)
        helper.unlink(); moved.rename(helper)

# Execute422's four-file presence/absence gate separately; signed bytes are checked below.
calibrated_companions = ('offline-route-calibration.mjs', 'frozen-route-evidence.mjs', 'calibrated-route-evidence.mjs', 'calibrated-route-predictor.mjs')
calibrated_gate = INSTALLER.split("  # RCC calibrated route companion gate:", 1)[1].split(
    '  [[ "$(/usr/bin/xmllint --xpath', 1)[0]
calibrated_gate = calibrated_gate[calibrated_gate.index("  for bridge_resource in "):]
with tempfile.TemporaryDirectory(prefix="os1-calibrated-package-gate-") as temp:
    app = Path(temp) / "Fixture.app"
    bridge = app / "Contents/Resources/openclaw-os1-bridge"
    bridge.mkdir(parents=True)
    fixture = ('set -eu; check_gate() { local app_path="$1" requires_rcc_calibrated_routes="$2" bridge_resource;\n' +
               calibrated_gate + '\n}; check_gate "$1" "$2"')
    def calibrated_result(required):
        return subprocess.run(["/bin/bash", "-c", fixture, "fixture", str(app), str(required)],
                              capture_output=True, text=True, timeout=5)
    check(calibrated_result(0).returncode == 0 and calibrated_result(1).returncode != 0,
          "421 absence accepted;422 cannot omit qualified-calibration code companions")
    for name in calibrated_companions:
        (bridge / name).write_text("export const synthetic = true;\n")
    check(calibrated_result(1).returncode == 0 and calibrated_result(0).returncode != 0,
          "422 regular companions accepted; older recovery injection rejected")
    for name in calibrated_companions:
        helper = bridge / name
        moved = helper.with_name("unexpected-" + name)
        helper.rename(moved)
        check(calibrated_result(1).returncode != 0, "same-count renamed calibrated companion rejected: " + name)
        helper.symlink_to(moved.name)
        check(calibrated_result(1).returncode != 0 and calibrated_result(0).returncode != 0,
              "calibrated companion symbolic alias rejected: " + name)
        helper.unlink(); moved.rename(helper)

pins = {
    "index.mjs": "pinnedPluginIndexSHA256",
    "openclaw.plugin.json": "pinnedPluginManifestSHA256",
    "package.json": "pinnedPluginPackageSHA256",
    "rcc-runtime.mjs": "rccRuntimeModuleSHA256",
    "rcc-plugin.mjs": "rccRuntimePluginSHA256",
    "resource-usage.mjs": "rccResourceUsageSHA256",
    "adaptive-plan-host.mjs": "rccAdaptivePlanHostSHA256",
    "adaptive-routing-policy.mjs": "rccAdaptiveRoutingPolicySHA256",
    "joint-route-selector.mjs": "rccJointRouteSelectorSHA256",
    "local-plan-planner.mjs": "rccLocalPlanPlannerSHA256",
    "local-plan-proposal.mjs": "rccLocalPlanProposalSHA256",
    "routing-outcome.mjs": "rccRoutingOutcomeSHA256",
    "routing-outcome-capture.mjs": "rccRoutingOutcomeCaptureSHA256",
    "frozen-route-artifacts.mjs": "rccFrozenRouteArtifactsSHA256",
    "frozen-route-predictor.mjs": "rccFrozenRoutePredictorSHA256",
    'offline-route-calibration.mjs': 'rccOfflineRouteCalibrationSHA256',
    'frozen-route-evidence.mjs': 'rccFrozenRouteEvidenceSHA256',
    'calibrated-route-evidence.mjs': 'rccCalibratedRouteEvidenceSHA256',
    'calibrated-route-predictor.mjs': 'rccCalibratedRoutePredictorSHA256',
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

exact_bridge_list = "index.mjs openclaw.plugin.json package.json rcc-runtime.mjs rcc-plugin.mjs resource-usage.mjs adaptive-plan-host.mjs adaptive-routing-policy.mjs joint-route-selector.mjs local-plan-planner.mjs local-plan-proposal.mjs routing-outcome.mjs routing-outcome-capture.mjs frozen-route-artifacts.mjs frozen-route-predictor.mjs offline-route-calibration.mjs frozen-route-evidence.mjs calibrated-route-evidence.mjs calibrated-route-predictor.mjs"
check("for resource in " + exact_bridge_list in RELEASE and "cmp \"$runtime_root/Resources/openclaw-os1-bridge/$resource\"" in RELEASE,
      "release copies exact nineteen resources and compares source/staged/packaged bytes")
check("expected_payload_files=38" in INSTALLER and "expected_component_files=41" in INSTALLER and
      "release_patch >= 302" in INSTALLER and "expected_payload_files=36" in INSTALLER,
      "new two-module package has exact version-gated counts; older recovery stays exact")
check("requires signed RCC task-runtime module" in INSTALLER and
      "refused an RCC task-runtime module in a legacy release" in INSTALLER,
      "new required modules cannot silently disappear or contaminate a legacy recovery package")
check("expected_payload_files=39" in INSTALLER and "expected_component_files=42" in INSTALLER and
      "release_patch >= 343" in INSTALLER and "requires_rcc_resource_usage=1" in INSTALLER and
      "requires signed RCC resource-usage module" in INSTALLER and
      "refused an RCC resource-usage module in a legacy release" in INSTALLER,
      "pure usage helper is required only for343+, preserving exact302--342 recovery counts")
check(RELEASE.count("for resource in " + exact_bridge_list + "; do") == 3 and
      "resource-usage.test.mjs" not in exact_bridge_list and "*.mjs" not in RELEASE and
      "Contents/Resources/openclaw-os1-bridge/resource-usage.test.mjs" not in RELEASE and
      "rccResourceUsageSHA256" in BRIDGE,
      "release copy and both identity comparisons use the same exact nineteen files; no test/wildcard shipping")
check("expected_payload_files=46" in INSTALLER and "expected_component_files=49" in INSTALLER and
      "release_patch >= 350" in INSTALLER and "requires_rcc_adaptive_routing=1" in INSTALLER,
      "416 adds exactly seven signed companions without changing <=415 recovery counts")
check("Set(identity.pluginFileSHA256.keys) == Set([" in CLIENT and "identity.pluginFileSHA256.count == 19" in CLIENT,
      "Gateway requires the closed19-module identity with exact cardinality")
client_inventory = re.search(r'Set\(identity\.pluginFileSHA256\.keys\)\s*==\s*Set\(\[(.*?)\]\)', CLIENT, re.S)
check(client_inventory is not None and
      len(re.findall(r'"([^\"]+)"', client_inventory.group(1))) == 19 and
      set(re.findall(r'"([^\"]+)"', client_inventory.group(1))) == set(exact_bridge_list.split()),
      "Gateway closed inventory exactly matches19 named packaged resources, without missing/extra names")
check("expected_payload_files=48" in INSTALLER and "expected_component_files=51" in INSTALLER and
      "release_patch >= 351" in INSTALLER and "requires_rcc_frozen_routes=1" in INSTALLER and
      "requires signed RCC frozen route companion" in INSTALLER and
      "refused an RCC frozen route companion in a legacy release" in INSTALLER,
      "417 adds exactly two signed source modules;416 and older recovery counts/gates retained")
check(len(exact_bridge_list.split()) == 19 and len(set(exact_bridge_list.split())) == 19 and
      "frozen-route-artifacts.mjs" in exact_bridge_list and "frozen-route-predictor.mjs" in exact_bridge_list,
      "closed inventory is exactly19 unique named resources, not a private artifact directory")
check("expected_payload_files=52" in INSTALLER and "expected_component_files=55" in INSTALLER and
      "release_patch >= 356" in INSTALLER and "requires_rcc_calibrated_routes=1" in INSTALLER,
      "422 adds exactly four code companions; old recovery inventories stay unchanged")
for fixture in ("local-plan-proposal", "local-plan-planner", "joint-selector", "adaptive-policy",
                "adaptive-plan-host", "routing-outcome", "adaptive-runtime", "adaptive-plugin",
                "adaptive-joint-shadow", "routing-outcome-capture", "adaptive-prompt-views",
                "frozen-route-artifacts", "frozen-route-predictor", "frozen-runtime",
                "calibrated-plugin", "calibrated-route-evidence", "calibrated-route-predictor", "calibrated-admission"):
    check('node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-' + fixture + '.test.mjs"' in RELEASE,
          "release executes exact pure routing fixture: " + fixture)
# Node's default per-test timeout is infinite: a release fixture whose await
# never settles would stall build-release.sh instead of failing it.
NODE_TEST_LINES = re.findall(r"^node --test\b.*$", RELEASE, re.M)
check(len(NODE_TEST_LINES) >= 50 and all(" --test-timeout=180000 " in line for line in NODE_TEST_LINES),
      "every release node --test line carries a per-test timeout")
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
check("model: display?.model, effort: display?.effort" in PROJECTION and
      "model: child.selectedConfig?.model" not in PROJECTION and
      "value.attemptID == attempt" in PROJECTION and
      "RCCRuntimeContract.digest(receipt) == receiptSHA" in PROJECTION and
      "record.dispatchStage == .dispatched" in PROJECTION and "record.executionVerified" in PROJECTION,
      "separately bound observed metadata, never selected model/effort or task/reference quality")
# Build 376 regression: catalog freshness is judged after every native probe.
catalog_fn = section(MAIN, "private func rccNativeCatalog(", "\n}\n")
check("input.now = Date()" in catalog_fn and
      catalog_fn.index("ModelAvailability.codexCatalog(") < catalog_fn.index("input.now = Date()") <
      catalog_fn.index("RCCNativeCatalogBuilder.build(input)") and
      catalog_fn.index("observeNativeSurfaceAuth(") < catalog_fn.index("input.now = Date()"),
      "catalog freshness instant is taken after the Codex/Claude/auth probes, before the builder")

# Build 378: provider-stated tiers travel in the catalog. Build 407 (R0): the
# one core binds every node by one admission law, at the reference unless a
# certifying source admits a cheaper read-only tuple.
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
# K11: the certificate decision sits in admissionFacts (not the serializer),
# references are computed once in build(), and the wire still emits only the
# verified facts.classCertificate.
admission = section(BUILDER, "public static func admissionFacts(", "public static func providersToProbe(")
MEASUREMENT = (ROOT / "Sources/OS1Context/RCCClassMeasurement.swift").read_text()
check("RCCClassMeasurement.verified(signed, requestClass: requestClass," in admission and
      "artifact: input.classMeasurements[signed.measurementSHA256]" in admission and
      "reference: references[signed.provider]" in admission and
      "classCertificate: certificate," in admission and
      "references: [String: RCCClassMeasurement.Reference] = [:]" in admission and
      "input.classTable.certificate(for: requestClass)" in admission and BUILDER.count("classTable.certificate(for:") == 1,
      "admissionFacts carries a table certificate only after its measurement artifact verifies (K11)")
check("admission: admissionFacts(input, references: references))" in BUILDER and
      'excluded[provider]?["reference_unavailable"] == nil' in BUILDER and
      "references[provider] = .init(provider: provider, model: frontier.model, effort: ceiling)" in BUILDER,
      "build computes each pool's current frontier-ceiling reference once and passes it to admissionFacts (K11)")
emission = section(BUILDER, "if let certificate = facts.classCertificate {", "if let pin = facts.classProviderPin")
check('object["class_certificates"] = [facts.requestClass.rawValue:' in emission and
      BUILDER.count('object["class_certificates"]') == 1 and "classCertificateRejection" not in
      section(BUILDER, "public static func catalogData(", "\n}"),
      "the catalog emits only the verified certificate; the rejection reason never reaches the wire (K11)")
check('public static let kind = "os1_rcc_class_measurement_v1"' in MEASUREMENT and
      "public static let minimumCases: Int64 = 60" in MEASUREMENT and
      "guard C.isHash(sha256) else { return nil }" in MEASUREMENT and
      "C.digest(artifact) == certificate.measurementSHA256" in MEASUREMENT and
      "try? C.checkedObject(data), Set(object.keys) == artifactKeys" in MEASUREMENT and
      "r.tierDisagreement <= r.referenceAADisagreement" in MEASUREMENT and
      '"\\(profile.id)@\\(profile.version)"' in MEASUREMENT,
      "the measurement gate checks hash, strict shape, scope, reference, harness, window and the PASS law (K11)")
check("export const TIER_ROUTES" in RUNTIME and "'model_tiers'" in RUNTIME and "function tierRouteCandidate(" in RUNTIME and
      "referenceOnly: escalated" in RUNTIME and "pendingEscalation(" in RUNTIME and
      "export function admittedRoute(" in RUNTIME and "function certifiedAnswer(" in RUNTIME,
      "core binds every node by the admission law and escalates a rejected certified descent once to the reference")
# K4: only a probed sound_full verifier whose applies() holds certifies (probes
# fail closed and get the certifier's own row-free input), and a verifier-admitted
# descent is delivered only with that certifier's pass on THIS attempt;
# production registers none. The node fixtures are the behaviour gate.
check("export async function registerNodeVerifiers(" in RUNTIME and "verifier_registration_unsound" in RUNTIME and
      "if (!plain(verdict) || verdict.passed !== false) throw new RCCRuntimeError('verifier_registration_probe_unanswered');" in RUNTIME and
      "selected_config: certifier ? null : exactConfig(candidate)" in RUNTIME and
      "VERIFIER_REGISTRATION_TIMEOUT_MS" not in RUNTIME and
      "function soundVerifierFor(" in RUNTIME and "function verifiedSurfaceKinds(" not in RUNTIME and
      "case 'verifier': return true" not in RUNTIME and
      "verdict.attempt_id === result.attempt_id" in RUNTIME and
      "const registry = await registerNodeVerifiers(verifierRegistry ?? new Map());" in RUNTIME and
      "if (descent && (result.handback || result.repair_source)) {" in RUNTIME and
      "verifierRegistry" not in PLUGIN and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-verifier-registry.test.mjs"' in RELEASE and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-tier-routing.test.mjs"' in RELEASE and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-runtime.test.mjs"' in RELEASE,
      "K4: applicability-scoped verifier certification, per-attempt acceptance, none registered in production, fixtures release-gated")
# K9: every ledger record this build fixes names its delivery basis and its
# check; the offline delivery_policy_valid audit reads the JSONL only (its one
# bundled import is the pure resource reducer K16's parity check uses; the
# script is never bundled itself) and is release-gated.
REPLAY = (ROOT / "scripts/route-replay.mjs").read_text()
check("export function deliveryBasisOf(" in RUNTIME and "export function checkIdOf(" in RUNTIME and
      "delivery_basis: deliveryBasis, check_id: checkID, stratum," in RUNTIME and
      "...(typeof route.delivery_basis === 'string' ? this._ledgerCheck(route, checkOutcome) : {})," in RUNTIME and
      "score_space: 'check_acceptance_v1'" in RUNTIME and "'certifier_unavailable'" in RUNTIME and
      "entry?.check_outcome ?? null" in RUNTIME and "settled ? entry.check_outcome ?? null : null" in RUNTIME and
      "export function auditDeliveryPolicy(" in REPLAY and
      re.findall(r"openclaw-os1-bridge/[\w.-]+", REPLAY) == ["openclaw-os1-bridge/resource-usage.mjs"] and
      "fetch(" not in REPLAY and "node:child_process" not in REPLAY and
      "const SUBCOMMANDS = Object.freeze({delivery: runDelivery" in REPLAY and
      "route-replay.mjs" not in RELEASE and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-route-replay.test.mjs"' in RELEASE,
      "K9: ledger delivery basis and check per attempt; offline delivery_policy_valid audit, release-gated")
# K16: `route-replay.mjs usage` reports M1 (verified_not_dispatched null usage is
# verified zero, per-pool completeness from snapshots, the runtime reducer as a
# fail-closed parity check); quota-replay.py keeps M2/M3 as labelled estimates
# and judges 15% per pool from M4 alone with the quantization-conservative bound.
# Both are offline scripts, never bundled, and release-gated.
QUOTA = (ROOT / "scripts/quota-replay.py").read_text()
M4_SECTION = section(QUOTA, "# ---- M4: the only verdict. ----", "def build_report(")
check("export function replayUsage(" in REPLAY and "usage: runUsage" in REPLAY and
      "record.attempt_state === 'verified_not_dispatched' ? {state: 'verified_zero'}" in REPLAY and
      "summarizeTaskResources(snapshot)" in REPLAY and "'runtime_reducer_native_incomplete'" in REPLAY and
      "def m4_verdict(m4, task_pools):" in QUOTA and 'VERDICT_BASIS = "M4_quota_window_observation_only"' in QUOTA and
      "THRESHOLD = Fraction(15, 100)" in QUOTA and "lower = 1 - (d_os1 + quantum) / (d_ref - quantum)" in QUOTA and
      not re.search(r"\b(m2_estimate|m3_estimate|_price_proxies|load_price_card|load_cf_card|price|cf)\b", M4_SECTION) and
      not re.search(r"^\s*(import|from)\s+(socket|urllib|http|ssl)\b", QUOTA, re.M) and
      "quota-replay.py" not in RELEASE.replace('python3 -I "$script_dir/quota-replay.py" --self-test', "") and
      'python3 -I "$script_dir/quota-replay.py" --self-test' in RELEASE and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-route-replay-usage.test.mjs"' in RELEASE,
      "K16: offline M1 usage replay and M4-only per-pool quota verdict, never bundled, release-gated")
# K8: only the first dispatch of a fresh single-node HOST plan reuses its
# bind-time catalog. A planner call after bind, an owner collection, a task
# contract, a calibrated pending dispatch, an injected plan or a second node
# keeps the pre-dispatch refresh; admission and calibrated rechecks still run.
REUSE = section(RUNTIME, "  _bindCatalogReusable(snapshot, node) {", "  _readyWaveEligible(snapshot, node, candidate) {")
DAG = section(RUNTIME, "  async _scheduleDAG(taskID, bindReuse = null) {", "  async _executeNode(")
check("!this.hostAutoPlan" in REUSE and "snapshot.adaptive_routing?.planner_invoked === true" in REUSE and
      "snapshot.plan?.nodes.length !== 1" in REUSE and "snapshot.owner_collection" in REUSE and
      "snapshot.catalog?.task_contract != null" in REUSE and
      "snapshot.calibrated_route?.state === 'pending_dispatch'" in REUSE and "child.attempts === 0" in REUSE and
      "const bindReuse = {binding: this._readyWaveBinding(state)};" in RUNTIME and
      RUNTIME.count("this._scheduleDAG(") == 1 and "await this._scheduleDAG(taskID, bindReuse);" in RUNTIME and
      "let bindWave = bindTime; bindTime = null;" in DAG and
      "bindWave.binding === this._readyWaveBinding(current)" in DAG and
      "this._bindCatalogReusable(current, node) &&\n            dispatchable(planned, executionTask(current), Date.now());" in DAG and
      "fresh = reusable || bound ? current.catalog :" in DAG and
      "if (!admissionCurrent(current)) { reResolved = true; break; }\n          if (!this._recheckCalibratedRoute(taskID))" in DAG and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-bind-catalog-reuse.test.mjs"' in RELEASE,
      "K8: a fresh single-node host plan's first dispatch reuses its bind-time catalog; every other dispatch refreshes")
# K7: Core's zero-model closed arithmetic is os1-closed-arithmetic-v1, read
# from shared vectors by Node and Swift. pureArithmetic stays the one-operator
# explicit-route exact family (the plugin verifier and the Swift answer-only
# envelope read only that shape); only the two zero-model sites read a bare
# v3 envelope as a first turn, every other withoutConversation stays strict.
ARITH_TEST = (ROOT / "scripts/fixtures/openclaw-rcc-exact-arithmetic.test.mjs").read_text()
CONTEXT_TESTS = (ROOT / "Tests/OS1ContextTests/SourceContextTests.swift").read_text()
check("const match = /^\\s*(-?\\d{1,15})\\s*([+*\\-])\\s*(-?\\d{1,15})\\s*$/.exec(request);" in RUNTIME and
      "export function zeroModelArithmetic(request) {\n  const bare = pureArithmetic(request);\n"
      "  if (bare !== null) return legacyLeadingZero(request) ? null : bare;\n"
      # Build 446 (DESIGN-5 §A): then the closed range-sum grammar
      # ("1부터 10까지 더하면 얼마야?"), code alone, never a model.
      "  return exactArithmeticQuestion(request) ?? integerRangeSum(request);" in RUNTIME and
      "export function integerRangeSum(request) {" in RUNTIME and
      "return ((n * (n + 1n) - (a - 1n) * a) / 2n).toString();" in RUNTIME and
      # A bare one-operator leading-zero number ('02-123') abstains like
      # every other strength; pureArithmetic itself is unchanged.
      "if (bare !== null) return legacyLeadingZero(text) ? null : bare;" in RUNTIME and
      "const answer = zeroModelArithmetic(task.request);" in RUNTIME and
      # Only '=' or one '-'/'/' under a quantity predicate reads a date- or
      # phone-shaped EXPR as arithmetic; a leading-zero number never is.
      # Build 441 part 2 (owner order 2026-10-27): the Korean what-is wording
      # over ONE '-' between plain integers is a value too ("1-1은 뭐냐?"),
      # never a year span; '/', several operators and English stay held.
      "if (expression === null || expression.leadingZero) return null;" in RUNTIME and
      "if (expression.ambiguous && !(asks === 'equals' || (asks === 'quantity' && expression.operators === 1) ||\n"
      "      (koreanWhat && plainIntegerDifference(read.tokens))))" in RUNTIME and
      "tokens[1].kind === 'op' && tokens[1].symbol === '-' &&" in RUNTIME and
      "!(tokens[0].int.length === 4 && tokens[2].int.length === 4);" in RUNTIME and
      "function withoutConversation(task, {bareEnvelopeIsFirstTurn = false} = {}) {" in RUNTIME and
      # Build 447 (DESIGN-8): the routing law's local ask-back is the third
      # zero-model site (no dispatch, the same first-turn rule).
      RUNTIME.count("bareEnvelopeIsFirstTurn: true") == 3 and
      RUNTIME.count("withoutConversation(task, {bareEnvelopeIsFirstTurn: true})") == 3 and
      "const askBack = lawAskBack(task, catalog);" in RUNTIME and
      "rcc-arithmetic-vectors.json" in ARITH_TEST and "zeroModelArithmetic" in ARITH_TEST and
      (ROOT / "scripts/fixtures/rcc-arithmetic-vectors.json").is_file() and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-exact-arithmetic.test.mjs"' in RELEASE and
      "guard RCCExactArithmeticOutput.isCanonical(output) else { return nil }" in MAIN and
      "try runRCCExactArithmeticVectorFixtures()" in CONTEXT_TESTS and
      '"--rcc-exact-arithmetic-only"' in CONTEXT_TESTS,
      "K7: zero-model closed arithmetic over shared vectors; the explicit exact family and strict history checks unchanged")
# K10: a frozen check-acceptance cost policy re-ranks a contract or verifier
# descent inside the F Core admitted (the fixed escalation reference plus the
# R11 pool's dispatchable certified rows), on every route call site; the
# plugin registers none, so production stays on TIER_ROUTES.
SELECTOR = (PLUGIN_ROOT / "joint-route-selector.mjs").read_text()
TIER_ROUTE = section(RUNTIME, "function tierRouteCandidate(", "/** Null when something in an allowed scope can run;")
check("export const CHECK_ACCEPTANCE_SCORE_SPACE = 'check_acceptance_probability_v1';" in SELECTOR and
      "export function selectCertifiedDescent(" in SELECTOR and "export function prepareCertifiedDescentPolicy(" in SELECTOR and
      "export const SCORE_SPACE = 'reference_match_probability_v1';" in SELECTOR and
      "isPreparedCertifiedDescentPolicy(descentPolicy) &&\n        (admission.source === 'contract' || admission.source === 'verifier')" in TIER_ROUTE and
      "'certified_descent_not_cost_effective'" in TIER_ROUTE and "'descent_cost_policy_'" in TIER_ROUTE and
      "descents.find(descent => descent.candidate.id === selection.candidate_id) ?? null" in TIER_ROUTE and
      "const served = policyReference ?? serve(pool => [{index: 0, rows: referenceOf(pool)}], 'reference');" in TIER_ROUTE and
      "policyReference = {hit: target, pool: targetPool," in TIER_ROUTE and
      "...poolNotes(tier.pool.pool, chosen, tier.hit.candidate)," in TIER_ROUTE and
      "'pool_scored_by_tier_hit_model'" in TIER_ROUTE and
      "selectRouteCandidate(rest, task, catalog, now, {widenWrites: true, verifierRegistry, descentPolicy,\n"
      "        planNodes: plan.nodes.length, deepPolicy});" in RUNTIME and
      "selectRouteCandidate(checked, task, catalog, now, {widenWrites: finalWriter, verifierRegistry,\n      descentPolicy});" in
      section(RUNTIME, "export function admitBoundedAutoPlan(", "function livePlannerContext(") and
      "resolveRoutePlan(original, task, catalog, now, {verifierRegistry, descentPolicy});" in
      section(RUNTIME, "function livePlannerContext(", "export function admitLivePlannerPlan(") and
      "livePlannerContext(task, catalog, capability, now, verifierRegistry, descentPolicy);" in
      section(RUNTIME, "export function admitLivePlannerPlan(", "const resolved = resolveRoutePlan(compiled.plan") and
      "const resolved = resolveRoutePlan(compiled.plan, task, catalog, now, {verifierRegistry, descentPolicy});" in RUNTIME and
      "{verifierRegistry = null,\n                                                                       descentPolicy = null, deepPolicy = DEEP_POLICY} = {}) {" in RUNTIME and
      RUNTIME.count("descentPolicy: this.descentPolicy") == 4 and RUNTIME.count("this.descentPolicy") == 10 and
      "prepareCertifiedDescentPolicy(certifiedDescentPolicy)" in RUNTIME and
      "certifiedDescentPolicy" not in PLUGIN and "descentPolicy" not in PLUGIN and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-descent-policy.test.mjs"' in RELEASE,
      "K10: frozen descent cost policy ranks only inside F for contract/verifier sources; none registered in production; release-gated")
check("hostAutoPlan: true" in PLUGIN and "export function hostPlan(" in RUNTIME and
      "plan: async" not in section(PLUGIN, "export function registerRCCRuntime(", "api.registerGatewayMethod('os1.rcc.") and
      not re.search(r"GRADED_PLAN|buildBoundedPlannerInput|decodePlannerResponse|route_class picks", PLUGIN) and
      not re.search(r"tierCostGate|cheaperRouteAdmission|LADDER_MIN_VERIFIED_PASSES|costGate", RUNTIME),
      "live plans keep the host admission/floor: no graded planner path, cost gate or ledger ladder")
# The new local completion is an explicitly frozen SHADOW producer inside the
# SAME service. It cannot replace the live host plan or register parity.
registration = section(PLUGIN, "export function registerRCCRuntime(", "api.registerGatewayMethod('os1.rcc.")
check(registration.count("api.runtime.llm.complete(") == 3 and
      re.search(r"localModelExecutor\(\{stateDir,\s*complete: request => plannerScope\.runInAsyncScope\(\(\) => api\.runtime\.llm\.complete\(request\)\)", registration) and
      re.search(r"resolveIntent: routingIntentResolver\(\{stateDir,\s*complete: request => plannerScope\.runInAsyncScope\(\(\) => api\.runtime\.llm\.complete\(request\)\)", registration) and
      "...adaptiveRuntimeOptions({pluginConfig: api.pluginConfig" in registration and
      "purpose: 'os1.rcc.internal-routing-intent'" in PLUGIN,
      "same tool-free local service supplies intent, explicit local route and bounded shadow proposal")
check("proposeLocalPlan: createLocalPlanPlanner" in PLUGIN and "compileFreshPlannerProposal(raw" in RUNTIME and
      "shadow_proposal_validated_not_executed" in RUNTIME and "live_plan_changed: false" in RUNTIME and
      "quality_certificate: false" in RUNTIME and registration.count("api.registerService({") == 1,
      "shadow proposal stays unbound/non-authoritative and retains one runtime owner")
live_options = section(PLUGIN, "if (policy.mode === 'covered_live') {", "// Registration is host configuration")
check("loadLivePlanCapability({stateDir, policy," in live_options and
      "live_plan_capability ?? null" in live_options and "capability === null ? {}" in live_options and
      "max_nodes: 1, max_workers: 1, max_revisions: 0" in live_options,
      "live configuration alone cannot invoke planner without private host capability")
live_context = section(RUNTIME, "function livePlannerContext(", "export function admitLivePlannerPlan(")
check("isLivePlanCapability(capability, now)" in live_context and "activeIntentV2(task, catalog)" in live_context and
      "catalog.owner_scope === 'read_only'" in live_context and "withoutConversation(task)" in live_context and
      "contract.coverage === 'full'" in live_context and "contract.context_sha256" in live_context and
      "live_r0_full_contract_required" in live_context and "live_reference_fallback_unavailable" in live_context,
      "bounded live seam rechecks current custody, fresh Auto scope, original metadata and full native R0 floor")
check('node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-live-plan-adoption.test.mjs"' in RELEASE and
      (ROOT / "scripts/fixtures/openclaw-rcc-live-plan-adoption.test.mjs").is_file(),
      "release executes live-capability revocation, reachability and full-checker fallback fixtures")
for fixture in ("openclaw-rcc-admission", "openclaw-rcc-host-plan", "openclaw-rcc-reference-floor"):
    check(f'node --test --test-timeout=180000 "$script_dir/fixtures/{fixture}.test.mjs"' in RELEASE and
          (ROOT / f"scripts/fixtures/{fixture}.test.mjs").is_file(),
          "release runs the build-407 fixture " + fixture)
# Change 2 (build 441, owner order 2026-10-27): the host-profile graded
# admission is a non-certifying third outcome with its own route kind, basis
# and screen outcome; its fixture is release-gated.
graded_admission = section(RUNTIME, "function hostProfileGrade(", "/** The routing-reason token that names the admission. */")
check("validRequestProfile(profile)" in graded_admission and "['none', 'current_facts'].includes(profile.tool_need)" in graded_admission and
      "!intentConstrains(routingIntent(catalog))" in graded_admission and
      "catalog.owner_scope === 'read_only'" in graded_admission and
      "{class: 'graded', source: GRADED_SOURCE, certificate_id: null, ...graded}" in RUNTIME and
      "graded:(?:light|standard|deep)" in RUNTIME and "'screen_pass'" in RUNTIME and
      "kind: 'graded'" in RUNTIME and "routeClass: GRADED_CLASS" in RUNTIME and
      "const kind = intentConstrains(intent) ? 'explicit' : 'reference';" in RUNTIME and
      "laddered(choice.kind) && choice.ladder ?" in RUNTIME and
      "function laddered(kind) { return kind === 'tier' || kind === 'graded' || kind === 'capability' || kind === 'law'; }" in RUNTIME and
      "'request_profile'" in RUNTIME and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-graded-admission.test.mjs"' in RELEASE and
      (ROOT / "scripts/fixtures/openclaw-rcc-graded-admission.test.mjs").is_file(),
      "change 2: host-profile graded admission is uncertified, gated by owner words and the request profile, release-gated")
# Build 441 part 2 (owner order 2026-10-27, DESIGN-2): the local classifier
# reads the request beside the provider probes, once per task, under the
# keyword rails; Core maps the profile's task type, difficulty and tool need,
# picks the cheapest dispatchable row of the list by host list price, binds the
# local row only for local-read very easy chat on a first turn, and ships
# policy A for deep work. Release-gated.
catalog_profile = section(MAIN, "private func rccNativeCatalog(", "/// A continuation inherits the SAME task's private executed receipt")
check("!RequestProfile.railsDecide(keywordProfile, request: request.request)" in catalog_profile and
      catalog_profile.index("let localReading = consultLocal ? Task.detached {") < catalog_profile.index("let config = try RuntimeConfig.load()") and
      catalog_profile.index("let codexProbe = ") < catalog_profile.index("let reading = await localReading.value") and
      "RequestProfile.combine(keyword: keywordProfile, request: request.request,\n                                                    local: reading.adopted?.answer, model: reading.adopted?.model)" in catalog_profile and
      # Build 447 (DESIGN-8): the law reads every Auto request; the profile
      # adopts the reading only where build 446 did (permissions unchanged).
      "let profileConsults = autoRequest && !RequestProfile.railsDecide(keywordProfile, request: request.request)" in catalog_profile and
      "let consultLocal = profileConsults || lawReads" in catalog_profile and "if profileConsults {" in catalog_profile and
      "if lawReads { input.routingLaw = RoutingLaw.catalogLaw(policy: lawSelection.policy, receipt: reading) }" in catalog_profile and
      "input.ownerScope = RCCCatalogFacts.ownerScope(request, profile: requestProfile)" in catalog_profile and
      "if request.mode != .explicitRoutingTest && !contractBackedWrite {" in catalog_profile and
      "let activePrices = ModelPriceTable.currentWithDigest()" in catalog_profile and
      "input.priceTable = activePrices.table" in catalog_profile and
      "RCCNativeCatalogBuilder.autoLocalRowEligible(input)" in catalog_profile and
      "func rccLocalClassification(taskID: String, requestSHA256: String, request: String," in MAIN and
      "LocalRequestClassifier.cachedReceipt(key: key, directory: directory)" in MAIN and
      "LocalRequestClassifier.store(receipt, key: key, directory: directory)" in MAIN,
      "part 2: the local reading starts first, runs beside the probes, once per task, combined under the rails")
classifier_source = (ROOT / "Sources/OS1Context/LocalRequestClassifier.swift").read_text()
check("RoutingOrderInterpreter.ollamaAsk(endpoint: endpoint, model: model, timeout: timeout, schema: schemaJSON," in classifier_source and
      # Build 446 (DESIGN-5 §B): the machine's one local model, by RAM and
      # the installed set, from the one selection table (review of 446: the
      # selection itself, never a second choice from the inventory's names).
      "installed.contains(active.name) ? active.name : nil" in classifier_source and
      "active: LocalModelSelection.Candidate = LocalModelSelection.active" in classifier_source and
      "public static let timeout: TimeInterval = 12" in classifier_source and
      'public static let keepAlive = "30m"' in classifier_source and
      "URLSession" not in classifier_source and "public static let chatEndpoint = RoutingOrderInterpreter.endpoint" in classifier_source and
      "inventory: { LocalRouterBridge.installedModelNames() }" in MAIN,
      "part 2: one Ollama client (the interpreter's), the machine's one model, a 12 s bound, resident 30 minutes")
tier_route = section(RUNTIME, "function tierRouteCandidate(", "/** Null when something in an allowed scope can run;")
check("export const DEEP_POLICY = 'reference_first';" in RUNTIME and
      "export const GRADED_LISTS = Object.freeze({" in RUNTIME and
      "chat_light: Object.freeze([['local', 'none'], ['fast', 'low']])," in RUNTIME and
      # DESIGN-4 (2026-10-28): a standard answer is never graded (no explain_standard list).
      "explain_standard" not in section(RUNTIME, "export const GRADED_LISTS = Object.freeze({", "const GRADES = new Set(") and
      "if (answer && profile.difficulty === 'standard') return null;" in RUNTIME and
      "const agentOnly = catalog.request_profile?.tool_need === 'current_facts';" in tier_route and
      "profileAnswersLocally(catalog) && withoutConversation(task)" in tier_route and
      "decision = expected < reference ? 'cheap_first' : 'reference_first';" in tier_route and
      "(task.mode === 'auto' && node.instruction === task.request && profileAnswersLocally(catalog) &&" in RUNTIME and
      RUNTIME.count("deepPolicy = DEEP_POLICY") == 3 and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-local-classifier.test.mjs"' in RELEASE and
      (ROOT / "scripts/fixtures/openclaw-rcc-local-classifier.test.mjs").is_file(),
      "part 2: profile mapping, price-aware graded choice, local chat row and policy A, release-gated")
# Build 441 part 3 (lead decision 2026-10-27): soft rails yield to an adopted
# local reading (hard rails never do), Auto local chat answers with a
# conversational prompt, and the App's existing idle poll keeps the classifier warm.
profile_source = (ROOT / "Sources/OS1Context/RequestProfile.swift").read_text()
check("hardWorkRail(keyword) || hardWorkspaceRail(keyword) || keyword.signals.contains(\"text_operation\")" in profile_source and
      "let hardWork = workRail && hardWorkRail(k), hardWorkspace = workspaceRail && hardWorkspaceRail(k)" in profile_source and
      'signals.insert("soft_order")' in profile_source and 'signals.insert("soft_material")' in profile_source and
      'signals.insert("soft_deictic")' in profile_source and '"llm_overrules_soft_rail"' in profile_source,
      "part 3: only hard rails decide or stand against the local reading; soft ones stay rails in the keyword fallback")
check("export function localWorkerStyle(ticket)" in PLUGIN and "style: localWorkerStyle(ticket)" in PLUGIN and
      "const LOCAL_CHAT_SYSTEM = " in PLUGIN and "ticket?.host_context?.explicit_routes != null" in PLUGIN and
      "arithmeticResult(ticket.instruction) !== null" in PLUGIN and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-local-surface.test.mjs"' in RELEASE and
      (ROOT / "scripts/fixtures/openclaw-rcc-local-surface.test.mjs").is_file(),
      "part 3: an Auto local chat ticket is answered conversationally; explicit routes and arithmetic keep the exact prompt (release-gated)")
check("await self?.keepRequestClassifierWarm()" in APP and APP.count("await self?.keepRequestClassifierWarm()") == 2 and
      "LocalRequestClassifier.keepWarm(idle: idle, memoryPressure: pressure, lastOwnerActivity: activity, now: now," in APP and
      "ownerActivityAt = submitTimestamp" in APP and "public static func ollamaLoad(model: String, keepAlive: String" in
      (ROOT / "Sources/OS1Context/RoutingOrderInterpreter.swift").read_text(),
      "part 3: the frontier monitor's poll keeps the classifier warm (no new loop), through the one Ollama client")
# Build 441 review: both idle jobs use the self-update gate's busy predicate
# (runs, starts, a stop, a Fleet job) at the start and again before they act.
check("func idleJobsBusy() -> Bool {" in APP and
      "!activeRuns.isEmpty || !inFlightSubmissions.isEmpty || isStopping || fleetJobActive()" in APP and
      "let fleetBusy = fleetJobActive()" in APP and
      "guard ModelPriceRefresh.shouldStartScheduled(now: now, busy: idleJobsBusy()," in APP and
      "let idle = !idleJobsBusy()" in APP and APP.count("return !self.idleJobsBusy()") == 2 and
      "mayWrite: { @MainActor [weak self] in" in APP and "stillIdle: { @MainActor [weak self] in" in APP,
      "review: the price refresh and the classifier warm-up re-check the full busy gate before they act")

# Build 442 (owner order 2026-10-27, DESIGN-3, change 3): capability-based
# choice for deep work. The table is compiled offline by a committed script
# from committed evidence (byte-identical resource and Swift copy); the local
# classifier's prompt v3 adds a domain; the host carries that domain's rows as
# capability_routes; Core binds a deep node's cheapest dispatchable row,
# uncertified, with the reference its fallback (and a read-only escalation);
# proof/derivation/rigour markers are a floor; the App labels it. Release-gated.
capability_source = (ROOT / "Sources/OS1Context/ModelCapabilityTable.swift").read_text()
capability_resource = (ROOT / "Resources/model-capability-table.json").read_bytes()
check(capability_source.count('public static let compiledBytes = Data((#"' + capability_resource.decode().rstrip("\n") + '"# + "\\n").utf8)') == 1 and
      'public static let compiledSHA256 = "' + hashlib.sha256(capability_resource).hexdigest() + '"' in capability_source and
      (ROOT / "scripts/capability-table.mjs").is_file() and (ROOT / "scripts/capability-evidence-20261027.json").is_file() and
      '"policy":"capability_delta0_v2"' in capability_resource.decode() and '"tolerance":0' in capability_resource.decode() and
      # DESIGN-4 §7: the bar is the reference's best confirmed score at any effort; §2: the broad rows.
      '"reference_bar":"best_confirmed_any_effort"' in capability_resource.decode() and '"broad":{' in capability_resource.decode(),
      "change 3: the compiled capability table is the resource's bytes, pinned, from the committed script and evidence")
capability_admission = section(RUNTIME, "function capabilityCategory(", "/** Build 441 part 2: whether a catalog's profile asks for the local row")
check("const local = profile.classifier.startsWith('local_llm:');" in capability_admission and
      "validCapabilityRoutes(routes) && capabilityCategoryMatches(routes, profile)" in capability_admission and
      "!profile.signals.includes('quality_request') && !intentConstrains(routingIntent(catalog))" in capability_admission and
      "catalog.task_contract == null" in capability_admission and
      "if (node.scope === 'workspace_write') return local && designOrWrite && routes.category !== CAPABILITY_BROAD ? routes.category : null;" in capability_admission and
      # DESIGN-4 §1: a standard answer 441 graded binds a capability row too.
      "if (profile.difficulty === 'standard' && ['chat', 'explain'].includes(profile.task_type) && gradableNode(node, task, catalog))" in capability_admission and
      "return profile.difficulty === 'deep' || designOrWrite ? routes.category : null;" in capability_admission and
      "{class: 'capability', source: CAPABILITY_SOURCE, certificate_id: null, category}" in RUNTIME and
      "capability:(?:knowledge|science|math|coding|writing|tool_use|broad)" in RUNTIME and
      "'request_profile', 'capability_routes', 'routing_law'];" in RUNTIME and "kind: 'capability'" in RUNTIME and
      "routeClass: CAPABILITY_CLASS" in RUNTIME and "const cheaper = typeof cheapUSD === 'number' && typeof referenceUSD === 'number' && cheapUSD < referenceUSD;" in RUNTIME and
      "const ladder = writer ? null : {source: 'tier', admitted_by: CAPABILITY_SOURCE, category," in RUNTIME and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-capability-routes.test.mjs"' in RELEASE and
      (ROOT / "scripts/fixtures/openclaw-rcc-capability-routes.test.mjs").is_file(),
      "change 3: a deep node with a local domain binds a capability row uncertified, beside a runnable, dearer reference; release-gated")
check("CAPABILITY_BASIS" in (ROOT / "scripts/route-replay.mjs").read_text() and
      "capability_delivery_without_screen_pass" in (ROOT / "scripts/route-replay.mjs").read_text(),
      "change 3: route-replay audits the capability basis (screened read-only, unchecked writer)")
check('public static let promptVersion = "local_cls_v2_dom1_sub2_int1"' in classifier_source and
      # DESIGN-4 §9: the enum call is build 441's v2 schema; the domain is its own call (with the owner's ASR hints, §3).
      'public static let schemaJSON = #"{"type":"object","properties":{"task_type":{"type":"string","enum":["explain","design","write","action","chat"]},"difficulty":{"type":"string","enum":["light","standard","deep"]},"needs_tools":{"type":"string","enum":["none","current_facts","workspace","execution"]}},"required":["task_type","difficulty","needs_tools"]}"#' in classifier_source and
      'public static let domainSchemaJSON = #"{"type":"object","properties":{"domain":{"type":"string","enum":["knowledge","science","math","coding","writing","tool_use","general"]}},"required":["domain"]}"#' in classifier_source and
      "if !needsDomain(answer, request: text) {" in classifier_source and
      "let hints = LocalClassifierHints.load(home: home)" in MAIN and "hints: hints.hints, statusHeard: statusHeard," in MAIN and
      # Build 447: the intent call under the routing law only.
      "readsIntent: readsIntent)" in MAIN and "guard needsIntent(answer, readsIntent: readsIntent) else { return receipt }" in classifier_source and
      'home.appendingPathComponent(".os1/local-classifier/asr-hints.json")' in (ROOT / "Sources/OS1Context/LocalClassifierHints.swift").read_text() and
      "static let deepFloorPatterns = [" in profile_source and "let difficulty: Difficulty = quality || deepFloor(request) ? .deep : read" in profile_source and
      # Review of 442: the floor reads a proof, derivation or rigour asked for, never 증명사진 or 전자기 유도.
      '#"증명\\s*(?:을|를)?\\s*(?:좀\\s*)?(?:해|하|할|합|과정)"#' in profile_source and
      "input.capabilityTable = ModelCapabilityTable.compiled" in catalog_profile and
      catalog_profile.index("input.capabilityTable = ModelCapabilityTable.compiled") < catalog_profile.index("input.now = Date()") and
      # Build 446 (DESIGN-5 §A.8): unless the local reading cleared a thing's
      # 최고 성능 or the owner's own thinking; the 442 phrasings stay floors.
      "!(RequestProfile.asksForReference(input.request) &&" in BUILDER and
      "RequestProfile.asksForReferenceFloor(input.request))) else { return nil }" in BUILDER and
      # Review of 442: think-hard and strongest-model wording in any common word order keeps the reference.
      "public static func asksForReference(_ request: String) -> Bool {" in profile_source and
      "if asksForStrongest(request) { return true }" in profile_source,
      "change 3: prompt v3 domain, the deep floor, and the host's capability routes (never with strongest-model words)")
# Review of 442: a capability row binds only beside its OWN pool's runnable reference.
check("const homeReference = new Map(pools.map(pool => [pool, best(referenceOf(pool))]));" in RUNTIME and
      "const options = fresh.filter(option => homeReference.get(option.pool) !== null);" in RUNTIME and
      "const target = chosen ? homeReference.get(home) : null;" in RUNTIME and
      "!options.length ? 'requires_runnable_reference' :" in RUNTIME,
      "change 3 review: a capability row binds only beside its own pool's runnable reference (never another pool's)")
# DESIGN-4 (lead decision 2026-10-28): misread-robust choice, the live
# reference check, standard answers, the 4B domain exclusion and ASR hints.
choice_source = (ROOT / "Sources/OS1Context/CapabilityChoice.swift").read_text()
check("public static func routes(profile: RequestProfile, request: String, table: ModelCapabilityTable," in choice_source and
      "return make(domain.rawValue, .narrowCorroborated, id, rows)" in choice_source and
      "return make(domain.rawValue, .writingDeliverable, nil, table.rows(for: .writing))" in choice_source and
      'if domain == .coding && deep && !codeMaterialSignals.isDisjoint(with: profile.signals) { return "coding_code_material" }' in choice_source and
      "return CapabilityChoice.routes(profile: profile, request: input.request, table: table, priceBasis: basis)" in BUILDER and
      "routes.choice === 'narrow_corroborated' && !inBroad ? 'capability_narrow_corroborated:' + routes.marker :" in RUNTIME and
      "const staleTokens = listed.length > fresh.length ? ['capability_table_stale'] : [];" in RUNTIME and
      "liveReference(pool) !== routes.references[pool.pool]" in RUNTIME and
      "input.priceTableSHA256 = activePrices.sha256" in MAIN,
      "DESIGN-4: broad/narrow/writing choice in the host, choice tokens and the live-reference/price-basis check in Core")
check("public static func readsDomain(model: String) -> Bool {" in classifier_source and
      "domain = domainRead ? Domain(rawValue: local.domain.rawValue) : nil" in profile_source and
      '(domainRead ? [] : ["llm_domain_unqualified"])' in profile_source,
      "DESIGN-4 §4: only a model qualified to read the domain names one (the 4B domain is ignored, recorded)")
check('case "capability":' in MAIN and "ModelCapabilityTable.compiled.summary()" in MAIN and
      "os1 capability show [--json]" in MAIN and "try ModelCapabilityTable.selfTest()" in MAIN,
      "change 3: `os1 capability show` prints the compiled table; os1 self-test checks it")
check('"공식 벤치마크상 기준 이상 · 이 답의 품질은 미검증"' in APP and '$0.hasPrefix("admitted_capability_")' in APP,
      "change 3: the App labels a capability route benchmark-qualified and unverified")

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
      # Build 446 (DESIGN-5 §B): the host's one local model, a live binding
      # the plugin configures from its config; Core writes no model name.
      "export { LOCAL_MODEL as LOCAL_WORKER_MODEL, configureLocalModel } from './resource-usage.mjs';" in RUNTIME and
      "'qwen" not in RUNTIME and "'qwen" not in PLUGIN and
      "if (api.pluginConfig?.local_model !== undefined) configureLocalModel(api.pluginConfig.local_model);" in PLUGIN,
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
app_route_selection = section(APP, "private func requestedProvider(", "/// The owner's explicit retry")
check("RouteAllIntent.plan(request, available: RouteAllIntent.surfaceOrder) != nil" in app_route_selection and
      "RouteAllIntent.recognizes(request)" not in app_route_selection,
      "the app runs a supported route-all order on Auto; a held one keeps its tile")
check("if (signals.some(value => value.aborted)) record.error = 'local_model_completion_aborted';" in PLUGIN and
      "'local_model_completion_failed'" in PLUGIN and "'native_outcome_uncertain_preserved'" not in
      section(PLUGIN, "export function localModelExecutor(", "async function readExactNativeReceipt("),
      "a failed or cancelled local completion is a finished no-effect turn, never an uncertain one")


# 413: staging is native execution custody inside the same task, not a second planner.
check(native.index("stagedTransaction = try RCCStagedWriterTransaction.prepare(") <
      native.index("workspace = transaction.stage.path") <
      native.index("localQualityProfile = try RCCNativeLocalQualityProfile(") <
      native.index("let execution = try await"),
      "actual native workspace/profile bind the private stage before any execution")
check("transaction.stageAssessment(artifact: a)" in native and
      "let finalArtifact = try transaction.mapped(execution.artifact)" in native and
      "ticket: t, artifact: finalArtifact," in native and
      "try RCCRuntimeContract.validate(prospective)" in native,
      "immutable stage checker and original-contract witness both precede applied receipt")
check('record.error = descriptor.state == .discarded ? "native_staged_writer_discarded" : "native_staged_writer_held"' in native,
      "only exact host discard can signal clean-reference replay; unknown state stays held")

check("delegatedOneShotSession: stagedTransaction != nil || isolatedHome || rccDelegatedSessionOneShot(" in native and
      "step.nativeSessionEphemeralWorkspace = true" in native and "checkStep.nativeSessionEphemeralWorkspace = true" in native and
      "step.nativeSessionEphemeralWorkspace != true &&" in APP and
      '!nativeSessionRebinds(ephemeralAnswer, bound: nil)' in APP,
      "disposable staged workspaces never seed or replace native conversation continuity, including first session")
# 414: explicit shared /tmp deny is part of the exact native capability.
QUALITY = (ROOT / "Sources/OS1/TaskQualityRuntime.swift").read_text()
local_profile = section(QUALITY, "final class RCCNativeLocalQualityProfile:", "func rccNativeLocalQualityProfileSelfTest()")
fixed = section(local_profile, "var fixedOverrides:", "static func rowsEmpty(")
verify = section(local_profile, "func verifyConfiguration(", "func verifyThread(")
check('\\\":slash_tmp\\\"=\\\"deny\\\"' in fixed and 'filesystem[":slash_tmp"] as? String == "deny"' in verify and
      '[":minimal", ":slash_tmp", workspace, scratch, "glob_scan_max_depth"]' in verify,
      "shared slash-tmp is explicitly denied and actual effective access must be the exact deny string")
check('Self.toml(scratch))=\\\"write\\\"' in fixed and 'filesystem[scratch] as? String == "write"' in verify and
      'ticket.selectedConfig.scope == .readOnly ? "read" : "write"' in fixed,
      "explicit shared-temp deny preserves exact private scratch write and declared workspace scope")
check('"bypass_hook_trust=false"' not in fixed and 'config["bypass_hook_trust"] as? Bool != true' in verify and
      'params["config"] = ["bypass_hook_trust": false]' in MAIN,
      "ignored process override removal keeps owned-thread hook-trust bypass false and rejects an exposed true setting")
check('"missing shared slash-tmp deny cannot pass a local-only profile"' in QUALITY and
      '"slash-tmp deny must be exact native string, not weaker/unknown/structured access"' in QUALITY and
      '"read-only profile keeps shared-temp denied and only exact private scratch writable"' in QUALITY,
      "native profile fixtures cover missing/retyped deny and legitimate writer/read-only scratch controls")
staged = (ROOT / "Sources/OS1/RCCStagedWriterTransaction.swift").read_text()
check("Run file-relative tests from their actual containing directory" in staged and
      "Prefer inline commands for temporary helpers" in staged and
      "Only when the original task permits temporary helper files" in staged and
      "native private $TMPDIR" in staged and
      "A writable scratch capability does not expand the original task scope" in staged,
      "staged directives preserve real cwd and original task permission despite native private scratch access")
# 415: existing typed source handoff must reach actual native input.
source_delivery = section(MAIN, "struct RCCNativeSourceDelivery {", "func providerPrompt(current:")
source_catalog = section(MAIN, "private func rccNativeCatalog(", "private func rccContinuationParent(")
source_ingress = section(MAIN, "func runOpenClawRCCTask(", "let data = try RCCRuntimeContract.encode(request)")
check("RCCBoundSourceInput.materialRefs(context: context)" in MAIN and "rccBoundSourceMaterialRefs(request: prompt, context: context)" in source_ingress,
      "ingress includes only existing typed bound source identities beside images")
check("RCCBoundSourceInput.prefix" in source_catalog and "== Set(bound)" in source_catalog,
      "catalog independently prevents erased/forged bound-source presence before provider probes")
check("RCCBoundSourceInput.selected(context: context, contextRefs: contextRefs)" in source_delivery and "loadSource(ref, store: store)" in source_delivery,
      "source delivery resolves only the same handoff selected references using existing immutable loader")
check("requireComplete: true" in source_delivery and 'payload.contains("Content omitted from this prompt budget.")' not in source_delivery,
      "strict typed renderer budget, never untrusted source text, determines complete supply")
check('leaf: "source-input-receipts"' in source_delivery and '"backend_inclusion_verified": false' in source_delivery and '"semantic_quality_verified": false' in source_delivery,
      "private source receipt reuses native custody and attests prepared binding only")
check("sourceDelivery.byteCount" in native and "sourceUTF8Bytes: sourceDelivery.byteCount" in native and
      "r2Evidence: sourceDelivery.payload" in native and "preloadedR2Evidence: sourceDelivery.evidence" in native,
      "actual source bytes count toward authorization input and reach provider source DATA and instructions")
check("ownerAllowedSources" in native and "isSubset(of: ownerAllowedSources)" in native,
      "native transport independently honors source detachment and narrow check-in authority")
check("rccUsesLegacySourceOutputCheck(preloadedR2Evidence)" in MAIN and "rccUsesLegacySourceOutputCheck($0)" in MAIN and
      "rccSnapshotOnlySource(preloadedR2Evidence) || chatLane" in MAIN,
      "new source mode keeps ordinary readonly tools and avoids unrelated legacy R2 lexical refusal; old mode stays gated")
check("(exactAnswer ? \"\" : SourceTransformationContract.instructions)" in MAIN and
      'case "self-test-source-input":' in MAIN and "try rccBoundSourceDeliverySelfTest()" in MAIN,
      "source transformation policy uses existing native instruction channel, clean exact-answer path, and actual private-store fixtures")

# K13: C3 native sub-agent parity is withdrawn. Every Core-dispatched native
# attempt runs managed, and the contract refuses the reserved flag on every
# surface until a native adapter enforces typed delegation before dispatch.
TICKET_CONTRACT = (ROOT / "Sources/OS1Context/RCCRuntimeContract.swift").read_text()
check("ParallelAgentRuntime.$managedDelegation.withValue(true) {" in native and
      "withValue(t.allowNativeSubagents" not in MAIN,
      "the RCC native adapter hard-wires managed delegation; a ticket flag never turns it off")
check("if value.allowNativeSubagents == true { throw Rejection.invalidConfiguration }" in TICKET_CONTRACT,
      "ticket validation refuses allow_native_subagents=true on every surface (K13)")
check("allow_native_subagents" not in RUNTIME and "delegation:" not in RUNTIME,
      "Core never emits the reserved delegation flag or a delegation object")

# K12: result contract v2. The version is a request key on both sides (the
# Swift rcc-intent and rcc-catalog operations decode every Core task through
# requestShape), both sides negotiate the same versions, and the wire result
# gate is the same on both sides: a failed, held or cancelled task carries a
# result only as a typed v2 partial.
check('"routing_intent_policy_version", "result_contract_version"], [' in TICKET_CONTRACT and
      'case resultContractVersion = "result_contract_version"' in TICKET_CONTRACT,
      "Swift Request and requestShape accept result_contract_version (K12)")
check("'result_contract_version', ...(allowCoreRouting ? ['core_routing'] : [])" in RUNTIME and
      "const RESULT_CONTRACT_VERSIONS = new Set([1, 2]);" in RUNTIME and
      "public static let resultContractVersions: Set<Int> = [1, 2]" in TICKET_CONTRACT,
      "JS validateTask and Swift validate(Request) accept the same result contract versions (K12)")
check('"native_summaries", "partial"], ["partial": partialShape])' in TICKET_CONTRACT and
      "result: publicResult(snapshot)," in RUNTIME and
      "const PARTIAL_RESULT_STATES = new Set(['failed', 'held', 'cancelled']);" in RUNTIME and
      "(result.partial != nil && [.failed, .held, .cancelled].contains(value.state))" in TICKET_CONTRACT,
      "the public result gate matches validate(Snapshot): failed/held/cancelled only as a v2 partial (K12)")

# K14: an unclassified offered model is an informational exclusion, never a
# hold. Both allowlists (and their informational subsets) are one set; every
# model the bundled server config signs is classified, so today's catalogs
# emit no unclassified_model; the notice reaches the per-delivery channel.


def string_set(text, start):
    body = section(text, start, "]")
    return set(re.findall(r"['\"]([a-z0-9_.\-]+)['\"]", body))


JS_REASONS = string_set(RUNTIME, "const EXCLUSION_REASONS = new Set([")
SWIFT_REASONS = string_set(TICKET_CONTRACT, "public static let reasons: Set<String> = [")
check(JS_REASONS == SWIFT_REASONS and "unclassified_model" in JS_REASONS and len(JS_REASONS) == 13,
      "JS EXCLUSION_REASONS and Swift Exclusion.reasons are the same set (K14)")
check(string_set(RUNTIME, "const INFORMATIONAL_EXCLUSIONS = new Set([") ==
      string_set(TICKET_CONTRACT, "public static let informational: Set<String> = [") == {"unclassified_model"},
      "the informational reason subset is the same on both sides (K14)")
check("(catalog.exclusions === undefined || validInformationalExclusions(catalog))" in RUNTIME and
      "(catalog.exclusions ?? []).some(item => !INFORMATIONAL_EXCLUSIONS.has(item.reason))" in RUNTIME and
      "value.exclusions?.contains(where: { !Exclusion.informational.contains($0.reason) }) == true" in TICKET_CONTRACT and
      "for exclusion in exclusions where Exclusion.informational.contains(exclusion.reason)" in TICKET_CONTRACT,
      "an informational exclusion needs a tier-less offered row and never explains an empty catalog, on both sides (K14)")
tier_names = set(re.findall(r'"([^"]+)"\s*:\s*\.', table))
known_untiered = set(re.findall(r'"([^"]+)"', section(TIERS, "public static let knownUntiered: Set<String> = [", "]")))
check(len(known_untiered) == 9 and not (known_untiered & tier_names) and "gpt-6-sol" in known_untiered,
      "the known untiered set is explicit data, disjoint from the tier table (K14)")
PRODUCTION = json.loads((ROOT / "Config/production.json").read_text())
signed = {profile["model"].split("[", 1)[0] for profile in PRODUCTION["execution_profiles"].values()
          if profile.get("provider") in ("codex", "claude")}
check(signed and signed <= tier_names | known_untiered,
      "every model the bundled config signs is classified, so no production catalog emits unclassified_model: " +
      ", ".join(sorted(signed - tier_names - known_untiered)))
check('excluded[provider, default: [:]]["unclassified_model"] = unclassified.count' in BUILDER and
      "ModelTiers.classification(of: $0.model) == .unclassified" in BUILDER,
      "the builder reports unclassified offered models, informational only (K14)")
review = section(MAIN, "if let review = RCCRuntimeContract.referenceReviewNotice(result) {", "}")
check("routingNotices.append(review)" in review and "RuntimeActivity.emit(.routing, publicText: review)" in review and
      "export function referenceReviewReason(" in RUNTIME and "const review = referenceReviewRequired(snapshot.catalog);" in RUNTIME and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-unclassified-model.test.mjs"' in RELEASE,
      "every model-backed delivery while an unclassified model is offered carries the reference review notice (K14)")

# Build 446 (DESIGN-5, owner order 2026-10-29).
SELECTION = (ROOT / "Sources/OS1Context/LocalModelSelection.swift").read_text()
INSTALLER = (ROOT / "scripts/install-local-verified.mjs").read_text()
FLEET = (ROOT / "Sources/OS1/Fleet.swift").read_text()
USAGE = (PLUGIN_ROOT / "resource-usage.mjs").read_text()
check("public static func clearance(_ keyword: RequestProfile, request: String," in profile_source and
      "if let rules = clearance(k, request: request, local: local) {" in profile_source and
      "!s.contains(\"soft_status\") || local.subject == .other else { return nil }" in profile_source and
      "floorWorkRail(keyword) || floorWorkspaceRail(keyword) ||" in profile_source and
      "rccClearedChatLane(objective: objective, hasSource: hasSource, profile: profile)" in MAIN and
      "shellFloor: promptShellFloor(request.request))" in MAIN and
      "input.requestProfile?.cleared(\"status\") == true" in BUILDER,
      "446 A: one clearance in RequestProfile.combine; floors stand; the chat lane, the card and the owner decision read it")
check('.init(name: "qwen3.5:9b", digest: "56671c2ab9385f9cfcb404638e32cd62d88e3501d44822208363c010179a3c90",' in SELECTION and
      "bytes: 6_550_825_550, minimumMemoryBytes: 16 * gibibyte)," in SELECTION and
      "public static let contextTokens = 32_768" in SELECTION and
      "public static var localWorkerModel: String { LocalModelSelection.active.name }" in BUILDER and
      'bridgeEntry["config"] = ["bounded_auto": true, LocalModelSelection.pluginConfigKey: OpenClawAgentController.model]'
          in (ROOT / "Sources/OS1/LocalRouterBridge.swift").read_text() and
      "export let LOCAL_MODEL = null;" in USAGE and "export function configureLocalModel(name) {" in USAGE and
      "'qwen" not in (PLUGIN_ROOT / "local-plan-planner.mjs").read_text() and "'qwen" not in USAGE and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-local-model-one-name.test.mjs"' in RELEASE,
      "446 B: one local model per machine; the host's name flows to the catalog, the gateway, the plugin, Core and the planner")
check("run('/usr/bin/ditto', ['--clone', source, stageApp]);" in INSTALLER and
      "spawnSync(cp, ['-c', '-n', ...sources, directory + '/']," in INSTALLER and
      "if (cloning) cloning = cloner(chunk.map(file => file.sourceFile), directory);" in INSTALLER and
      "else streamPagingFile(file.sourceFile, file.destination);" in INSTALLER and
      'guard let copied = try? commandOutput(copier, ["-c", "-R", template.path, destination.path], timeout: 600), copied.0 == 0,' in FLEET and
      'case "storage":' in MAIN and "StorageReport.make()" in MAIN,
      "446 C: new recovery and Fleet copies are APFS clones with a byte-copy fallback; os1 storage report is read-only")
# Review of build 446.
check("canClone: (URL, URL) -> Bool = fleetVolumeClones) -> Bool {" in FLEET and
      "guard canClone(templates, destination.deletingLastPathComponent()) else { return false }" in FLEET and
      ".volumeSupportsFileCloningKey" in FLEET,
      "446 review: a Fleet job takes a template copy only on one cloning volume; otherwise the hard-linked mirror clone")
check("var workspace = surface.forcesChatLane ? try sourceAnswerWorkspace()" in MAIN,
      "446 review: a cleared request's tool-free chat lane runs in the answer workspace, never the conversation workspace")
check('"local_model": {' in (PLUGIN_ROOT / "openclaw.plugin.json").read_text() and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-plugin-config-validates.test.mjs"' in RELEASE,
      "446 review: the plugin manifest declares local_model; the pinned OpenClaw validates the gateway config (release-gated)")
check("installed.contains(active.name) ? active.name : nil" in (ROOT / "Sources/OS1Context/LocalRequestClassifier.swift").read_text() and
      "loopbackInventory(timeout: timeout).map(LocalModelSelection.pinnedInventoryNames)"
          in (ROOT / "Sources/OS1/LocalRouterBridge.swift").read_text(),
      "446 review: the classifier and the warm-keeper ask the machine's one selected model at its pinned digest")

# Build 447 (DESIGN-8, owner-approved direction 2026-10-29): one routing law.
# The compiled table's bytes are the resource, Core's embedded literal and the
# pin on both sides; Core's engine prices every admissible candidate in real
# quota and binds the argmin; the host reads every Auto request locally and
# carries the raw reading; routing_policy=law_446 is the rollback. Release-gated.
law_resource = (ROOT / "Resources/routing-law-table.json").read_bytes()
law_sha = hashlib.sha256(law_resource).hexdigest()
law_swift = (ROOT / "Sources/OS1Context/RoutingLaw.swift").read_text()
law_literal = section(RUNTIME, "const ROUTING_LAW_TABLE_TEXT = ", "export const ROUTING_LAW_TABLE_SHA256")
check(f'public static let tableSHA256 = "{law_sha}"' in law_swift and
      f"export const ROUTING_LAW_TABLE_SHA256 = '{law_sha}';" in RUNTIME and
      json.loads(law_literal.rstrip().rstrip(";")) == law_resource.decode().rstrip("\n") and
      (ROOT / "scripts/routing-law-table.mjs").is_file() and (ROOT / "scripts/routing-law-policy.json").is_file() and
      all((ROOT / f"scripts/routing-law-{name}-20261029.json").is_file() for name in ("evidence", "quota", "ledger")) and
      'node "$script_dir/routing-law-table.mjs" check' in RELEASE,
      "447: the routing-law table is the compiler's bytes from committed inputs, pinned in Resources, Core and Swift; release-checked")
check("export const ROUTING_POLICIES = Object.freeze(['law_446', 'law_447']);" in RUNTIME and
      "function lawAdmission(node, task, catalog) {" in RUNTIME and "export function lawExpectedQuota({q, pFail = 0, escalationQ = 0, scarcity = 0}) {" in RUNTIME and
      "export function lawScarcity(referenceQ, remaining, threshold) {" in RUNTIME and
      "const ranked = [...admissible].sort((a, b) => (a.eq - b.eq) ||" in RUNTIME and
      "'law_argmin_reference'" in RUNTIME and "law:[A-Za-z0-9-]{1,16}" in RUNTIME and
      "...(routeClass !== null && plain(child.law_receipt) ? {law: child.law_receipt} : {})};" in RUNTIME and
      "const askBack = lawAskBack(task, catalog);" in RUNTIME and
      "this._completeLocalExact(taskID, 'local_ask_back', askBack.output, askBack.receipt)" in RUNTIME and
      'node --test --test-timeout=180000 "$script_dir/fixtures/openclaw-rcc-routing-law.test.mjs"' in RELEASE and
      (ROOT / "scripts/fixtures/openclaw-rcc-routing-law.test.mjs").is_file() and
      (ROOT / "scripts/fixtures/routing-law-owner-questions.json").is_file(),
      "447: Core prices each admissible candidate (E[Q]) and binds the argmin with a receipt; the ask-back is local; release-gated")
check('public static let environmentKey = "OS1_ROUTING_POLICY"' in law_swift and
      'home.appendingPathComponent(".os1/routing-policy.json")' in law_swift and
      "guard policy == .law447 else { return nil }" in law_swift and
      "let lawReads = autoRequest && lawSelection.policy == .law447" in MAIN and
      "let consultLocal = profileConsults || lawReads" in MAIN and
      "if lawReads { input.routingLaw = RoutingLaw.catalogLaw(policy: lawSelection.policy, receipt: reading) }" in MAIN and
      "capabilityRoutes: input.routingLaw == nil ? capabilityRoutes(input) : nil" in BUILDER and
      "LAW_BASIS" in (ROOT / "scripts/route-replay.mjs").read_text(),
      "447: the host reads every Auto request locally under law_447, carries the raw reading, and law_446 rolls back")

print(f"PASS: {checks} RCC Runtime source/resource advisory checks; no runtime/quality proof; model calls 0; network calls 0")
