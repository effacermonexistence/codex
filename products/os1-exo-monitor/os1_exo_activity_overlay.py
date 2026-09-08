"""Read-only OS1 Activity Monitor endpoint for a source-based EXO runtime.

This module is loaded by a small ``.pth`` file before EXO starts.  It adds one
FastAPI route without replacing any EXO source files or starting another
``macmon`` sampler.  GPU, power, temperature, and P/E-core values therefore
come from the sampler EXO already owns.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import socket
import time
from datetime import datetime, timezone
from ipaddress import ip_address
from pathlib import Path
from typing import Any, cast

import anyio
import psutil

FLEET_CACHE_SECONDS = 10.0
FLEET_TIMEOUT_SECONDS = 30.0
FLEET_RESULT_LIMIT = 20
_ROUTE = "/activity/local"
_PATCH_MARKER = "_os1_activity_monitor_installed"
OS1_ROAMING_STALE_SECONDS = 60.0
OS1_ROAMING_STATES = {
    "starting",
    "connected",
    "waiting_for_network",
    "reconnecting",
    "synchronizing",
    "waiting_for_idle",
    "recovering",
    "cooldown",
    "attention_required",
    "degraded",
}


def _read_roaming_status(path: Path, now: datetime | None = None) -> dict[str, object]:
    """Read bounded, non-secret roaming evidence without controlling the service."""
    unavailable: dict[str, object] = {
        "available": False,
        "stale": True,
        "state": "unavailable",
    }
    try:
        with path.open("rb") as status_file:
            encoded = status_file.read(16_385)
        if len(encoded) > 16_384:
            return {**unavailable, "state": "invalid"}
        raw: object = json.loads(encoded)
        if not isinstance(raw, dict):
            return {**unavailable, "state": "invalid"}
        payload = cast(dict[str, object], raw)
        sampled_at = payload.get("sampled_at")
        state = payload.get("state")
        role = payload.get("role")
        if (
            payload.get("schema") != 1
            or role not in ("air", "pro")
            or not isinstance(state, str)
            or state not in OS1_ROAMING_STATES
            or not isinstance(sampled_at, str)
        ):
            return {**unavailable, "state": "invalid"}
        sampled = datetime.fromisoformat(sampled_at)
        if sampled.tzinfo is None:
            return {**unavailable, "state": "invalid"}
        age = ((now or datetime.now(timezone.utc)) - sampled).total_seconds()
        result: dict[str, object] = {
            "schema": 1,
            "available": True,
            "stale": age > OS1_ROAMING_STALE_SECONDS or age < -5,
            "age_seconds": max(age, 0.0),
            "state": state,
            "role": role,
            "sampled_at": sampled.isoformat(),
        }
        for key in ("network_changed_at", "last_recovery_at"):
            value = payload.get(key)
            if isinstance(value, str):
                parsed = datetime.fromisoformat(value)
                if parsed.tzinfo is not None:
                    result[key] = parsed.isoformat()
        recovery_count = payload.get("recovery_count")
        if type(recovery_count) is int and recovery_count >= 0:
            result["recovery_count"] = recovery_count
        peer_reachable = payload.get("peer_reachable")
        if isinstance(peer_reachable, bool):
            result["peer_reachable"] = peer_reachable
        peer_api_ip = payload.get("peer_api_ip")
        if isinstance(peer_api_ip, str):
            result["peer_api_ip"] = str(ip_address(peer_api_ip))
        return result
    except FileNotFoundError:
        return unavailable
    except (OSError, ValueError, UnicodeDecodeError):
        return {**unavailable, "state": "invalid"}



SENSOR_STALE_SECONDS = 15.0
SENSOR_MAX_INTEGRATION_GAP_SECONDS = 5.0


class _SensorTelemetry:
    """Observe EXO's sampler; never start a second process or infer zero."""

    def __init__(self) -> None:
        self.sample: dict[str, Any] | None = None
        self.invalid = False
        self.joules = 0.0
        self.covered_seconds = 0.0

    def observe(self, profile: Any, raw: str, now: float, wall_now: datetime) -> None:
        try:
            timestamp = datetime.fromisoformat(json.loads(raw)["timestamp"].replace("Z", "+00:00"))
            if timestamp.tzinfo is None:
                raise ValueError("sensor timestamp has no timezone")
            fields = {name: float(getattr(profile, name)) for name in
                      ("gpu_usage", "temp", "sys_power", "pcpu_usage", "ecpu_usage")}
            if not all(math.isfinite(value) for value in fields.values()):
                raise ValueError("sensor values must be finite")
            if not all(0 <= fields[name] <= 1 for name in ("gpu_usage", "pcpu_usage", "ecpu_usage")):
                raise ValueError("sensor utilization is outside its unit interval")
            if fields["sys_power"] < 0 or not -100 <= fields["temp"] <= 200:
                raise ValueError("sensor power or temperature is invalid")
            age = (wall_now - timestamp).total_seconds()
            if age < -5 or age > SENSOR_STALE_SECONDS:
                raise ValueError("sensor timestamp is not current")
        except (KeyError, AttributeError, TypeError, ValueError, json.JSONDecodeError):
            self.invalid = True
            self.sample = None
            return
        previous = self.sample
        if previous is not None and not self.invalid:
            elapsed = timestamp.timestamp() - previous["sampled_seconds"]
            # Trapezoidal integration covers only consecutive measured samples.
            # A paused sampler or unopened dashboard cannot accrue fake energy.
            if 0 < elapsed <= SENSOR_MAX_INTEGRATION_GAP_SECONDS:
                self.joules += (previous["fields"]["sys_power"] + fields["sys_power"]) * 0.5 * elapsed
                self.covered_seconds += elapsed
        self.sample = {"fields": fields, "observed_at": now,
                       "sampled_at": timestamp.isoformat(), "sampled_seconds": timestamp.timestamp(),
                       "initial_age": max(age, 0)}
        self.invalid = False

    def snapshot(self, now: float) -> tuple[dict[str, Any] | None, dict[str, object]]:
        age = None if self.sample is None else self.sample["initial_age"] + now - self.sample["observed_at"]
        state = "invalid" if self.invalid else ("unavailable" if age is None else
                  ("available" if 0 <= age <= SENSOR_STALE_SECONDS else "stale"))
        status = {"state": state, "source": "exo_macmon", "sample_age_seconds": age,
                  "sampled_at": None if self.sample is None else self.sample["sampled_at"]}
        return (self.sample["fields"] if state == "available" else None), status


