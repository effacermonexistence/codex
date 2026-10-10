#!/usr/bin/env python3
"""Deterministic source/package contract checks; never fetch or run a model."""
import io
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

here = Path(__file__).resolve().parent
resources = here.parent / "Resources"
repo = here.parents[2]
spec = importlib.util.spec_from_file_location("provision", here / "provision-local-controller.py")
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)
spec = importlib.util.spec_from_file_location("setup", repo / "scripts/setup-os1-openclaw-local-router.py")
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

count = 0
def check(condition, label):
    global count
    assert condition, label
    count += 1

contract = provision.read_contract(resources)
check(contract["delivery"] == "verified-first-run-fetch-not-offline-bundle", "honest acquisition label")
check(contract["model"]["digest"] == setup.DEFAULT_MODEL_DIGEST, "exact Qwen digest")
check(contract["controller"]["integrity"] == setup.INTEGRITY, "exact OpenClaw tarball")
check(contract["node"]["arm64"]["sha256"] != contract["node"]["x86_64"]["sha256"], "distinct architecture pins")
check(len(setup.checked_dependency_lock(resources / "local-controller-package.json",
                                        resources / "local-controller-package-lock.json")[1]) > 100_000,
      "resolved dependency lock")
check(setup.isolated_env(Path('/node/bin/node'), Path('/private-home'), Path('/private-state'),
                         Path('/private-config'))['npm_config_userconfig'] !=
      setup.isolated_env(Path('/node/bin/node'), Path('/private-home'), Path('/private-state'),
                         Path('/private-config'))['npm_config_globalconfig'],
      "npm user/global config files must be distinct")
check('command(call, env, prefix, timeout=1200)' in (repo / "scripts/setup-os1-openclaw-local-router.py").read_text(),
      "npm ci runs in pinned project directory, not machine-named --prefix")

with tempfile.TemporaryDirectory(prefix="os1-provision-fixture-") as temporary:
    folder = Path(temporary)
    package = json.loads((resources / "local-controller-package.json").read_text())
    lock = json.loads((resources / "local-controller-package-lock.json").read_text())
    package_path = folder / "package.json"
    lock_path = folder / "package-lock.json"
    package_path.write_text(json.dumps(package))
    lock["packages"]["node_modules/openclaw"]["integrity"] = "sha512-wrong"
    lock_path.write_text(json.dumps(lock))
    try:
        setup.checked_dependency_lock(package_path, lock_path)
        raise AssertionError("changed top-level integrity was accepted")
    except setup.SetupFailure:
        check(True, "changed top-level integrity rejected")
    lock = json.loads((resources / "local-controller-package-lock.json").read_text())
    lock["packages"]["node_modules/openclaw"]["resolved"] = "file:/tmp/untrusted.tgz"
    lock_path.write_text(json.dumps(lock))
    try:
        setup.checked_dependency_lock(package_path, lock_path)
        raise AssertionError("machine-local tarball was accepted")
    except setup.SetupFailure:
        check(True, "machine-local tarball rejected")
    malicious = folder / "malicious.tgz"
    with tarfile.open(malicious, "w:gz") as bundle:
        contents = b"bad"
        item = tarfile.TarInfo("../outside")
        item.size = len(contents)
        bundle.addfile(item, io.BytesIO(contents))
    try:
        provision.extract_checked(malicious, folder / "extract")
        raise AssertionError("archive traversal was accepted")
    except provision.ProvisionFailure:
        check(True, "archive traversal rejected")
    mock_tools = folder / "tools"
    mock_package = mock_tools / "openclaw-2026.9.9/node_modules/openclaw/package.json"
    mock_package.parent.mkdir(parents=True)
    mock_package.write_text(json.dumps({"name": "openclaw", "version": "2026.9.9", "license": "MIT"}))
    (mock_tools / "openclaw-2026.9.9/package-lock.json").write_text(json.dumps({"packages": {
        "node_modules/openclaw": {"version": "2026.9.9"}}}))
    count_installed, sbom_sha = provision.write_installed_sbom(contract, mock_tools, folder / "state")
    check(count_installed == 1 and len(sbom_sha) == 64, "installed package SBOM receipt")
    mock_package.write_text(json.dumps({"name": "openclaw", "version": "2026.9.9"}))
    provision.write_installed_sbom(contract, mock_tools, folder / "state")
    sbom = json.loads((folder / "state/recovery/installed-controller-sbom.json").read_text())
    check(sbom["undeclared_license_count"] == 1 and sbom["packages"][0]["license"] == "UNKNOWN",
          "undeclared dependency license remains visibly unresolved")

