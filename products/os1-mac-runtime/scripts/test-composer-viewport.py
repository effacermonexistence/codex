#!/usr/bin/env python3
"""Release-wired bounded composer geometry test. No OS-1 app or draft store.

Compile the exact checked-in AppKit helper and fixture into a temporary tree.
Only synthetic text is used; compiler cache, HOME and TMPDIR are isolated.
"""
from pathlib import Path
import json
import os
import re
import signal
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "Sources/OS1App/OS1App.swift"
HELPER = ROOT / "Sources/OS1App/ComposerViewportMetrics.swift"
FIXTURE = ROOT / "scripts/fixtures/ComposerViewportMetricsFixture.swift"
RELEASE = ROOT / "scripts/build-release.sh"


def validate_wiring(app: str, helper: str, release: str) -> None:
    composer = app.split("private struct ComposerView: View {", 1)[1]
    start = composer.index("private var editorHeight: CGFloat {")
    end = composer.index("\n    }", start) + len("\n    }")
    body = composer[start:end]
    assert re.fullmatch(r"private var editorHeight: CGFloat \{\s*"
        r"ComposerViewportMetrics\.height\(for: store\.composer, editorWidth: editorWidth\)\s*\}", body), "editorHeight must use only the bounded helper"
    assert "boundingRect" not in body and "greatestFiniteMagnitude" not in body, "full-draft sizing returned to the live property"
    assert re.search(r"ClodexComposerEditor\(\s*text: \$store\.composer,\s*onSubmit: store\.send,\s*"
        r"onCancelVoice: store\.cancelVoiceDictation\s*\)\s*\.frame\(height: editorHeight\)", composer), "actual bound text editor must use editorHeight"
    for required in ("measurementUTF8Limit = 2_048", "draft.utf8.makeIterator()", "0..<measurementUTF8Limit",
                     "guard iterator.next() == nil else { return nil }",
                     "guard let text = boundedMeasurementText(draft) else { return maximumHeight }",
                     "height: maximumHeight - 24"):
        assert required in helper, "bounded measurement source gate missing: " + required
    assert not re.search(r"\.(?:count|characters)\b|\.prefix\s*\(", helper), "do not scan unbounded graphemes or full input length"
    assert ".greatestFiniteMagnitude" not in helper and "UserDefaults" not in helper, "helper must not restore unbounded layout or access draft storage"
    calls = [line.strip() for line in release.splitlines() if not line.lstrip().startswith("#")]
    invocation = 'python3 "$script_dir/test-composer-viewport.py"'
    assert calls.count(invocation) == 1, "release must run this exact regression once"
    version_lines = [index for index, line in enumerate(calls) if line.startswith("readonly version=")]
    assert len(version_lines) == 1, "release version boundary must be unique"
    assert calls.index(invocation) < version_lines[0], "regression must run in early source checks"


def bounded_run(argv, *, cwd: Path, env: dict, timeout: int) -> bytes:
    process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)
        raise AssertionError("owned composer-test process exceeded " + str(timeout) + " seconds")
    if process.returncode:
        raise AssertionError("composer-test process failed: " + stderr.decode("utf-8", "replace")[:8_192])
    return stdout


def main() -> None:
    app, helper, release = APP.read_text(), HELPER.read_text(), RELEASE.read_text()
    validate_wiring(app, helper, release)
    mutants = [
        (app.replace("ComposerViewportMetrics.height(for: store.composer, editorWidth: editorWidth)", "48", 1), helper, release),
        (app.replace(".frame(height: editorHeight)", ".frame(height: 48)", 1), helper, release),
        (app, helper.replace("0..<measurementUTF8Limit", "0..<draft.count", 1), release),
        (app, helper.replace("height: maximumHeight - 24", "height: .greatestFiniteMagnitude", 1), release),
        (app, helper, release.replace('python3 "$script_dir/test-composer-viewport.py"', "# omitted composer test", 1)),
        (app, helper, release.replace('python3 "$script_dir/test-composer-viewport.py"',
            '# python3 "$script_dir/test-composer-viewport.py"', 1) +
            '\npython3 "$script_dir/test-composer-viewport.py"\n'),
    ]
    for mutant in mutants:
        try:
            validate_wiring(*mutant)
        except (AssertionError, ValueError, IndexError):
            pass
        else:
            raise AssertionError("unused/unbounded composer regression was not detected")
    with tempfile.TemporaryDirectory(prefix="os1-composer-viewport-") as directory:
        temp = Path(directory)
        for name in ("home", "tmp", "module-cache"):
            (temp / name).mkdir(mode=0o700)
        env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C", "HOME": str(temp / "home"),
               "CFFIXED_USER_HOME": str(temp / "home"), "TMPDIR": str(temp / "tmp"),
               "PYTHONDONTWRITEBYTECODE": "1", "CLANG_MODULE_CACHE_PATH": str(temp / "module-cache")}
        compiler = bounded_run(["/usr/bin/xcrun", "--find", "swiftc"], cwd=temp, env=env, timeout=15).decode().strip()
        assert Path(compiler).is_absolute(), "xcrun did not return an absolute Swift compiler"
        sdk = bounded_run(["/usr/bin/xcrun", "--sdk", "macosx", "--show-sdk-path"],
                          cwd=temp, env=env, timeout=15).decode().strip()
        assert Path(sdk).is_absolute() and Path(sdk).is_dir(), "xcrun did not return a macOS SDK"
        binary = temp / "fixture"
        bounded_run([compiler, "-sdk", sdk, "-O", "-parse-as-library", "-framework", "AppKit", "-module-cache-path",
                     str(temp / "module-cache"), str(HELPER), str(FIXTURE), "-o", str(binary)],
                    cwd=temp, env=env, timeout=120)
        result = json.loads(bounded_run([str(binary)], cwd=temp, env=env, timeout=20))
        assert result == {"status": "PASS", "checks": 154, "actual_drafts_read": 0,
                          "user_defaults_writes": 0, "models": 0}, "actual AppKit fixture did not complete all checks"
    print("Composer viewport: live editor binding + 6 rejected regressions + 154 actual AppKit checks PASS; synthetic inputs only, model/app/draft-store calls 0")


if __name__ == "__main__":
    main()
