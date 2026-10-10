#!/usr/bin/env python3
"""Offline exact-token scanner regression for an unrelated dirty source tree."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
GENERATOR = HERE / "generate-client-scan-policy.py"
spec = importlib.util.spec_from_file_location("os1_client_scan_policy", GENERATOR)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def git(root: Path, *arguments: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *arguments], text=True).strip()


with tempfile.TemporaryDirectory(prefix="os1-public-lock-policy-") as directory:
    root = Path(directory) / "source"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.name", "OS1 Fixture")
    git(root, "config", "user.email", "fixture@example.invalid")
    app_resources = root / module.RESOURCE_PREFIX
    app_resources.mkdir(parents=True)
    setup_path = root / module.SETUP_RELATIVE
    setup_path.parent.mkdir(parents=True)
    for name in module.RESOURCE_NAMES:
        shutil.copyfile(REPO / module.RESOURCE_PREFIX / name, app_resources / name)
    shutil.copyfile(REPO / module.SETUP_RELATIVE, setup_path)
    git(root, "add", ".")
    git(root, "commit", "-qm", "exact public pin fixture")
    commit = git(root, "rev-parse", "HEAD")

    expanded = Path(directory) / "expanded"
    packaged = expanded / module.INSTALLED_PREFIX
    packaged.mkdir(parents=True)
    for name in module.RESOURCE_NAMES:
        shutil.copyfile(app_resources / name, packaged / name)
    shutil.copyfile(setup_path, packaged / setup_path.name)
    policy_path = Path(directory) / "policy.json"
    output_path = Path(directory) / "source-bound.json"
    policy_path.write_text(json.dumps({
        "forbiddenPathFragments": [],
        "forbiddenContentFragments": [],
        "entropy": {"minimumLength": 48, "minimumBitsPerCharacter": 4.7,
                    "allowedTokenSha256": []},
    }))

    # An unrelated untracked file makes the tree dirty. Public source files
    # are nevertheless byte-identical to the committed and packaged files.
    (root / "unrelated-generated-output.txt").write_text("not release source")
    assert git(root, "status", "--porcelain=v1")
    result = module.generate(policy_path, output_path, commit, False, root, expanded)
    lock = json.loads((app_resources / module.RESOURCE_NAMES[0]).read_bytes())
    top = lock["packages"]["node_modules/openclaw"]["integrity"]
    fingerprint = hashlib.sha256(top.encode()).hexdigest()
    assert fingerprint in result["entropy"]["allowedTokenSha256"]
    assert result["publicTokenProvenance"][fingerprint]["tokenKind"] == "public_npm_sha512_integrity"
    assert hashlib.sha256(commit.encode()).hexdigest() not in result["entropy"]["allowedTokenSha256"]
    scanned = subprocess.check_output([
        "node", str(REPO / "products/os1-route-core/scripts/client-artifact-scan.mjs"),
        str(packaged / module.RESOURCE_NAMES[0]),
        str(packaged / module.RESOURCE_NAMES[1]),
        str(packaged / setup_path.name),
    ], env={**__import__("os").environ, "OS1_CLIENT_SCAN_POLICY_PATH": str(output_path)}, text=True)
    assert json.loads(scanned)["findings"] == []

    # A changed working lock or changed packaged lock may not inherit the
    # committed public-token exception. This is not a generic entropy bypass.
    lock_path = app_resources / module.RESOURCE_NAMES[0]
    original = lock_path.read_bytes()
    lock_path.write_bytes(original + b" ")
    try:
        module.generate(policy_path, output_path, commit, False, root, expanded)
        raise AssertionError("mutated working lock unexpectedly accepted")
    except ValueError as error:
        assert "differs from commit" in str(error)
    lock_path.write_bytes(original)
    packaged_lock = packaged / module.RESOURCE_NAMES[0]
    packaged_lock.write_bytes(original + b" ")
    try:
        module.generate(policy_path, output_path, commit, False, root, expanded)
        raise AssertionError("mutated packaged lock unexpectedly accepted")
    except ValueError as error:
        assert "Packaged public scan source differs" in str(error)

print("Public npm scan policy: unrelated dirty source accepted only for exact committed and packaged lock bytes; tampering rejected")
