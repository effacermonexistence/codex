import importlib
import builtins
import os
import sys
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
