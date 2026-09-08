import importlib
import sys
import json
from datetime import datetime, timedelta, timezone
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


def test_overlay_registers_exactly_one_activity_route(monkeypatch) -> None:
    exo = ModuleType("exo")
    exo_api = ModuleType("exo.api")
    exo_main = ModuleType("exo.api.main")
    exo_main.API = _FakeAPI
    monkeypatch.setitem(sys.modules, "exo", exo)
    monkeypatch.setitem(sys.modules, "exo.api", exo_api)
    monkeypatch.setitem(sys.modules, "exo.api.main", exo_main)
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
