"""Read-only OS1 Activity Monitor endpoint for a source-based EXO runtime.

This module is loaded by a small ``.pth`` file before EXO starts.  It adds one
FastAPI route without replacing any EXO source files or starting another
``macmon`` sampler.  GPU, power, temperature, and P/E-core values therefore
come from the sampler EXO already owns.
"""

from __future__ import annotations

import json
import shutil
import socket
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

import anyio
import psutil

FLEET_CACHE_SECONDS = 10.0
FLEET_RESULT_LIMIT = 20
_ROUTE = "/activity/local"
_PATCH_MARKER = "_os1_activity_monitor_installed"


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
    api._os1_activity_previous_disk = psutil.disk_io_counters()
    api._os1_activity_previous_network = psutil.net_io_counters()
    api._os1_activity_energy_joules = 0.0
    api._os1_activity_fleet_cache = {"nodes": []}
    api._os1_activity_fleet_cache_at = 0.0
    api._os1_activity_fleet_error = None
    api._os1_activity_process = psutil.Process()
    psutil.cpu_percent(interval=None)
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
        with anyio.fail_after(5):
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
        api._os1_activity_fleet_cache_at = now


async def _get_local_activity(api: Any) -> dict[str, object]:
    _ensure_activity_state(api)
    async with api._os1_activity_lock:
        now = time.monotonic()
        elapsed = max(now - api._os1_activity_previous_at, 0.001)
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

        system = api.state.node_system.get(api.node_id)
        system_power_watts = system.sys_power if system is not None else 0.0
        api._os1_activity_energy_joules += max(system_power_watts, 0.0) * elapsed
        await _refresh_fleet_snapshot(api, now)

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
        return {
            "schema": 1,
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
                "usage_percent": (system.gpu_usage * 100) if system else 0.0,
                "temperature_celsius": system.temp if system else 0.0,
                "performance_cpu_percent": (
                    system.pcpu_usage * 100 if system else 0.0
                ),
                "efficiency_cpu_percent": (
                    system.ecpu_usage * 100 if system else 0.0
                ),
            },
            "energy": {
                "system_power_watts": system_power_watts,
                "monitor_session_joules": api._os1_activity_energy_joules,
                "monitor_session_watt_hours": (
                    api._os1_activity_energy_joules / 3600
                ),
                "monitor_uptime_seconds": now - api._os1_activity_started_at,
            },
            "disk": disk_payload,
            "network": network_payload,
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


def install() -> None:
    from exo.api.main import API

    if getattr(API, _PATCH_MARKER, False):
        return
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