_sensors = _SensorTelemetry()


def _configure_existing_sampler() -> None:
    # Air's maintained wrapper already names the installed EXO resources.
    # PATH need not contain that private bundle directory. Keep explicit user
    # configuration authoritative and never install or invoke a sampler here.
    if os.environ.get("EXO_MACMON_PATH"):
        return
    resource_directory = os.environ.get("EXO_RESOURCES_DIR")
    if resource_directory:
        candidate = Path(resource_directory) / "macmon"
        if candidate.is_file() and os.access(candidate, os.X_OK):
            os.environ["EXO_MACMON_PATH"] = str(candidate)


def _track_existing_sampler() -> None:
    from exo.utils.info_gatherer.macmon import MacmonMetrics

    if getattr(MacmonMetrics, "_os1_activity_sample_tracking", False):
        return
    original = MacmonMetrics.from_raw_json

    @classmethod
    def observe(cls: Any, raw: str) -> Any:
        result = original(raw)
        _sensors.observe(result.system_profile, raw, time.monotonic(), datetime.now(timezone.utc))
        return result

    MacmonMetrics.from_raw_json = observe
    MacmonMetrics._os1_activity_sample_tracking = True


def _counter_rate(current: int, previous: int, elapsed: float) -> float:
    if elapsed <= 0:
        return 0.0
    return max(current - previous, 0) / elapsed


def _sanitize_fleet_snapshot(payload: object) -> dict[str, object]:
    if not isinstance(payload, dict):
        return {"nodes": []}
    raw_nodes = payload.get("nodes")
    if not isinstance(raw_nodes, list):
        return {"nodes": []}

    allowed = {
        "cpu_logical_count",
        "device_id",
        "exo_nodes",
        "exo_ready",
        "has_claude",
        "has_codex",
        "hostname",
        "last_seen_ms",
        "load_average_1m",
        "memory_available_mib",
        "memory_total_mib",
        "queue_depth",
        "role",
        "zerotier_ip",
    }
    nodes: list[dict[str, object]] = []
    for raw_node in raw_nodes:
        if isinstance(raw_node, dict):
            nodes.append(
                {str(key): value for key, value in raw_node.items() if key in allowed}
            )
    return {"nodes": nodes}


