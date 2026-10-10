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


ROOT = Path(__file__).resolve().parents[1]
BRIDGE = (ROOT / "Sources/OS1/LocalRouterBridge.swift").read_text()
IDENTITY = (ROOT / "Sources/OS1/InstalledOS1Resources.swift").read_text()
RELEASE = (ROOT / "scripts/build-release.sh").read_text()


def check(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


checks = 0


def expect(condition: bool, message: str):
    global checks
    check(condition, message)
    checks += 1


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
PINS = {
    "index.mjs": "e9cd834a1fb57fcb61a2c53bc3c3a1a6d2fe393ab71bd3a14529f89901077e72",
    "openclaw.plugin.json": "700710ab6124eabcc945f247b13e94451fc266b956c5ce991b5eb99cc6d62af3",
    "package.json": "583bd79e8bc75e98df186b7bd50f6d1ec580298e930e2dbd5674ce1e6296dbe4",
}
for name, digest in PINS.items():
    expect(hashlib.sha256((PLUGIN / name).read_bytes()).hexdigest() == digest and digest in BRIDGE,
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
       '"/usr/bin/codesign"' in BRIDGE,
       "public base policy uses an app-sealed contract, not an invented owner Notes policy")
expect('OpenClawAgentController.prepare(' in BRIDGE and
       'LocalOpenClawGatewayRunner.run(turn: turn, installed: identity)' in BRIDGE and
       'OpenClawAgentController.proposeGateway(' in BRIDGE and
       BRIDGE.index('LocalOpenClawGatewayRunner.run(turn: turn, installed: identity)') <
       BRIDGE.index('OpenClawAgentController.proposeGateway(') < BRIDGE.index('raw = generated.final'),
       "surface preference uses exact typed Gateway run and gate parser before host admission")
expect('kind: "surface_preference"' in BRIDGE and
       '"gateway_dispatch_may_have_started"' in BRIDGE and
       '"failed_or_unverified"' in BRIDGE and
       '"host_surface_admitted_task_quality_unverified"' in BRIDGE,
       "candidate/failed/host-admitted states remain distinct private receipts")
expect('if installedPluginExists || activation?["provisioning_version"] as? Int == 1' in BRIDGE and
       'else if activation?["provisioning_version"] == nil' in BRIDGE and
       'no alternate local model call' in BRIDGE,
       "a failed Gateway does not trigger a second lean model call; v0 without plugin retains old producer")
expect('!StatusCheckIn.answersFromCard(input.request)' in BRIDGE and
       'input.criterion == .boundedQuotaPreference' in BRIDGE and
       'input.requirement.requestedCandidateID == nil' in BRIDGE,
       "check-ins, deterministic measured-minimum routes and explicit targets never spend a Gateway turn")
print(f"OS-1 local OpenClaw sidecar wiring: {checks} checks PASS; "
      "v1 managed-private runtime / v0 pinned legacy fallback; typed surface Gateway candidate + lean legacy; "
      "static/source checks only, no model calls; "
      f"provisioner resource currently packaged={'provision-local-controller.py' in RELEASE}")
