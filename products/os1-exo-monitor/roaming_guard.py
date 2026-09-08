"""Bounded EXO recovery after a private-network interruption; Python stdlib only."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.home() / '.os1' / 'exo-roaming'
LABEL = 'com.os1.exo-roaming'
PEERS = {'pro': ('10.215.90.72', '10.215.90.216', 61835),
         'air': ('10.215.90.216', '10.215.90.72', 61834)}
SERVICES = {'pro': ('com.os1.exo-pro-stable',),
            'air': ('com.os1.exo-air', 'com.os1.exo-air-stable')}


def atomic_json(path: Path, value: dict) -> None:
    staging = path.with_suffix('.new')
    staging.write_text(json.dumps(value, separators=(',', ':')) + '\n')
    staging.chmod(0o600)
    staging.replace(path)


def stamp(now: float) -> str:
    return datetime.fromtimestamp(now, timezone.utc).isoformat()


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def fetch_state(ip: str) -> dict | None:
    try:
        # Private peer traffic must never follow a system HTTP proxy or redirect.
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(f'http://{ip}:52415/state', timeout=8) as response:
            data = response.read(2_000_001)
        if len(data) > 2_000_000:
            return None
        result = json.loads(data)
        return result if isinstance(result, dict) else None
    except (OSError, ValueError):
        return None


def network_fingerprint() -> str:
    try:
        result = subprocess.run(['/sbin/route', '-n', 'get', 'default'],
                                capture_output=True, text=True, timeout=3)
        interface = re.search(r'interface:\s*(\S+)', result.stdout)
        gateway = re.search(r'gateway:\s*(\S+)', result.stdout)
        if not interface:
            return 'offline'
        address = subprocess.run(['/usr/sbin/ipconfig', 'getifaddr', interface[1]],
                                 capture_output=True, text=True, timeout=3).stdout.strip()
        return hashlib.sha256(f'{interface[1]}|{gateway[1] if gateway else ""}|{address}'.encode()).hexdigest()
    except (OSError, subprocess.TimeoutExpired):
        return 'unknown'


def idle(state: dict | None) -> bool:
    if not isinstance(state, dict) or not isinstance(state.get('instances'), dict) or state['instances']:
        return False
    downloads = state.get('downloads')
    if not isinstance(downloads, dict):
        return False
    for download in downloads.values():
        if not isinstance(download, list):
            return False
        for item in download:
            if not isinstance(item, dict) or len(item) != 1 or next(iter(item)) not in {
                'DownloadPending', 'DownloadCompleted', 'DownloadFailed', 'DownloadCancelled',
            }:
                return False
            if not isinstance(next(iter(item.values())), dict):
                return False
    tasks = state.get('tasks')
    if not isinstance(tasks, dict):
        return False
    for task in tasks.values():
        if not isinstance(task, dict) or len(task) != 1:
            return False
        kind, body = next(iter(task.items()))
        if not isinstance(body, dict):
            return False
        # EXO retains historical shutdown tasks even after their instance is gone.
        if kind == 'Shutdown' and body.get('instanceId'):
            continue
        if body.get('taskStatus') not in {'Complete', 'Failed', 'TimedOut', 'Cancelled'}:
            return False
    return True


def fresh_cluster(state: dict, expected: set[str], now: float) -> bool:
    topology = state.get('topology', {})
    nodes = topology.get('nodes', [])
    if not isinstance(nodes, list) or len(nodes) != 2 or set(nodes) != expected:
        return False
    seen = state.get('lastSeen', {})
    for node in expected:
        try:
            age = now - datetime.fromisoformat(seen[node].replace('Z', '+00:00')).timestamp()
            if not -5 <= age <= 45:
                return False
        except (KeyError, ValueError, TypeError, AttributeError):
            return False
    return True


def decide(local: dict | None, peer: dict | None, config: dict, memory: dict,
           now: float, fingerprint: str) -> tuple[str, bool]:
    """Pure policy; local and peer are independently observed API responses."""
    memory['attempts'] = [x for x in memory.get('attempts', []) if now - x < 3600]
    if memory.get('fingerprint') != fingerprint:
        memory['fingerprint'] = fingerprint
        memory['network_changed_at'] = stamp(now)
        memory.pop('bad_since', None)
    if peer is None:
        memory.pop('bad_since', None)
        return 'waiting_for_network', False
    expected = set(config['expected_nodes'])
    for state in (local, peer):
        if state is not None:
            topology = state.get('topology')
            nodes = topology.get('nodes') if isinstance(topology, dict) else None
            if not isinstance(nodes, list) or not 1 <= len(nodes) <= 2 or not all(
                isinstance(node, str) and node in expected for node in nodes
            ) or len(set(nodes)) != len(nodes):
                return 'attention_required', False
            if not isinstance(state.get('lastSeen'), dict):
                return 'attention_required', False
            for node in nodes:
                try:
                    when = datetime.fromisoformat(state['lastSeen'][node].replace('Z', '+00:00'))
                    if when.tzinfo is None:
                        return 'attention_required', False
                except (KeyError, ValueError, TypeError, AttributeError):
                    return 'attention_required', False
    if local and fresh_cluster(local, expected, now) and fresh_cluster(peer, expected, now):
        memory.pop('bad_since', None)
        return 'connected', False
    # Replaying a large retained event log makes lastSeen temporarily historic.
    # Progress is not a frozen connection: never kill a healthy replay midway.
    event_index = local.get('lastEventAppliedIdx') if local else None
    if isinstance(event_index, int) and not isinstance(event_index, bool) and event_index >= 0:
        if event_index != memory.get('replay_index'):
            memory['replay_index'] = event_index
            memory['replay_progress_at'] = now
        if now - memory.get('replay_progress_at', 0) < 120:
            memory.pop('bad_since', None)
            return 'synchronizing', False
    if fingerprint in {'offline', 'unknown'}:
        memory.pop('bad_since', None)
        return 'waiting_for_network', False
    started = memory.setdefault('bad_since', now)
    if now - started < (90 if config['role'] == 'pro' else 180):
        return 'reconnecting', False
    if not idle(local) or not idle(peer):
        return 'waiting_for_idle', False
    attempts = memory['attempts']
    if len(attempts) >= 2:
        return 'attention_required', False
    if attempts and now - attempts[-1] < 300:
        return 'cooldown', False
    return 'recovering', True


def exact_service(config: dict) -> dict:
    role, service = config['role'], config['service']
    if service not in SERVICES[role]:
        raise ValueError('Unexpected EXO service')
    path = Path.home() / 'Library' / 'LaunchAgents' / f'{service}.plist'
    with path.open('rb') as source:
        value = plistlib.load(source)
    if value.get('Label') != service or value.get('KeepAlive') is not True:
        raise ValueError('EXO label or KeepAlive changed')
    env = value.get('EnvironmentVariables', {})
    _, peer_ip, port = PEERS[role]
    if env.get('EXO_LIBP2P_NAMESPACE') != 'lua-private-mlx-cluster' or env.get('EXO_BOOTSTRAP_PEERS') != f'/ip4/{peer_ip}/tcp/{port}':
        raise ValueError('EXO private peer configuration changed')
    return value


def sample(config: dict, memory: dict, recover: bool = True) -> dict:
    with ThreadPoolExecutor(max_workers=2) as pool:
        local_future = pool.submit(fetch_state, '127.0.0.1')
        peer_future = pool.submit(fetch_state, config['peer_api_ip'])
        fingerprint = network_fingerprint()
        local, peer = local_future.result(), peer_future.result()
    now = time.time()
    state, should_restart = decide(local, peer, config, memory, now, fingerprint)
    if should_restart and recover:
        exact_service(config)
        # Persist before sending a signal, so a crash cannot bypass the budget.
        memory['attempts'].append(now)
        memory['last_recovery_at'] = stamp(now)
        memory['recovery_count'] = memory.get('recovery_count', 0) + 1
        atomic_json(ROOT / 'memory.json', memory)
        result = subprocess.run(['/bin/launchctl', 'kill', 'SIGTERM',
                                 f'gui/{os.getuid()}/{config["service"]}'],
                                capture_output=True, timeout=10)
        if result.returncode:
            state = 'attention_required'
    status = {key: memory[key] for key in ('network_changed_at', 'last_recovery_at') if key in memory}
    status.update(schema=1, role=config['role'], state=state, sampled_at=stamp(now),
                  recovery_count=memory.get('recovery_count', 0), peer_reachable=peer is not None,
                  peer_api_ip=config['peer_api_ip'])
    return status


def enrolled_nodes(role: str) -> list[str]:
    states = [fetch_state('127.0.0.1'), fetch_state(PEERS[role][1])]
    if not all(states):
        raise ValueError('Both APIs must be reachable for identity enrollment')
    topology = states[0].get('topology')
    nodes = topology.get('nodes') if isinstance(topology, dict) else None
    if not isinstance(nodes, list) or len(nodes) != 2 or not all(isinstance(n, str) for n in nodes):
        raise ValueError('Two-node identity enrollment failed')
    if len(set(nodes)) != 2 or not all(fresh_cluster(state, set(nodes), time.time()) for state in states):
        raise ValueError('Two-node identity enrollment failed')
    return sorted(nodes)


def install(role: str) -> None:
    service = next((x for x in SERVICES[role] if
                    (Path.home() / 'Library' / 'LaunchAgents' / f'{x}.plist').is_file()), None)
    if service is None:
        raise ValueError('Existing EXO service is required')
    own_ip, peer_ip, port = PEERS[role]
    config = {'role': role, 'service': service, 'peer_api_ip': peer_ip}
    service_value = exact_service(config)
    env = service_value.get('EnvironmentVariables', {})
    if env.get('EXO_LIBP2P_NAMESPACE') != 'lua-private-mlx-cluster':
        raise ValueError('Unexpected namespace')
    if env.get('EXO_BOOTSTRAP_PEERS') != f'/ip4/{peer_ip}/tcp/{port}':
        raise ValueError('Expected peer-ID-free ZeroTier bootstrap; inspect local service')
    nodes = enrolled_nodes(role)
    config['expected_nodes'] = nodes
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    digest = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:16]
    destination = ROOT / 'releases' / digest / 'roaming_guard.py'
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(__file__, destination)
    config_path = ROOT / 'config.json'
    previous_config = config_path.read_bytes() if config_path.exists() else None
    plist = Path.home() / 'Library' / 'LaunchAgents' / f'{LABEL}.plist'
    previous = plist.read_bytes() if plist.exists() else None
    if previous:
        (ROOT / f'launchagent.before-{time.time_ns()}.plist').write_bytes(previous)
    python = str(Path(sys.executable).resolve())
    value = {'Label': LABEL, 'ProgramArguments': [python, str(destination), '--run'],
             'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 30,
             'ProcessType': 'Interactive', 'WorkingDirectory': str(ROOT),
             'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}
    subprocess.run(['/bin/launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'],
                   capture_output=True, timeout=10)
    try:
        atomic_json(config_path, config)
        staging = plist.with_suffix('.new')
        staging.write_bytes(plistlib.dumps(value))
        staging.replace(plist)
        subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(plist)],
                       check=True, capture_output=True, timeout=10)
    except Exception:
        # A timed-out bootstrap may still have loaded the new daemon.
        try:
            subprocess.run(['/bin/launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'],
                           capture_output=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            pass
        if previous_config is not None:
            config_path.write_bytes(previous_config)
        else:
            config_path.unlink(missing_ok=True)
        if previous:
            plist.write_bytes(previous)
            subprocess.run(['/bin/launchctl', 'bootstrap', f'gui/{os.getuid()}', str(plist)],
                           capture_output=True, timeout=10)
        else:
            plist.unlink(missing_ok=True)
        raise
    print(json.dumps({'installed': LABEL, 'role': role, 'private_address': own_ip,
                      'peer_api_ip': peer_ip, 'expected_nodes': nodes}))


def main() -> None:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--install', choices=('pro', 'air'))
    group.add_argument('--check-peers', choices=('pro', 'air'), help='Read-only fresh two-node check')
    group.add_argument('--check-idle', choices=('pro', 'air'), help='Read-only no-active-work check before an EXO update')
    group.add_argument('--run', action='store_true')
    group.add_argument('--once', action='store_true', help='Read-only live sample; no restart')
    args = parser.parse_args()
    if args.check_idle:
        if not idle(fetch_state('127.0.0.1')) or not idle(fetch_state(PEERS[args.check_idle][1])):
            raise ValueError('EXO update deferred: active or unknown work on either Mac')
        print(json.dumps({'idle': True}))
        return
    if args.check_peers:
        print(json.dumps({'nodes': enrolled_nodes(args.check_peers)}))
        return
    if args.install:
        install(args.install)
        return
    config = read_json(ROOT / 'config.json')
    memory = read_json(ROOT / 'memory.json')
    if args.once:
        print(json.dumps(sample(config, memory, recover=False)))
        return
    with (ROOT / 'lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            try:
                status = sample(config, memory)
                atomic_json(ROOT / 'memory.json', memory)
                atomic_json(ROOT / 'status.json', status)
            except Exception:
                atomic_json(ROOT / 'status.json', {'schema': 1, 'role': config.get('role'),
                            'state': 'attention_required', 'sampled_at': stamp(time.time())})
            time.sleep(15)


if __name__ == '__main__':
    main()
