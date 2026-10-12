#!/usr/bin/env python3
"""Deterministic source-boundary regression for OS-1's local OpenClaw bridge.

This tests the resolver and pre-governance wiring without executing a model,
opening another application's UI, touching credentials, or changing live state.
The Swift build is the separate type/compile gate; this is not an end-to-end
agentic-controller or bundled-package proof.
"""
from pathlib import Path
import hashlib
import json
import re


ROOT = Path(__file__).resolve().parents[1]
BRIDGE = (ROOT / "Sources/OS1/LocalRouterBridge.swift").read_text()
SEAL = (ROOT / "Sources/OS1Context/InstalledResourceSeal.swift").read_text()
IDENTITY = (ROOT / "Sources/OS1/InstalledOS1Resources.swift").read_text()
RELEASE = (ROOT / "scripts/build-release.sh").read_text()
APP = (ROOT / "Sources/OS1App/OS1App.swift").read_text()


def check(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


checks = 0


def expect(condition: bool, message: str):
    global checks
    check(condition, message)
    checks += 1


source_poll = APP.split("func resumeRegisteredSourcePreparations(", 1)[1].split("func resumeBackendRecoveries(", 1)[0]
archive_check = 'root.appendingPathComponent(pending.manifestSHA256).appendingPathComponent("source.tar.gz").path'
cancel_check = 'ExecutionCancellation.url(submissionID: failed.id).path'
expect(source_poll.index(archive_check) < source_poll.index(cancel_check) <
       source_poll.index("PreparationIntent.detect(failed.request)") < source_poll.index("refreshRunAdmissionPressure()"),
       "source polling checks current eligibility/artifact/cancellation before parsing or sampling global admission")
expect(source_poll.count(archive_check) == 2 and source_poll.count(cancel_check) == 2 and
       'sessions[index].lastFailure?.request == failed.request' in source_poll and
       source_poll.index('sessions[index].lastFailure?.request == failed.request') < source_poll.index('start(retry, admission: admission)'),
       "source/cancellation/request identity are freshly rechecked before the existing single dispatch")
expect("cache" not in source_poll.replace("cached", "") and 'retry.sourceRetryIdentity = pending.manifestSHA256' in source_poll and
       source_poll.index('save()') < source_poll.index('start(retry, admission: admission)'),
       "poll ordering does not cache authority or spend the persisted one-identity retry after dispatch")


expect('provisionerResources()' in BRIDGE and 'OS-1 CLODEX.app/Contents/Resources' in IDENTITY,
       "a provisioned sidecar is bound to the installed app's signed resource directory")
expect('InstalledOS1Resources.resolve()' in BRIDGE and
       '/Applications/OS-1 CLODEX.app/Contents/Resources' in IDENTITY and
       'bundledHash == actualHash' in IDENTITY,
       "public/private standalone CLI resolves resources by exact executable identity")
expect('provision-local-controller.py' in BRIDGE and 'local-controller-sources.json' in BRIDGE,
       "v1 cannot start without the installed app's pinned provisioner metadata")
expect('node_sha256' in BRIDGE and 'fileSHA256(managedNode) == nodeHash' in BRIDGE,
       "the managed Node binary requires an activation-manifest-bound exact digest")
expect('fileSHA256(privateEntry) == expectedEntry' in BRIDGE and
       'fileSHA256(resources.appendingPathComponent("local-controller-package.json")) == packageHash' in BRIDGE and
       'fileSHA256(privatePrefix.appendingPathComponent("package.json")) == packageHash' in BRIDGE and
       'fileSHA256(resources.appendingPathComponent("local-controller-package-lock.json")) == lockHash' in BRIDGE and
       'fileSHA256(privatePrefix.appendingPathComponent("package-lock.json")) == lockHash' in BRIDGE,
       "v1 binds the provisioned OpenClaw dependency tree to signed app resources")
expect('provisioningVersion == 1' in BRIDGE and
       'guard provisioningVersion == nil, regularFile(legacyNode)' in BRIDGE and
       BRIDGE.index('if provisioningVersion == 1') < BRIDGE.index('guard provisioningVersion == nil'),
       "v1 must fail closed; only absent provisioning_version permits v0 legacy fallback")
expect('versionJSON["version"] as? String == "0.35.1"' in BRIDGE and
       'modelDigest' in BRIDGE,
       "the v1 live Ollama runtime version and model digest remain separate gates")
expect('tools["deny"] as? [String] == ["*"]' in BRIDGE and
       'browser["enabled"] as? Bool == false' in BRIDGE,
       "migration must not turn on generic tools or browser access")
expect('"infer", "model", "run", "--local"' in BRIDGE and
       '"--thinking", "off"' in BRIDGE,
       "this patch preserves a local tool-free candidate producer, not a falsely claimed agent loop")
expect('ownerPolicy.verifyOriginal()' in BRIDGE and
       'host_admitted_local_candidate_only' in BRIDGE and
       '"execution_status": "not_started"' in BRIDGE,
       "the host verifies owner policy and persists candidate-only admission before inference")
expect(BRIDGE.index('"pre_governance": "host_admitted_local_candidate_only"') <
       BRIDGE.index('try commandOutput("/usr/bin/env"'),
       "pre-governance must precede the actual local model call")
expect(BRIDGE.index('"dispatch_may_have_started"') <
       BRIDGE.index('try commandOutput("/usr/bin/env"') and
       '"failed_or_unverified"' in BRIDGE,
       "a failed or interrupted local call must not be recorded as never dispatched")
expect(BRIDGE.index('"returned_unverified"') <
       BRIDGE.index('let envelope = try JSONSerialization.jsonObject(with: result.1)'),
       "a returned malformed envelope must still leave an actual-return receipt")
expect('OwnerPolicyContext.snapshot?.sourceSHA256 == ownerPolicy.sourceSHA256' in BRIDGE,
       "post-generation use must refuse a changed owner-policy identity")
expect('"candidate_only_not_parity"' in BRIDGE and
       '"tools_permitted": false' in BRIDGE,
       "a syntactically valid local output must not become quality or tool authority")
PLUGIN = ROOT / "Resources/openclaw-os1-bridge"
PIN_SYMBOLS = {
    "index.mjs": "pinnedPluginIndexSHA256",
    "openclaw.plugin.json": "pinnedPluginManifestSHA256",
    "package.json": "pinnedPluginPackageSHA256",
    "rcc-runtime.mjs": "rccRuntimeModuleSHA256",
    "rcc-plugin.mjs": "rccRuntimePluginSHA256",
}
for name, symbol in PIN_SYMBOLS.items():
    match = re.search(r"(?:private )?static let " + re.escape(symbol) + r' = "([a-f0-9]{64})"', BRIDGE)
    expect(match is not None, f"compiled installed-plugin pin exists for {name}")
    digest = match.group(1)
    expect(hashlib.sha256((PLUGIN / name).read_bytes()).hexdigest() == digest,
           f"the compiled installed-plugin pin matches {name} bytes")
SOURCES = json.loads((ROOT / "Resources/local-controller-sources.json").read_text())
for arch in ("arm64", "x86_64"):
    digest = SOURCES["node"][arch]["binary_sha256"]
    expect(digest in BRIDGE and len(digest) == 64, f"v0/v1 Node identity is pinned for {arch}")
expect(SOURCES["model"]["digest"] in BRIDGE and
       'manifest["entry_sha256"] as? String == pinnedEntrySHA256' in BRIDGE,
       "pinned local model and OpenClaw entry are checked beyond mutable activation metadata")
expect('app_sealed_public_executor_contract' in BRIDGE and
       'RuntimeConfig.load().executorContract' in BRIDGE and
       'validateExecutorContract(bundled.executorContract)' in BRIDGE and
       'try verifyInstalledResourceSeal(resources)' in BRIDGE and
       'InstalledResourceSeal.verify(app: app)' in BRIDGE and
       'commandOutput(executable, arguments, timeout: timeout).0' in BRIDGE and
       '"/usr/bin/codesign"' in SEAL and
       '["--verify", "--deep", "--strict", app.path]' in SEAL and
       'guard status == 0' in SEAL,
       "public base policy uses an app-sealed contract, not an invented owner Notes policy")
gateway = BRIDGE.split('private static func produceGatewaySurface(', 1)[1].split(
    'private static func produce(', 1)[0]
expect('OpenClawAgentController.prepareRoute(' in gateway and
       'hostInput: input' in gateway and
       'LocalOpenClawGatewayRunner.run(turn: turn, installed: identity)' in gateway and
       'OpenClawAgentController.proposeGateway(' in gateway and
       'OpenClawAgentController.admitRoute(' in gateway and
       'prepared: prepared, for: input' in gateway and
       gateway.index('OpenClawAgentController.prepareRoute(') <
       gateway.index('LocalOpenClawGatewayRunner.run(turn: turn, installed: identity)') <
       gateway.index('OpenClawAgentController.proposeGateway(') <
       gateway.index('OpenClawAgentController.admitRoute('),
       "host route requires typed prepare, owned Gateway, premodel gate parser, and immutable host admission")
expect('JSONEncoder().encode(input)' not in gateway and
       'Eligible IDs:' not in gateway and
       'OpenClawAgentController.State(' not in gateway,
       "Gateway producer never passes host inventory or eligible IDs directly in its prompt")
rank = BRIDGE.split('static func rankSurface(', 1)[1]
expect('return try await produceGatewaySurface(input: input, resources: resources)' in rank and
       'no alternate local model call' in rank and
       'let encoded = String(decoding: try JSONEncoder().encode(input)' in rank and
       rank.index('return try await produceGatewaySurface(input: input, resources: resources)') <
       rank.index('let encoded = String(decoding: try JSONEncoder().encode(input)'),
       "v1 typed route cannot fall through to v0 prompt-visible-ID producer")
expect('kind: "surface_preference"' in BRIDGE and
       '"gateway_dispatch_may_have_started"' in BRIDGE and
       '"failed_or_unverified"' in BRIDGE and
       '"host_surface_admitted_task_quality_unverified"' in BRIDGE,
       "candidate/failed/host-admitted states remain distinct private receipts")
expect('if installedPluginExists || activation?["provisioning_version"] as? Int == 1' in BRIDGE and
       'if activation?["provisioning_version"] == nil' in BRIDGE and
       'no alternate local model call' in BRIDGE,
       "a failed Gateway does not trigger a second lean model call; v0 without plugin retains old producer")
expect('!StatusCheckIn.answersFromCard(input.request)' in BRIDGE and
       'input.criterion == .boundedQuotaPreference' in BRIDGE and
       'input.requirement.requestedCandidateID == nil' in BRIDGE,
       "check-ins, deterministic measured-minimum routes and explicit targets never spend a Gateway turn")
print(f"OS-1 local OpenClaw sidecar wiring: {checks} checks PASS; "
      "v1 managed-private runtime / v0 pinned legacy fallback; typed surface Gateway candidate + lean legacy; "
      "static/source checks only, no model calls; "
      f"release provisioner resource wiring present={'provision-local-controller.py' in RELEASE}")
