import builtins
import asyncio
import importlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace


class _FakeApp:
    def __init__(self) -> None:
        self.routes = []

    def get(self, path: str):
        def register(function):
            self.routes.append(SimpleNamespace(path=path, endpoint=function))
            return function

        return register


class _FakeAPI:
    def __init__(self) -> None:
        self.app = _FakeApp()

    def _setup_routes(self) -> None:
        self.app.get("/node_id")(lambda: "node")


class _FakeMacmonMetrics:
    @classmethod
    def from_raw_json(cls, raw):
        value = json.loads(raw)
        return SimpleNamespace(system_profile=SimpleNamespace(**value["profile"]))


def test_overlay_registers_exactly_one_activity_route(monkeypatch) -> None:
    exo = ModuleType("exo")
    exo_api = ModuleType("exo.api")
    exo_main = ModuleType("exo.api.main")
    exo_main.API = _FakeAPI
    monkeypatch.setitem(sys.modules, "exo", exo)
    monkeypatch.setitem(sys.modules, "exo.api", exo_api)
    monkeypatch.setitem(sys.modules, "exo.api.main", exo_main)
    macmon = ModuleType("exo.utils.info_gatherer.macmon")
    macmon.MacmonMetrics = _FakeMacmonMetrics
    monkeypatch.setitem(sys.modules, "exo.utils.info_gatherer.macmon", macmon)
    sys.modules.pop("os1_exo_activity_overlay", None)

    importlib.import_module("os1_exo_activity_overlay")
    api = _FakeAPI()
    api._setup_routes()
    api._setup_routes()

    assert [route.path for route in api.app.routes].count("/activity/local") == 1


def test_overlay_sanitizes_fleet_fields() -> None:
    overlay = importlib.import_module("os1_exo_activity_overlay")
    assert overlay._sanitize_fleet_snapshot(
        {
            "nodes": [
                {
                    "device_id": "device:test",
                    "queue_depth": 2,
                    "secret": "do-not-expose",
                }
            ],
            "token": "do-not-expose",
        }
    ) == {"nodes": [{"device_id": "device:test", "queue_depth": 2}]}


def test_roaming_status_freshness_and_allowlist(tmp_path):
    overlay = importlib.import_module("os1_exo_activity_overlay")
    now = datetime(2026, 9, 7, tzinfo=timezone.utc)
    path = tmp_path / "status.json"
    path.write_text(json.dumps({"schema": 1, "role": "pro", "state": "connected",
                               "sampled_at": now.isoformat(), "ssid": "private", "token": "private"}))
    result = overlay._read_roaming_status(path, now)
    assert result["available"] and not result["stale"]
    assert "ssid" not in result and "token" not in result
    assert overlay._read_roaming_status(path, now + timedelta(seconds=61))["stale"]
    assert overlay._read_roaming_status(path, now - timedelta(seconds=10))["stale"]


def test_roaming_missing_invalid_and_oversized_fail_closed(tmp_path):
    overlay = importlib.import_module("os1_exo_activity_overlay")
    path = tmp_path / "status.json"
    assert not overlay._read_roaming_status(path)["available"]
    for content in ("{", "[]", "x" * 16_385,
                    '{"schema":1,"role":"pro","state":"connected","sampled_at":"2026-09-07T00:00:00"}'):
        path.write_text(content)
        result = overlay._read_roaming_status(path)
        assert not result["available"] and result["stale"]


def test_overlay_applies_dedicated_dashboard_after_wrapper_default(monkeypatch, tmp_path) -> None:
    overlay = importlib.import_module("os1_exo_activity_overlay")
    (tmp_path / "index.html").write_text("activity dashboard")
    monkeypatch.setenv("EXO_DASHBOARD_DIR", "official-dashboard")
    monkeypatch.setenv("OS1_EXO_ACTIVITY_DASHBOARD_DIR", str(tmp_path))
    imported_dashboard = []
    original_import = builtins.__import__

    def observing_import(name, *args, **kwargs):
        if name == "exo.api.main":
            imported_dashboard.append(overlay.os.environ["EXO_DASHBOARD_DIR"])
            return SimpleNamespace(API=_FakeAPI)
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", observing_import)
    overlay.install()
    assert imported_dashboard == [str(tmp_path)]
    assert overlay.os.environ["EXO_DASHBOARD_DIR"] == str(tmp_path)


