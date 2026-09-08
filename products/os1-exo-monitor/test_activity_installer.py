"""Run the real Air installer in a temporary home with fake OS boundaries.

No launchctl, network, installed Python, wrapper, or real plist is invoked.
Only the absolute PlistBuddy command is redirected in the fixture copy.
"""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


PRODUCT = Path(__file__).resolve().parent
MOCK_COMMAND = r'''
import json, os, pathlib, shutil, sys
root = pathlib.Path(os.environ["TASK_FIXTURE_ROOT"])
command = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
scenario = os.environ["TASK_FIXTURE_SCENARIO"]
state_path = root / "state.json"
state = json.loads(state_path.read_text()) if state_path.exists() else {}
def count(key):
    state[key] = state.get(key, 0) + 1
    state_path.write_text(json.dumps(state))
    return state[key]
def fail():
    with (root / "faults.log").open("a") as log:
        log.write(command + ":" + scenario + "\n")
    sys.exit(74)
if command == "id":
    print("fixture" if args == ["-un"] else "501")
elif command == "dscl":
    print("NFSHomeDirectory: " + str(root / "home"))
elif command == "plutil":
    obj = json.loads(pathlib.Path(args[-1]).read_text())
    print(obj["Label"] if args[1] == "Label" else obj["ProgramArguments"][0])
elif command == "PlistBuddy":
    path = pathlib.Path(args[-1])
    obj = json.loads(path.read_text())
    operation = args[1].split(" ")
    key = operation[1].split(":")[-1]
    obj["EnvironmentVariables"][key] = operation[-1]
    path.write_text(json.dumps(obj))
    if scenario == "plist_failure": fail()
elif command == "python":
    print(root / "runtime" / "runtime-venv" / "lib" / "site-packages")
elif command == "curl":
    url = args[-1]
    if url.endswith("node_id"):
        nth = count("node_reads")
        changed = scenario in ("identity_failure", "rollback_bootstrap_failure") and nth > 1
        print('"changed-node"' if changed else '"original-node"')
    elif url.endswith("state/topology"):
        print('{"nodes":[{},{}]}')
    else:
        print('{}')
elif command == "launchctl":
    with (root / "launch.log").open("a") as log:
        log.write(json.dumps(args) + "\n")
    if args[0] == "bootstrap":
        nth = count("bootstraps")
        if scenario == "rollback_bootstrap_failure" and nth == 2: fail()
elif command == "cp":
    source, target = pathlib.Path(args[-2]), pathlib.Path(args[-1])
    if scenario == "copy_failure" and source == root / "product/os1_exo_activity_bootstrap.pth": fail()
    os.execv("/bin/cp", ["/bin/cp"] + args)
elif command == "mv":
    if scenario == "replace_failure" and args[-1].endswith("os1_exo_activity_bootstrap.pth"): fail()
    os.execv("/bin/mv", ["/bin/mv"] + args)
elif command == "jq":
    print(2)
elif command == "seq":
    print(1)
elif command == "sleep":
    pass
elif command in ("git", "uv", "lipo", "codesign"):
    raise SystemExit("packaged-runtime command must never run for Air: " + command)
else:
    raise SystemExit("unexpected command: " + command)
'''


class ActivityInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="os1-activity-installer-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.commands = self.root / "commands"
        self.commands.mkdir()
        self.runtime = self.root / "runtime"
        self.site = self.runtime / "runtime-venv/lib/site-packages"
        self.site.mkdir(parents=True)
        # Match the actual Air wrapper's PYTHONPATH source layout, with no exo
        # installation in site-packages. The wrapper itself must stay untouched.
        (self.runtime / "source/src/exo/api").mkdir(parents=True)
        self.wrapper = self.runtime / "run-air.sh"
        self.wrapper.write_text("#!/bin/sh\nexit 91 # fixture wrapper must never run\n")
        self.wrapper.chmod(0o755)
        self.plist = self.home / "Library/LaunchAgents/com.os1.exo-air.plist"
        self.plist.parent.mkdir(parents=True)
        self.plist.write_text(json.dumps({
            "Label": "com.os1.exo-air", "ProgramArguments": [str(self.wrapper)],
            "EnvironmentVariables": {"EXO_DASHBOARD_DIR": "official-dashboard"},
        }))
        self.original_plist = self.plist.read_bytes()
        self.original_wrapper = self.wrapper.read_bytes()
        self.overlay = self.site / "os1_exo_activity_overlay.py"
        self.bootstrap = self.site / "os1_exo_activity_bootstrap.pth"
        self.overlay.write_text("previous overlay\n")
        self.bootstrap.write_text("previous bootstrap\n")
        self.product = self.root / "product"
        (self.product / "dashboard-build").mkdir(parents=True)
        (self.product / "dashboard-build/index.html").write_text("new dashboard")
        (self.product / self.overlay.name).write_text("new overlay\n")
        (self.product / self.bootstrap.name).write_text("new bootstrap\n")
        fixture_command = self.commands / "fixture-command"
        fixture_command.write_text("#!/usr/bin/env python3\n" + MOCK_COMMAND)
        fixture_command.chmod(0o755)
        (self.commands / "python3").symlink_to(sys.executable)
        for name in ("id", "dscl", "plutil", "PlistBuddy", "python", "curl", "launchctl",
                     "cp", "mv", "jq", "seq", "sleep", "git", "uv", "lipo", "codesign"):
            (self.commands / name).symlink_to(fixture_command)
        python = self.runtime / "runtime-venv/bin/python"
        python.parent.mkdir()
        python.symlink_to(self.commands / "python")
        source = (PRODUCT / "install-activity-monitor.sh").read_text()
        self.assertIn("/usr/libexec/PlistBuddy", source)
        self.installer = self.product / "install-activity-monitor.sh"
        self.installer.write_text(source.replace("/usr/libexec/PlistBuddy", str(self.commands / "PlistBuddy")))

    def run_installer(self, scenario="success"):
        environment = dict(os.environ, PATH=str(self.commands) + ":/usr/bin:/bin",
                           TASK_FIXTURE_ROOT=str(self.root), TASK_FIXTURE_SCENARIO=scenario,
                           TMPDIR=str(self.root))
        return subprocess.run(["/bin/bash", str(self.installer), "air"], env=environment,
                              capture_output=True, text=True, timeout=20)

    def service_calls(self):
        log = self.root / "launch.log"
        return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []

    def assert_fault_reached(self, expected):
        self.assertTrue((self.root / "faults.log").exists(), "installer did not reach injected failure")
        self.assertIn(expected, (self.root / "faults.log").read_text().splitlines())

    def assert_original_files(self):
        self.assertEqual(self.plist.read_bytes(), self.original_plist)
        self.assertEqual(self.wrapper.read_bytes(), self.original_wrapper)
        self.assertEqual(self.overlay.read_text(), "previous overlay\n")
        self.assertEqual(self.bootstrap.read_text(), "previous bootstrap\n")
        self.assertEqual(list(self.site.glob(".os1-exo-activity-*")), [])

    def test_success_supports_wrapper_source_layout_and_preserves_wrapper(self):
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("OS1_EXO_ACTIVITY_READY", result.stdout)
        self.assertEqual(self.wrapper.read_bytes(), self.original_wrapper)
        environment = json.loads(self.plist.read_text())["EnvironmentVariables"]
        self.assertEqual(environment["EXO_DASHBOARD_DIR"], "official-dashboard")
        self.assertTrue(Path(environment["OS1_EXO_ACTIVITY_DASHBOARD_DIR"], "index.html").is_file())
        self.assertEqual(self.overlay.read_text(), "new overlay\n")
        self.assertEqual([call[0] for call in self.service_calls()], ["bootout", "bootstrap"])

    def test_explicit_identity_failure_rolls_back_service_and_files(self):
        result = self.run_installer("identity_failure")
        self.assertNotEqual(result.returncode, 0)
        self.assert_original_files()
        self.assertIn("prior service restored", result.stderr)
        self.assertEqual([call[0] for call in self.service_calls()],
                         ["bootout", "bootstrap", "bootout", "bootstrap"])

    def test_failed_source_copy_never_changes_startup_files(self):
        result = self.run_installer("copy_failure")
        self.assertNotEqual(result.returncode, 0)
        self.assert_fault_reached("cp:copy_failure")
        self.assert_original_files()
        self.assertEqual(self.service_calls(), [])

    def test_partial_overlay_replacement_restores_before_service_switch(self):
        result = self.run_installer("replace_failure")
        self.assertNotEqual(result.returncode, 0)
        self.assert_fault_reached("mv:replace_failure")
        self.assert_original_files()
        self.assertEqual(self.service_calls(), [])
        self.assertIn("prior files restored", result.stderr)

    def test_partial_plist_mutation_restores_before_service_switch(self):
        result = self.run_installer("plist_failure")
        self.assertNotEqual(result.returncode, 0)
        self.assert_fault_reached("PlistBuddy:plist_failure")
        self.assert_original_files()
        self.assertEqual(self.service_calls(), [])

    def test_failed_rollback_bootstrap_is_not_reported_as_recovered(self):
        result = self.run_installer("rollback_bootstrap_failure")
        self.assertNotEqual(result.returncode, 0)
        self.assert_fault_reached("launchctl:rollback_bootstrap_failure")
        self.assert_original_files()
        self.assertIn("rollback incomplete", result.stderr)
        self.assertNotIn("prior service restored", result.stderr)

    def test_absent_old_overlay_is_removed_after_failure(self):
        self.overlay.unlink()
        self.bootstrap.unlink()
        result = self.run_installer("identity_failure")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("EXO peer identity changed unexpectedly", result.stderr)
        self.assertEqual([call[0] for call in self.service_calls()],
                         ["bootout", "bootstrap", "bootout", "bootstrap"])
        self.assertFalse(self.overlay.exists())
        self.assertFalse(self.bootstrap.exists())
        self.assertEqual(self.plist.read_bytes(), self.original_plist)

    def test_air_rejects_packaged_runtime_before_any_service_change(self):
        obj = json.loads(self.plist.read_text())
        executable = self.runtime / "exo"
        executable.write_text("#!/bin/sh\nexit 91\n")
        executable.chmod(0o755)
        obj["ProgramArguments"] = [str(executable)]
        self.plist.write_text(json.dumps(obj))
        before = self.plist.read_bytes()
        result = self.run_installer()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires the existing source runtime", result.stderr)
        self.assertEqual(self.plist.read_bytes(), before)
        self.assertEqual(self.service_calls(), [])


if __name__ == "__main__":
    unittest.main()