result = subprocess.run(["/usr/bin/python3", str(here / "provision-local-controller.py"),
                         "--verify-contract-only"], capture_output=True, text=True, check=True)
snapshot = json.loads(result.stdout)
check(snapshot["model_calls"] == 0 and snapshot["network_calls"] == 0, "read-only contract check")
node = shutil.which("node")
check(node is not None, "release environment provides Node for source checks")
result = subprocess.run([node, str(resources / "provision-local-controller.mjs"),
                         "--verify-contract-only", "--resources", str(resources)],
                        capture_output=True, text=True, check=True)
snapshot = json.loads(result.stdout)
check(snapshot["model_calls"] == 0 and snapshot["network_calls"] == 0,
      "stock-macOS Node continuation contract check")
release = (here / "build-release.sh").read_text()
installer = (here / "install-os1.sh").read_text()
app = (here.parent / "Sources/OS1App/OS1App.swift").read_text()
shell = (resources / "provision-local-controller.sh").read_text()
for name in ("local-router-config.template.json", "local-controller-sources.json", "local-controller-package.json",
             "local-controller-package-lock.json", "local-controller-NOTICES.txt",
             "setup-os1-openclaw-local-router.py", "provision-local-controller.py",
             "provision-local-controller.sh", "provision-local-controller.mjs"):
    check(release.count('Contents/Resources/' + name) >= 2, "staged and expanded release allowlist: " + name)
    check(('Contents/Resources/' + name) in installer, "installer allowlist: " + name)
for name in ("index.mjs", "openclaw.plugin.json", "package.json"):
    relative = "openclaw-os1-bridge/" + name
    check(release.count('Contents/Resources/' + relative) >= 2, "signed plugin staged and allowed: " + relative)
    check(('Contents/Resources/' + relative) in installer, "installer signed plugin allowlist: " + relative)
check(installer.index("expected_payload_files=36") < installer.index("pkgutil --expand-full"), "versioned exact payload count")
check(app.index("SelfUpdate.isInstalledApp") < app.index("provision-local-controller.sh"), "installed GUI only")
check('process.environment = ["HOME":' in app and 'FileHandle.nullDevice' in app,
      "clean non-interactive provisioning child")
check("/usr/bin/python3" not in shell and "/bin/bash" in shell and "exec /usr/bin/env -i" in shell,
      "consumer first stage needs only stock macOS tools and a clean environment")
for architecture in ("arm64", "x86_64"):
    check(contract["node"][architecture]["sha256"] in shell and
          contract["node"][architecture]["binary_sha256"] in shell,
          "shell Node asset and binary pins match signed source contract: " + architecture)
check('tools"' in (resources / "local-router-config.template.json").read_text(), "bounded tool configuration retained")
provision_js = (resources / "provision-local-controller.mjs").read_text()
check(provision_js.index("extract(archive, stage)") < provision_js.index("fs.renameSync(stage, prefix)") and
      "staged_ollama_binary_mismatch" in provision_js and "ollama-incomplete-" in provision_js,
      "interrupted Ollama extraction cannot activate an incomplete prefix")
check("Object.keys(existing).sort().join('|') === Object.keys(manifest).sort().join('|')" in provision_js and
      "Object.entries(manifest).every(([key, value]) => existing[key] === value)" in provision_js,
      "manifest key order cannot reject a semantically identical activation")
setup_text = (repo / "scripts/setup-os1-openclaw-local-router.py").read_text()
check("Managed dependency graph does not match the requested v1 activation" in setup_text,
      "optional Python v1 activation cannot relabel an unmatched private dependency graph")
print(f"PASS: {count} local-controller provisioning contract checks; model calls 0; network calls 0")