def test_overlay_preserves_default_for_missing_dashboard(monkeypatch, tmp_path) -> None:
    overlay = importlib.import_module("os1_exo_activity_overlay")
    monkeypatch.setenv("EXO_DASHBOARD_DIR", "official-dashboard")
    monkeypatch.setenv("OS1_EXO_ACTIVITY_DASHBOARD_DIR", str(tmp_path / "missing"))
    overlay._configure_activity_dashboard()
    assert overlay.os.environ["EXO_DASHBOARD_DIR"] == "official-dashboard"


def test_bootstrap_only_activates_for_monitor_service(monkeypatch) -> None:
    calls = []
    def fixture_import(name, *args, **kwargs):
        if name == "os":
            return os
        calls.append(name)
    code = Path(__file__).with_name("os1_exo_activity_bootstrap.pth").read_text()
    monkeypatch.delenv("OS1_EXO_ACTIVITY_DASHBOARD_DIR", raising=False)
    exec(code, {"__builtins__": {"__import__": fixture_import}})
    assert calls == []
    monkeypatch.setenv("OS1_EXO_ACTIVITY_DASHBOARD_DIR", "/fixture/dashboard")
    exec(code, {"__builtins__": {"__import__": fixture_import}})
    assert calls == ["os1_exo_activity_overlay"]


def _sensor_profile(power=14.0, gpu=0.12):
    return SimpleNamespace(gpu_usage=gpu, temp=63.0, sys_power=power,
                           pcpu_usage=0.27, ecpu_usage=0.16)


def _observe(sensor, seconds, power=14.0, gpu=0.12):
    wall = datetime(2026, 9, 8, tzinfo=timezone.utc) + timedelta(seconds=seconds)
    raw = json.dumps({"timestamp": wall.isoformat()})
    sensor.observe(_sensor_profile(power=power, gpu=gpu), raw, seconds, wall)


def test_existing_bundled_sampler_selected_without_path_or_install(monkeypatch, tmp_path):
    overlay = importlib.import_module("os1_exo_activity_overlay")
    binary = tmp_path / "macmon"
    binary.write_text("fixture; must never be run")
    binary.chmod(0o755)
    monkeypatch.setenv("PATH", "")
    monkeypatch.delenv("EXO_MACMON_PATH", raising=False)
    monkeypatch.setenv("EXO_RESOURCES_DIR", str(tmp_path))
    overlay._configure_existing_sampler()
    assert os.environ["EXO_MACMON_PATH"] == str(binary)
    monkeypatch.setenv("EXO_MACMON_PATH", "/explicit/sampler")
    overlay._configure_existing_sampler()
    assert os.environ["EXO_MACMON_PATH"] == "/explicit/sampler"


def test_missing_or_nonexecutable_sampler_is_not_advertised(monkeypatch, tmp_path):
    overlay = importlib.import_module("os1_exo_activity_overlay")
    monkeypatch.delenv("EXO_MACMON_PATH", raising=False)
    monkeypatch.setenv("EXO_RESOURCES_DIR", str(tmp_path))
    overlay._configure_existing_sampler()
    assert "EXO_MACMON_PATH" not in os.environ
    (tmp_path / "macmon").write_text("not executable")
    overlay._configure_existing_sampler()
    assert "EXO_MACMON_PATH" not in os.environ


def test_sensor_stream_is_observed_without_extra_parse_or_sampler(monkeypatch):
    overlay = importlib.import_module("os1_exo_activity_overlay")
    parsed = []

    class Metrics:
        @classmethod
        def from_raw_json(cls, raw):
            parsed.append(raw)
            return SimpleNamespace(system_profile=_sensor_profile())

    macmon = ModuleType("exo.utils.info_gatherer.macmon")
    macmon.MacmonMetrics = Metrics
    monkeypatch.setitem(sys.modules, "exo.utils.info_gatherer.macmon", macmon)
    monkeypatch.setattr(overlay, "_sensors", overlay._SensorTelemetry())
    overlay._track_existing_sampler()
    overlay._track_existing_sampler()
    raw = json.dumps({"timestamp": datetime.now(timezone.utc).isoformat()})
    result = Metrics.from_raw_json(raw)
    fields, status = overlay._sensors.snapshot(overlay.time.monotonic())
    assert len(parsed) == 1
    assert result.system_profile.sys_power == fields["sys_power"] == 14.0
    assert status["state"] == "available"


