import copy
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import roaming_guard as guard
from roaming_guard import decide, idle, stamp

NOW = 1_788_827_400.0
CONFIG = {'role': 'pro', 'expected_nodes': ['air', 'pro']}


def state(nodes=('air', 'pro'), now=NOW):
    return {'topology': {'nodes': list(nodes)}, 'lastSeen': {n: stamp(now) for n in nodes},
            'instances': {}, 'tasks': {}, 'downloads': {}}


class RoamingPolicyTests(unittest.TestCase):
    def test_wifi_change_does_not_restart_healthy_exo(self):
        memory = {'fingerprint': 'hotel-a', 'bad_since': NOW - 1000}
        self.assertEqual(decide(state(), state(), CONFIG, memory, NOW, 'hotel-b'), ('connected', False))
        self.assertEqual(memory['network_changed_at'], stamp(NOW))

    def test_healthy_overlay_wins_over_failed_underlay_probe(self):
        for fingerprint in ('offline', 'unknown'):
            self.assertEqual(decide(state(), state(), CONFIG, {}, NOW, fingerprint), ('connected', False))

    def test_no_restart_through_long_offline_and_return_grace(self):
        memory = {}
        for offset in (0, 900, 86400):
            self.assertEqual(decide(state(('pro',)), None, CONFIG, memory, NOW + offset, 'a'),
                             ('waiting_for_network', False))
        self.assertEqual(decide(state(('pro',)), state(('air',)), CONFIG, memory, NOW + 86401, 'b'),
                         ('reconnecting', False))
        self.assertEqual(decide(state(('pro',)), state(('air',)), CONFIG, memory, NOW + 86492, 'b'),
                         ('recovering', True))

    def test_roles_stagger_recovery(self):
        for role, grace in [('pro', 90), ('air', 180)]:
            config = {**CONFIG, 'role': role}
            memory = {'fingerprint': 'same', 'bad_since': NOW}
            self.assertFalse(decide(state(('pro',)), state(('air',)), config, memory, NOW + grace - 1, 'same')[1])
            self.assertTrue(decide(state(('pro',)), state(('air',)), config, memory, NOW + grace, 'same')[1])

    def test_busy_either_peer_and_missing_api_defer(self):
        memory = {'fingerprint': 'same', 'bad_since': NOW - 200}
        busy = state(('air',))
        busy['instances']['model'] = {}
        for local, peer in [(None, state(('air',))), (state(('pro',)), busy), (busy, state(('air',)))]:
            self.assertEqual(decide(local, peer, CONFIG, memory, NOW, 'same'), ('waiting_for_idle', False))

    def test_task_and_invalid_state_are_not_idle(self):
        running = state()
        running['tasks'] = {'job': {'TextGeneration': {'taskStatus': 'Running'}}}
        self.assertFalse(idle(running))
        self.assertFalse(idle({}))
        self.assertFalse(idle(None))
        running['tasks'] = {'old': {'Shutdown': {'taskStatus': 'Running', 'instanceId': 'deleted'}}}
        self.assertTrue(idle(running))

    def test_cooldown_and_budget_survive_loaded_memory(self):
        memory = {'fingerprint': 'same', 'bad_since': NOW - 999, 'attempts': [NOW - 10]}
        self.assertEqual(decide(state(('pro',)), state(('air',)), CONFIG, copy.deepcopy(memory), NOW, 'same'),
                         ('cooldown', False))
        memory['attempts'] = [NOW - 900, NOW - 400]
        self.assertEqual(decide(state(('pro',)), state(('air',)), CONFIG, memory, NOW, 'same'),
                         ('attention_required', False))
        self.assertTrue(decide(state(('pro',)), state(('air',)), CONFIG, memory, NOW + 3601, 'same')[1])

    def test_identity_drift_never_restarts(self):
        memory = {'fingerprint': 'same', 'bad_since': NOW - 999}
        self.assertEqual(decide(state(('pro',)), state(('intruder',)), CONFIG, memory, NOW, 'same'),
                         ('attention_required', False))

    def test_stale_two_node_topology_is_not_healthy(self):
        memory = {'fingerprint': 'same', 'bad_since': NOW - 999}
        self.assertEqual(decide(state(now=NOW-120), state(), CONFIG, memory, NOW, 'same'),
                         ('recovering', True))

    def test_offline_unknown_route_and_invalid_api_never_restart(self):
        memory = {'fingerprint': 'offline', 'bad_since': NOW - 999}
        for fingerprint in ('offline', 'unknown'):
            self.assertFalse(decide(state(('pro',)), state(('air',)), CONFIG, memory, NOW, fingerprint)[1])
        for invalid in ({}, {'instances': {}, 'tasks': {}}, {'topology': {'nodes': ['air']}}):
            self.assertEqual(decide(invalid, state(('air',)), CONFIG, memory, NOW, 'online'),
                             ('attention_required', False))

    def test_active_download_defers_and_catalog_pending_does_not(self):
        snapshot = state()
        snapshot['downloads'] = {'air': [{'DownloadOngoing': {}}]}
        self.assertFalse(idle(snapshot))
        snapshot['downloads'] = {'air': [{'DownloadPending': {}}, {'DownloadCompleted': {}}]}
        self.assertTrue(idle(snapshot))
        snapshot['downloads'] = {'air': {'malformed': {'DownloadPending': {}}}}
        self.assertFalse(idle(snapshot))


class RoamingEffectsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='exo-roaming-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.config = {**CONFIG, 'service': 'com.os1.exo-pro-stable',
                       'peer_api_ip': '10.215.90.216'}
        self.memory = {'fingerprint': 'same', 'bad_since': NOW - 999}
        self.local = state(('pro',))
        self.peer = state(('air',))
        self.addCleanup(patch.stopall)
        patch.object(guard, 'ROOT', self.root).start()
        patch.object(guard.time, 'time', return_value=NOW).start()
        patch.object(guard, 'network_fingerprint', return_value='same').start()
        patch.object(guard, 'fetch_state', side_effect=lambda ip:
                     self.local if ip == '127.0.0.1' else self.peer).start()
        self.service = patch.object(guard, 'exact_service', return_value={}).start()
        self.command = patch.object(guard.subprocess, 'run').start()
        self.command.return_value = subprocess.CompletedProcess([], 0)

    def test_recovery_persists_budget_before_exact_sigterm(self):
        expected = ['/bin/launchctl', 'kill', 'SIGTERM',
                    f'gui/{guard.os.getuid()}/com.os1.exo-pro-stable']

        def launch(command, **kwargs):
            self.assertEqual(command, expected)
            stored = json.loads((self.root / 'memory.json').read_text())
            self.assertEqual(stored['attempts'], [NOW])
            self.assertEqual(stored['recovery_count'], 1)
            self.assertEqual(kwargs['timeout'], 10)
            return subprocess.CompletedProcess(command, 0)

        self.command.side_effect = launch
        result = guard.sample(self.config, self.memory)
        self.assertEqual(result['state'], 'recovering')
        self.service.assert_called_once_with(self.config)
        self.command.assert_called_once()
        # A daemon reload must respect the persisted attempt and cooldown.
        reloaded = guard.read_json(self.root / 'memory.json')
        self.assertEqual(guard.sample(self.config, reloaded)['state'], 'cooldown')
        self.command.assert_called_once()

    def test_failed_signal_still_consumes_budget(self):
        self.command.return_value = subprocess.CompletedProcess([], 1)
        result = guard.sample(self.config, self.memory)
        self.assertEqual(result['state'], 'attention_required')
        self.assertEqual(guard.read_json(self.root / 'memory.json')['attempts'], [NOW])

    def test_read_only_sample_never_signals_or_writes_budget(self):
        guard.sample(self.config, self.memory, recover=False)
        self.command.assert_not_called()
        self.service.assert_not_called()
        self.assertFalse((self.root / 'memory.json').exists())
        self.assertEqual(self.memory['attempts'], [])

    def test_changed_exact_service_never_signals(self):
        self.service.side_effect = ValueError('EXO label or KeepAlive changed')
        with self.assertRaises(ValueError):
            guard.sample(self.config, self.memory)
        self.command.assert_not_called()
        self.assertFalse((self.root / 'memory.json').exists())

    def test_malformed_or_busy_peer_never_signals(self):
        invalid = []
        for field, value in [('topology', None), ('lastSeen', []),
                             ('instances', None), ('tasks', []), ('downloads', None)]:
            snapshot = state(('air',))
            snapshot[field] = value
            invalid.append(snapshot)
        for downloads in [{'air': [None]}, {'air': [{'DownloadPending': None}]},
                          {'air': [{'DownloadOngoing': {}}]}, {'air': {'DownloadPending': {}}}]:
            snapshot = state(('air',))
            snapshot['downloads'] = downloads
            invalid.append(snapshot)
        for snapshot in invalid:
            with self.subTest(snapshot=snapshot):
                self.peer = snapshot
                result = guard.sample(self.config, copy.deepcopy(self.memory))
                self.assertNotEqual(result['state'], 'recovering')
        self.command.assert_not_called()
        self.assertFalse((self.root / 'memory.json').exists())


class RoamingInstallTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='exo-roaming-install-test-')
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        self.root = self.home / '.os1' / 'exo-roaming'
        self.agents = self.home / 'Library' / 'LaunchAgents'
        self.agents.mkdir(parents=True)
        self.exo = self.agents / 'com.os1.exo-pro-stable.plist'
        self.exo.write_bytes(plistlib.dumps({
            'Label': 'com.os1.exo-pro-stable', 'KeepAlive': True,
            'EnvironmentVariables': {
                'EXO_LIBP2P_NAMESPACE': 'lua-private-mlx-cluster',
                'EXO_BOOTSTRAP_PEERS': '/ip4/10.215.90.216/tcp/61835',
            },
        }))
        self.exo_before = self.exo.read_bytes()
        self.guard_plist = self.agents / f'{guard.LABEL}.plist'
        self.addCleanup(patch.stopall)
        patch.object(guard, 'ROOT', self.root).start()
        patch.object(guard.Path, 'home', return_value=self.home).start()
        patch.object(guard.time, 'time', return_value=NOW).start()
        self.fetch = patch.object(guard, 'fetch_state', return_value=state()).start()
        self.command = patch.object(guard.subprocess, 'run').start()

    def test_failed_upgrade_restores_prior_config_and_agent(self):
        self.root.mkdir(parents=True)
        config_path = self.root / 'config.json'
        prior_config = b'{"prior_config":"must remain identical"}\n'
        config_path.write_bytes(prior_config)
        prior_agent = plistlib.dumps({'Label': guard.LABEL, 'ProgramArguments': ['prior-python']})
        self.guard_plist.write_bytes(prior_agent)
        (self.root / 'memory.json').write_text('{"attempts":[123]}\n')
        bootstrap_calls = []

        def launch(command, **kwargs):
            self.assertEqual(command[0], '/bin/launchctl')
            if command[1] == 'bootstrap':
                bootstrap_calls.append(command)
                if len(bootstrap_calls) == 1:
                    self.assertNotEqual(config_path.read_bytes(), prior_config)
                    raise subprocess.CalledProcessError(5, command)
                self.assertEqual(config_path.read_bytes(), prior_config)
                self.assertEqual(self.guard_plist.read_bytes(), prior_agent)
            return subprocess.CompletedProcess(command, 0)

        self.command.side_effect = launch
        with self.assertRaises(subprocess.CalledProcessError):
            guard.install('pro')
        self.assertEqual(config_path.read_bytes(), prior_config)
        self.assertEqual(self.guard_plist.read_bytes(), prior_agent)
        self.assertEqual(len(bootstrap_calls), 2)
        self.assertEqual(self.exo.read_bytes(), self.exo_before)
        self.assertEqual((self.root / 'memory.json').read_text(), '{"attempts":[123]}\n')

    def test_failed_first_install_removes_uncommitted_config_and_agent(self):
        def launch(command, **kwargs):
            if command[1] == 'bootstrap':
                raise subprocess.CalledProcessError(5, command)
            return subprocess.CompletedProcess(command, 0)

        self.command.side_effect = launch
        with self.assertRaises(subprocess.CalledProcessError):
            guard.install('pro')
        self.assertFalse((self.root / 'config.json').exists())
        self.assertFalse(self.guard_plist.exists())
        self.assertEqual(self.exo.read_bytes(), self.exo_before)

    def test_ambiguous_bootstrap_timeout_unloads_new_guard_before_restore(self):
        self.root.mkdir(parents=True)
        config_path = self.root / 'config.json'
        prior_config = b'{"prior_config":"restore after ambiguous launch"}\n'
        prior_agent = plistlib.dumps({'Label': guard.LABEL, 'ProgramArguments': ['prior-python']})
        config_path.write_bytes(prior_config)
        self.guard_plist.write_bytes(prior_agent)
        operations = []
        new_daemon_loaded = False

        def launch(command, **kwargs):
            nonlocal new_daemon_loaded
            operations.append(command[1])
            if command[1] == 'bootout':
                self.assertEqual(command, ['/bin/launchctl', 'bootout',
                                          f'gui/{guard.os.getuid()}/{guard.LABEL}'])
                if new_daemon_loaded:
                    # The ambiguous new service must be removed before files roll back.
                    self.assertNotEqual(config_path.read_bytes(), prior_config)
                    new_daemon_loaded = False
            elif operations.count('bootstrap') == 1:
                new_daemon_loaded = True
                raise subprocess.TimeoutExpired(command, 10)
            else:
                self.assertFalse(new_daemon_loaded)
                self.assertEqual(config_path.read_bytes(), prior_config)
                self.assertEqual(self.guard_plist.read_bytes(), prior_agent)
            return subprocess.CompletedProcess(command, 0)

        self.command.side_effect = launch
        with self.assertRaises(subprocess.TimeoutExpired):
            guard.install('pro')
        self.assertEqual(operations, ['bootout', 'bootstrap', 'bootout', 'bootstrap'])
        self.assertEqual(config_path.read_bytes(), prior_config)
        self.assertEqual(self.guard_plist.read_bytes(), prior_agent)
        self.assertEqual(self.exo.read_bytes(), self.exo_before)

    def test_rollback_restores_files_even_when_cleanup_command_errors(self):
        self.root.mkdir(parents=True)
        config_path = self.root / 'config.json'
        prior_config = b'{"prior_config":"must restore despite cleanup errors"}\n'
        prior_agent = plistlib.dumps({'Label': guard.LABEL, 'ProgramArguments': ['prior-python']})
        for cleanup_error in (OSError('launchctl unavailable'),
                              subprocess.TimeoutExpired('cleanup', 10)):
            with self.subTest(cleanup_error=type(cleanup_error).__name__):
                config_path.write_bytes(prior_config)
                self.guard_plist.write_bytes(prior_agent)
                operations = []

                def launch(command, **kwargs):
                    operations.append(command[1])
                    if operations == ['bootout', 'bootstrap']:
                        raise subprocess.TimeoutExpired('initial bootstrap', 10)
                    if operations == ['bootout', 'bootstrap', 'bootout']:
                        raise cleanup_error
                    if len(operations) == 4:
                        self.assertEqual(config_path.read_bytes(), prior_config)
                        self.assertEqual(self.guard_plist.read_bytes(), prior_agent)
                    return subprocess.CompletedProcess(command, 0)

                self.command.side_effect = launch
                with self.assertRaises(subprocess.TimeoutExpired) as failure:
                    guard.install('pro')
                self.assertEqual(failure.exception.cmd, 'initial bootstrap')
                self.assertEqual(operations, ['bootout', 'bootstrap', 'bootout', 'bootstrap'])
                self.assertEqual(config_path.read_bytes(), prior_config)
                self.assertEqual(self.guard_plist.read_bytes(), prior_agent)
                self.assertEqual(self.exo.read_bytes(), self.exo_before)

    def test_stale_enrollment_has_no_install_side_effect(self):
        self.fetch.return_value = state(now=NOW - 120)
        with self.assertRaises(ValueError):
            guard.install('pro')
        self.command.assert_not_called()
        self.assertFalse(self.root.exists())
        self.assertFalse(self.guard_plist.exists())


if __name__ == '__main__':
    unittest.main()