def _recent_fleet_jobs(result_directory: Path) -> list[dict[str, object]]:
    if not result_directory.is_dir():
        return []
    allowed = {
        "execution_mode",
        "executor_device_id",
        "job_id",
        "objective_version",
        "profile",
        "state",
    }
    jobs: list[dict[str, object]] = []
    result_files = sorted(
        result_directory.glob("*.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )[:FLEET_RESULT_LIMIT]
    for result_file in result_files:
        try:
            raw = json.loads(result_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(raw, dict):
            continue
        job = {str(key): value for key, value in raw.items() if key in allowed}
        job["updated_at_ms"] = int(result_file.stat().st_mtime * 1000)
        jobs.append(job)
    return jobs


def _ensure_activity_state(api: Any) -> None:
    if hasattr(api, "_os1_activity_lock"):
        return
    started_at = time.monotonic()
    api._os1_activity_lock = anyio.Lock()
    api._os1_activity_started_at = started_at
    api._os1_activity_previous_at = started_at
    api._os1_activity_cached_snapshot = None
    api._os1_activity_previous_disk = psutil.disk_io_counters()
    api._os1_activity_previous_network = psutil.net_io_counters()
    api._os1_activity_fleet_cache = {"nodes": []}
    api._os1_activity_fleet_cache_at = 0.0
    api._os1_activity_fleet_error = None
    api._os1_activity_fleet_refresh_task = None
    api._os1_activity_process = psutil.Process()
    psutil.cpu_percent(interval=None)
    psutil.cpu_percent(interval=None, percpu=True)
    api._os1_activity_process.cpu_percent(interval=None)


async def _refresh_fleet_snapshot(api: Any, now: float) -> None:
    if now - api._os1_activity_fleet_cache_at < FLEET_CACHE_SECONDS:
        return
    os1_binary = Path.home() / ".local" / "bin" / "os1"
    if not os1_binary.is_file():
        resolved = shutil.which("os1")
        if resolved is None:
            api._os1_activity_fleet_error = "OS1 Runtime is not installed"
            api._os1_activity_fleet_cache_at = now
            return
        os1_binary = Path(resolved)

    try:
        with anyio.fail_after(FLEET_TIMEOUT_SECONDS):
            process = await anyio.run_process(
                [str(os1_binary), "fleet-snapshot"],
                check=False,
            )
        if process.returncode != 0:
            api._os1_activity_fleet_error = (
                f"fleet-snapshot exited with status {process.returncode}"
            )
        else:
            payload = json.loads(process.stdout.decode("utf-8"))
            api._os1_activity_fleet_cache = _sanitize_fleet_snapshot(payload)
            api._os1_activity_fleet_error = None
    except TimeoutError:
        api._os1_activity_fleet_error = "fleet-snapshot timed out"
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        api._os1_activity_fleet_error = (
            f"fleet-snapshot unavailable: {type(exc).__name__}"
        )
    finally:
        # Age from completion so a slow hotel-network refresh does not cause a
        # new child process on the very next one-second telemetry request.
        api._os1_activity_fleet_cache_at = time.monotonic()


async def _get_local_activity(api: Any) -> dict[str, object]:
    _ensure_activity_state(api)
    async with api._os1_activity_lock:
        now = time.monotonic()
        if api._os1_activity_cached_snapshot is not None and now - api._os1_activity_previous_at < 0.8:
            return api._os1_activity_cached_snapshot
        if now - api._os1_activity_previous_at < 0.1:
            await anyio.sleep(0.1 - (now - api._os1_activity_previous_at))
            now = time.monotonic()
        elapsed = now - api._os1_activity_previous_at
        disk = psutil.disk_io_counters()
        network = psutil.net_io_counters()
        memory = psutil.virtual_memory()
        swap = psutil.swap_memory()
        process_memory = api._os1_activity_process.memory_info()

        previous_disk = api._os1_activity_previous_disk
        previous_network = api._os1_activity_previous_network
        api._os1_activity_previous_at = now
        api._os1_activity_previous_disk = disk
        api._os1_activity_previous_network = network

        sensors, sensor_status = _sensors.snapshot(now)
        fleet_refresh = api._os1_activity_fleet_refresh_task
        if (
            now - api._os1_activity_fleet_cache_at >= FLEET_CACHE_SECONDS
            and (fleet_refresh is None or fleet_refresh.done())
        ):
            api._os1_activity_fleet_refresh_task = asyncio.create_task(
                _refresh_fleet_snapshot(api, now)
            )

        local_addresses = {
            address.address
            for addresses in psutil.net_if_addrs().values()
            for address in addresses
        }
        local_fleet_node = next(
            (
                node
                for node in cast(
                    list[dict[str, object]],
                    api._os1_activity_fleet_cache.get("nodes", []),
                )
                if node.get("zerotier_ip") in local_addresses
            ),
            {},
        )

        disk_payload: dict[str, object] = {
            "read_bytes_per_second": 0.0,
            "write_bytes_per_second": 0.0,
            "read_operations_per_second": 0.0,
            "write_operations_per_second": 0.0,
        }
        if disk is not None and previous_disk is not None:
            disk_payload = {
                "read_bytes_per_second": _counter_rate(
                    disk.read_bytes, previous_disk.read_bytes, elapsed
                ),
                "write_bytes_per_second": _counter_rate(
                    disk.write_bytes, previous_disk.write_bytes, elapsed
                ),
                "read_operations_per_second": _counter_rate(
                    disk.read_count, previous_disk.read_count, elapsed
                ),
                "write_operations_per_second": _counter_rate(
                    disk.write_count, previous_disk.write_count, elapsed
                ),
            }

        network_payload: dict[str, object] = {
            "received_bytes_per_second": 0.0,
            "sent_bytes_per_second": 0.0,
            "received_bytes_total": 0,
            "sent_bytes_total": 0,
        }
        if network is not None:
            network_payload["received_bytes_total"] = network.bytes_recv
            network_payload["sent_bytes_total"] = network.bytes_sent
            if previous_network is not None:
                network_payload["received_bytes_per_second"] = _counter_rate(
                    network.bytes_recv, previous_network.bytes_recv, elapsed
                )
                network_payload["sent_bytes_per_second"] = _counter_rate(
                    network.bytes_sent, previous_network.bytes_sent, elapsed
                )

        load_average = psutil.getloadavg()
        payload: dict[str, object] = {
            "schema": 2,
            "node_id": str(api.node_id),
            "sampled_at": datetime.now(timezone.utc).isoformat(),
            "sample_interval_seconds": elapsed,
            "host": {
                "hostname": local_fleet_node.get("hostname", socket.gethostname()),
                "device_id": local_fleet_node.get("device_id"),
                "role": local_fleet_node.get("role"),
                "zerotier_ip": local_fleet_node.get("zerotier_ip"),
            },
            "cpu": {
                "system_percent": psutil.cpu_percent(interval=None),
                "per_core_percent": psutil.cpu_percent(interval=None, percpu=True),
                "logical_count": psutil.cpu_count(logical=True) or 0,
                "load_average_1m": load_average[0],
                "exo_process_percent": api._os1_activity_process.cpu_percent(
                    interval=None
                ),
            },
            "memory": {
                "total_bytes": memory.total,
                "used_bytes": memory.used,
                "available_bytes": memory.available,
                "swap_total_bytes": swap.total,
                "swap_used_bytes": swap.used,
                "exo_process_resident_bytes": process_memory.rss,
            },
            "gpu": {
                "usage_percent": sensors["gpu_usage"] * 100 if sensors else None,
                "temperature_celsius": sensors["temp"] if sensors else None,
                "performance_cpu_percent": (
                    sensors["pcpu_usage"] * 100 if sensors else None
                ),
                "efficiency_cpu_percent": (
                    sensors["ecpu_usage"] * 100 if sensors else None
                ),
            },
            "sensor_status": sensor_status,
            "energy": {
                "system_power_watts": sensors["sys_power"] if sensors else None,
                "monitor_session_joules": _sensors.joules if sensors and _sensors.covered_seconds > 0 else None,
                "monitor_session_watt_hours": (
                    _sensors.joules / 3600 if sensors and _sensors.covered_seconds > 0 else None
                ),
                "sampled_duration_seconds": _sensors.covered_seconds,
                "monitor_uptime_seconds": now - api._os1_activity_started_at,
            },
            "disk": disk_payload,
            "network": network_payload,
            "roaming": _read_roaming_status(Path.home() / ".os1" / "exo-roaming" / "status.json"),
            "exo": {
                "topology_nodes": len(api.state.topology.list_nodes()),
                "instances": len(api.state.instances),
                "runners": len(api.state.runners),
                "tasks": len(api.state.tasks),
                "last_event_applied_index": api.state.last_event_applied_idx,
            },
            "fleet": {
                **api._os1_activity_fleet_cache,
                "cache_age_seconds": max(
                    now - api._os1_activity_fleet_cache_at,
                    0,
                ),
                "error": api._os1_activity_fleet_error,
                "recent_jobs": _recent_fleet_jobs(
                    Path.home() / ".os1" / "fleet" / "results"
                ),
            },
        }

        api._os1_activity_cached_snapshot = payload
        return payload


def _configure_activity_dashboard() -> None:
    """Apply the monitor directory after the Air wrapper sets its defaults."""
    configured = os.environ.get("OS1_EXO_ACTIVITY_DASHBOARD_DIR")
    if configured:
        directory = Path(configured)
        if directory.is_dir() and (directory / "index.html").is_file():
            os.environ["EXO_DASHBOARD_DIR"] = str(directory)


def install() -> None:
    # EXO reads its dashboard environment during import, so do this first.
    _configure_activity_dashboard()
    _configure_existing_sampler()
    from exo.api.main import API

    if getattr(API, _PATCH_MARKER, False):
        return
    _track_existing_sampler()
    original_setup_routes = API._setup_routes

    def setup_routes_with_activity(api: Any) -> None:
        original_setup_routes(api)

        async def local_activity() -> dict[str, object]:
            return await _get_local_activity(api)

        if not any(route.path == _ROUTE for route in api.app.routes):
            api.app.get(_ROUTE)(local_activity)

    API._setup_routes = setup_routes_with_activity
    setattr(API, _PATCH_MARKER, True)


install()
