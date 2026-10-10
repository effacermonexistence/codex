#!/usr/bin/env python3
"""Compile the actual Swift controller/runner and exercise fake local binaries.

No OpenClaw, Ollama, hosted model, provider, browser, or OS-1 app is invoked.
The runner is copied to a temporary single-module compile only to remove its
`import OS1Context`; the logic itself is not mocked.
"""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / "Sources/OS1Context/OpenClawAgentController.swift"
RUNNER = ROOT / "Sources/OS1/LocalOpenClawGatewayRunner.swift"
FIXTURE = ROOT / "scripts/fixtures/LocalOpenClawGatewayRunnerFixture.swift"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="os1-offline-gateway-") as tmp:
        temp = Path(tmp)
        local_runner = temp / "LocalOpenClawGatewayRunner.swift"
        local_runner.write_text(RUNNER.read_text().replace("import OS1Context\n", ""))
        entry = temp / "fake-openclaw.mjs"
        entry.write_text("offline fake entry\n")
        plugin = temp / "OS-1 CLODEX.app/Contents/Resources/openclaw-os1-bridge"
        plugin.mkdir(parents=True)
        for name in ("index.mjs", "openclaw.plugin.json", "package.json"):
            (plugin / name).write_text(f"fixture {name}\n")
        binary = temp / "fixture"
        subprocess.run([
            "swiftc", "-parse-as-library", "-o", str(binary), str(CONTROLLER),
            str(local_runner), str(FIXTURE)
        ], check=True, cwd=temp)
        env = dict(os.environ, PYTHON_BIN=sys.executable)
        subprocess.run([str(binary), str(temp)], check=True, env=env, cwd=temp)


if __name__ == "__main__":
    main()