def test_missing_stale_and_real_zero_sensor_values_are_distinct():
    overlay = importlib.import_module("os1_exo_activity_overlay")
    sensor = overlay._SensorTelemetry()
    assert sensor.snapshot(0)[0] is None
    assert sensor.snapshot(0)[1]["state"] == "unavailable"
    _observe(sensor, 100, power=0, gpu=0)
    assert sensor.snapshot(101)[0]["sys_power"] == 0
    assert sensor.snapshot(101)[0]["gpu_usage"] == 0
    assert sensor.snapshot(116)[0] is None
    assert sensor.snapshot(116)[1]["state"] == "stale"


def test_energy_integrates_samples_once_and_excludes_gaps():
    overlay = importlib.import_module("os1_exo_activity_overlay")
    sensor = overlay._SensorTelemetry()
    _observe(sensor, 100, power=10)
    _observe(sensor, 101, power=20)
    assert sensor.joules == 15
    assert sensor.covered_seconds == 1
    for _ in range(20):
        sensor.snapshot(102)
    assert sensor.joules == 15
    _observe(sensor, 140, power=100)
    assert sensor.joules == 15
    assert sensor.covered_seconds == 1
    _observe(sensor, 141, power=100)
    assert sensor.joules == 115
    assert sensor.covered_seconds == 2


def test_invalid_or_replayed_sensor_data_does_not_become_current():
    overlay = importlib.import_module("os1_exo_activity_overlay")
    for profile, timestamp in [(_sensor_profile(gpu=float("nan")), "2026-09-08T00:00:00+00:00"),
                               (_sensor_profile(), "2026-09-07T00:00:00+00:00"),
                               (_sensor_profile(), "2026-09-08T00:00:00")]:
        sensor = overlay._SensorTelemetry()
        sensor.observe(profile, json.dumps({"timestamp": timestamp}), 100,
                       datetime(2026, 9, 8, tzinfo=timezone.utc))
        assert sensor.snapshot(101)[0] is None
        assert sensor.snapshot(101)[1]["state"] == "invalid"


def test_activity_endpoint_never_presents_missing_sensors_as_zero(monkeypatch):
    overlay = importlib.import_module("os1_exo_activity_overlay")
    monkeypatch.setattr(overlay, "_sensors", overlay._SensorTelemetry())
    monkeypatch.setattr(overlay, "_recent_fleet_jobs", lambda _: [])
    api = SimpleNamespace(node_id="fixture", state=SimpleNamespace(
        node_system={}, topology=SimpleNamespace(list_nodes=lambda: []),
        instances={}, runners={}, tasks={}, last_event_applied_idx=1))

    async def sample():
        overlay._ensure_activity_state(api)
        api._os1_activity_fleet_cache_at = float("inf")
        return await overlay._get_local_activity(api)

    result = asyncio.run(sample())
    assert all(value is None for value in result["gpu"].values())
    assert result["energy"]["system_power_watts"] is None
    assert result["energy"]["monitor_session_joules"] is None
    assert result["sensor_status"]["state"] == "unavailable"


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
    if args[0] == "-c":
        if "getsitepackages" in args[1]:
            print(root / "runtime" / "runtime-venv" / "lib" / "site-packages")
    else:
        with (root / "guard.log").open("a") as log:
            log.write(json.dumps(args[1:]) + "\n")
        print("{}")
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
        (self.product / "roaming_guard.py").write_text(
            "import os, sys\n"
            "if os.environ.get('TASK_FIXTURE_SCENARIO') == 'busy_work': sys.exit('EXO update deferred: active work')\n"
            "print('{}')\n"
        )
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
        calls = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return [call for call in calls if call[0] != "print" and not any("com.os1.exo-roaming" in part for part in call)]

    def test_guard_paused_during_install_and_restored_on_failure(self):
        result = self.run_installer("identity_failure")
        self.assertNotEqual(result.returncode, 0)
        calls = [json.loads(line) for line in (self.root / "launch.log").read_text().splitlines()]
        guards = [call for call in calls if any("com.os1.exo-roaming" in part for part in call)]
        self.assertEqual([call[0] for call in guards], ["print", "bootout", "bootstrap"])
        self.assertLess(calls.index(guards[1]), next(index for index, call in enumerate(calls) if call[0] == "bootstrap"))

    def test_busy_work_defers_before_files_or_services_change(self):
        result = self.run_installer("busy_work")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("EXO update deferred", result.stderr)
        self.assert_original_files()
        self.assertEqual(self.service_calls(), [])

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
        guard_calls = [json.loads(line) for line in (self.root / "guard.log").read_text().splitlines()]
        self.assertEqual(guard_calls, [["--check-peers", "air"], ["--install", "air"]])

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
