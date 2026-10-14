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
native = section(MAIN, "private func rccNativeAdapter(", "func runOpenClawRCCTask(")
check("input.completionFeedback = PublicCompletionFeedback(" in native and
      "objectiveSHA256: sha256Hex(Data(objective.utf8)), observations: []" in native,
      "first native attempt explicitly binds empty feedback to its immutable authorization objective")
check(native.index("input.completionFeedback = PublicCompletionFeedback(") <
      native.index("let request = StartExecutionRequest(task: objective") <
      native.index('post("/v1/execution-authorizations"'),
      "task-bound feedback is present before exact-profile admission; no fake prior quality observations")

catalog_host = section(MAIN, "private func rccNativeCatalog(", "private func rccContinuationParent(")
check("claudeCatalogs(workspace: host.workspace, config: config))?.configured" in catalog_host and
      ".routable" not in catalog_host,
      "RCC catalog gets the configured Claude inventory: a cooled top family still defines its pool reference")
check("RCCNativeCatalogBuilder.codexInventory(" in catalog_host and "codex.quotaExcludedModels" in catalog_host and
      "input.codexQuotaExhaustedModels = shaped.quotaExhausted" in catalog_host,
      "RCC catalog keeps a quota-exhausted Codex slug marked exhausted, never silently stripped")

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

print(f"PASS: {checks} RCC Runtime source/resource advisory checks; no runtime/quality proof; model calls 0; network calls 0")
