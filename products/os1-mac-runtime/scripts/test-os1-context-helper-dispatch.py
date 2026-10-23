#!/usr/bin/env python3
"""Synthetic stdout protocol regression. Only explicit fixture binaries run; no providers."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CONTROL = b"Native turn control: 26 synthetic grammar checks PASS; model/provider calls 0\n"


def require(value, label):
    if not value:
        raise AssertionError(label)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def request_bytes():
    # A plain decoder-only Request, not a real task, capability or authority.
    text = "Synthetic helper-dispatch protocol fixture."
    return json.dumps({"schema": 1, "task_id": "fixture_dispatch", "request": text,
        "request_sha256": sha(text.encode()), "objective": text,
        "policy_sha256": sha(b"fixture-policy"), "source_fingerprint": sha(b"fixture-source"),
        "mode": "auto", "material_refs": [],
        "budget": {"max_attempts": 1, "max_parallel": 1, "max_cost_units": None,
                   "max_duration_ms": 1000}}, sort_keys=True).encode()


def run(binary, args):
    return subprocess.run([str(binary), *args], capture_output=True, timeout=15)


def source_checks():
    source = (ROOT / "Tests/OS1ContextTests/SourceContextTests.swift").read_text()
    normal = list(re.finditer(r"^        try nativeTurnControlFixture\(\)$", source, re.M))
    require(len(normal) == 1, "normal fixture must run exactly once")
    pos = normal[0].start()
    for marker in ["voiceProcessChildIfRequested()", "memoryWriteTransactionChildIfRequested()",
                   'contains("--rcc-core-validate-request")', '"--check-output-contract"',
                   'contains("--owner-policy-only")']:
        require(source.index(marker) < pos, "normal fixture precedes helper/protocol return: " + marker)
    require('contains("--native-turn-control-only") { try nativeTurnControlFixture(); return }' in source,
            "isolated grammar fixture branch remains available")
    require(pos < source.index("try runExecutionWorkspaceFixtures()"), "normal grammar fixture remains in full suite")
    voice = (ROOT / "Tests/OS1ContextTests/VoiceProcessTests.swift").read_text()
    require("precondition(data == Data(repeating: 65, count: 1_000_000))" in voice,
            "strict byte equality must not be weakened")
    return {"normal_fixture_after_protocol_returns": True, "normal_fixture_kept": True,
            "strict_voice_byte_assertion_kept": True}


def inspect(binary, request, *, before=False):
    binary = Path(binary).resolve(strict=True)
    voice = run(binary, ["--voice-output-fixture"])
    require(voice.returncode == 0 and voice.stderr == b"B" * 1_000_000, "voice child status/stderr")
    expected = b"A" * 1_000_000
    require(voice.stdout == expected + CONTROL if before else voice.stdout == expected,
            "before/after exact voice stdout")
    metadata = run(binary, ["--rcc-core-validate-request", str(request)])
    require(metadata.returncode == 0 and metadata.stderr == b"", "metadata child status/stderr")
    expected_json = b'{"task_id":"fixture_dispatch","validated":true}\n'
    require(metadata.stdout == CONTROL + expected_json if before else metadata.stdout == expected_json,
            "before/after exact metadata JSON stdout")
    if not before:
        grammar = run(binary, ["--native-turn-control-only"])
        require(grammar.returncode == 0 and grammar.stdout == CONTROL and grammar.stderr == b"",
                "all 26 grammar checks still run in isolated branch")
    return {"binary_sha256": sha(binary.read_bytes()), "voice_stdout_bytes": len(voice.stdout),
            "voice_stderr_bytes": len(voice.stderr), "voice_stdout_sha256": sha(voice.stdout),
            "metadata_stdout_bytes": len(metadata.stdout), "metadata_stdout_sha256": sha(metadata.stdout),
            "expected_contamination_observed": before, "isolated_26_checks_verified": not before}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--before-binary", type=Path)
    parser.add_argument("--source-only", action="store_true")
    args = parser.parse_args()
    require(args.source_only or args.binary is not None, "provide --binary or --source-only")
    result = {"schema": 1, "kind": "synthetic_test_helper_stdout_regression", "source": source_checks(),
              "model_calls": 0, "provider_calls": 0}
    with tempfile.TemporaryDirectory(prefix="os1-helper-dispatch-") as directory:
        request = Path(directory) / "request.json"; request.write_bytes(request_bytes())
        if args.before_binary:
            result["before"] = inspect(args.before_binary, request, before=True)
        if args.binary:
            result["after"] = inspect(args.binary, request)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
