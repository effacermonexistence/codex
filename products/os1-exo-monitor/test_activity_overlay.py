import importlib
import builtins
import asyncio
import json
import os
import sys
from datetime import datetime, timezone, timedelta
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
