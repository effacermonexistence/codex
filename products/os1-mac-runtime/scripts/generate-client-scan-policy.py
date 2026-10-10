#!/usr/bin/env python3
"""Bind public release scanner exceptions to exact committed and packaged bytes.

The source tree may be dirty during a local self-repair build. Public registry
integrity values remain public data only if their *individual producing files*
still match the immutable commit and the expanded package. Whole-tree
cleanliness controls source-identity stamping, not those exact token facts.
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


RESOURCE_PREFIX = "products/os1-mac-runtime/Resources/"
RESOURCE_NAMES = (
    "local-controller-package-lock.json",
    "local-controller-sources.json",
)
SETUP_RELATIVE = "scripts/setup-os1-openclaw-local-router.py"
INSTALLED_PREFIX = Path("Applications/OS-1 CLODEX.app/Contents/Resources")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def committed_bytes(root: Path, commit: str, relative: str) -> bytes:
    result = subprocess.run(
        ["git", "--no-optional-locks", "-C", str(root), "show", f"{commit}:{relative}"],
        capture_output=True,
        check=False,
    )
    require(result.returncode == 0, f"Missing committed public scan source: {relative}")
    return result.stdout


def verified_public_bytes(
    root: Path, expanded_payload: Path, commit: str, relative: str, installed_name: str,
) -> bytes:
    source = (root / relative).read_bytes()
    require(source == committed_bytes(root, commit, relative),
            f"Public scan source differs from commit: {relative}")
    installed = (expanded_payload / INSTALLED_PREFIX / installed_name).read_bytes()
    require(installed == source, f"Packaged public scan source differs: {installed_name}")
    return source


def generate(
    policy_path: Path, output_path: Path, commit: str, source_clean: bool,
    root: Path, expanded_payload: Path,
) -> dict:
    require(re.fullmatch(r"[0-9a-f]{40}", commit) is not None, "Invalid release source commit")
    root = root.resolve()
    policy = json.loads(policy_path.read_bytes())
    allowed = policy["entropy"]["allowedTokenSha256"]
    require(isinstance(allowed, list), "Invalid public scan policy")

    # Do not weaken the existing clean-only source-commit and compiler-path
    # exception. Dirty local builds receive neither source identity stamp.
    if source_clean:
        require(str(root).startswith(str(Path.home()) + "/"),
                "Source root outside approved HOME")
        for token in (commit, str(root)):
            fingerprint = sha256(token.encode())
            if fingerprint not in allowed:
                allowed.append(fingerprint)

    # Exact npm SHA-512 values are a reproducible *public* acquisition
    # contract, not credentials. Check the tracked lock, the source metadata,
    # and the helper containing the top-level pin against this commit and the
    # expanded package, even if an unrelated source path is dirty. No file-
    # wide, entropy-prefix, or unknown-token exception is issued.
    lock_bytes = verified_public_bytes(
        root, expanded_payload, commit, RESOURCE_PREFIX + RESOURCE_NAMES[0], RESOURCE_NAMES[0]
    )
    sources_bytes = verified_public_bytes(
        root, expanded_payload, commit, RESOURCE_PREFIX + RESOURCE_NAMES[1], RESOURCE_NAMES[1]
    )
    setup_bytes = verified_public_bytes(
        root, expanded_payload, commit, SETUP_RELATIVE, "setup-os1-openclaw-local-router.py"
    )
    lock = json.loads(lock_bytes)
    sources = json.loads(sources_bytes)
    top = lock["packages"]["node_modules/openclaw"]
    require(top["integrity"] == sources["controller"]["integrity"] and
            top["resolved"] == sources["controller"]["url"],
            "Public controller pin differs between lock and source metadata")
    require(top["integrity"].encode() in setup_bytes,
            "Public controller pin differs in the packaged setup helper")
    provenance = policy.setdefault("publicTokenProvenance", {})
    lock_sha = sha256(lock_bytes)
    for name, row in lock["packages"].items():
        if not isinstance(row, dict) or "integrity" not in row:
            continue
        integrity = row["integrity"]
        resolved = row.get("resolved", "")
        require(isinstance(integrity, str) and
                re.fullmatch(r"sha512-[A-Za-z0-9+/]+={0,2}", integrity) is not None,
                "Invalid public npm integrity shape")
        require(len(base64.b64decode(integrity[7:], validate=True)) == 64,
                "Invalid public npm integrity digest")
        require(isinstance(resolved, str) and
                resolved.startswith("https://registry.npmjs.org/"),
                "Public integrity is not a registry package")
        fingerprint = sha256(integrity.encode())
        if fingerprint not in allowed:
            allowed.append(fingerprint)
        provenance[fingerprint] = {
            "tokenKind": "public_npm_sha512_integrity",
            "source": resolved,
            "sourceLockSHA256": lock_sha,
            "package": name,
            "description": "Exact public registry integrity in the pinned OS-1 acquisition lock; not a credential.",
        }

    if source_clean:
        # This compiler-emitted type path is public source data only for a
        # clean build. Keep it tied to the exact source declaration.
        type_file = root / "products/os1-mac-runtime/Sources/OS1App/ConsumerChatGPTConnectionPanel.swift"
        type_bytes = type_file.read_bytes()
        require(b"struct ConsumerChatGPTConnectionPanel: View" in type_bytes,
                "Missing public source declaration for compiler path")
        token = str(root) + "/products/os1-mac-runtime/Sources/OS1App/ConsumerChatGPTConnectionPanel"
        fingerprint = sha256(token.encode())
        if fingerprint not in allowed:
            allowed.append(fingerprint)
        provenance[fingerprint] = {
            "tokenKind": "public_compiler_source_type_path",
            "source": str(type_file),
            "sourceSHA256": sha256(type_bytes),
            "description": "Exact compiler-emitted source/type path for a public OS-1 view.",
        }
    output_path.write_text(json.dumps(policy, sort_keys=True), encoding="utf-8")
    return policy


if __name__ == "__main__":
    require(len(sys.argv) == 7,
            "usage: generate-client-scan-policy.py POLICY OUTPUT COMMIT CLEAN ROOT EXPANDED_PAYLOAD")
    generate(
        Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4] == "1",
        Path(sys.argv[5]), Path(sys.argv[6]),
    )
