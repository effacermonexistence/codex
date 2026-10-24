#!/usr/bin/env python3
"""Pure fake-process guards. No real installer, package tool, auth or provider."""
from concurrent.futures import ThreadPoolExecutor
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('beta_owner_policy', HERE / 'test-beta-owner-policy.py')
beta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(beta)


class BetaParallelFixtures(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='os1-beta-parallel-pure-')
        self.root = Path(self.temp.name)
        self.package = self.root / 'original.pkg'
        self.package.write_bytes(b'SYNTHETIC PACKAGE, NEVER EXECUTED')
        self.manifest = self.root / 'original.json'
        self.manifest.write_text(json.dumps({'version': '0.9.365', 'sha256': hashlib.sha256(self.package.read_bytes()).hexdigest(), 'size': self.package.stat().st_size}))
        self.cases = beta.mutation_cases('0.9.365')

    def tearDown(self):
        self.temp.cleanup()

    def run_quiet(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return beta.run_verification(self.package, self.manifest)

    def test_exact_inventory_and_historical_thresholds(self):
        resources = ['sync-owner-policy.py', 'CodexDictationCapture.html', 'local-controller-sources.json',
                     'provision-local-controller.mjs', 'openclaw-os1-bridge/index.mjs',
                     'openclaw-os1-bridge/rcc-runtime.mjs', 'openclaw-os1-bridge/rcc-plugin.mjs',
                     'openclaw-os1-bridge/resource-usage.mjs']
        resources += ['openclaw-os1-bridge/' + n + '.mjs' for n in ['adaptive-plan-host', 'adaptive-routing-policy',
            'joint-route-selector', 'local-plan-planner', 'local-plan-proposal', 'routing-outcome',
            'routing-outcome-capture', 'frozen-route-artifacts', 'frozen-route-predictor',
            'offline-route-calibration', 'frozen-route-evidence', 'calibrated-route-evidence', 'calibrated-route-predictor']]
        self.assertEqual(list(dict.fromkeys(c[0] for c in self.cases)), resources)
        self.assertEqual(len(self.cases), 56)
        self.assertEqual(len(set(self.cases)), 56)
        self.assertTrue(all([c[1] for c in self.cases if c[0] == r] ==
            (['rename', 'content'] if i < 7 else ['rename', 'content', 'symlink']) for i, r in enumerate(resources)))
        for version, count in [('0.9.273', 2), ('0.9.274', 4), ('0.9.295', 10), ('0.9.302', 14),
                               ('0.9.343', 17), ('0.9.350', 38), ('0.9.351', 44), ('0.9.356', 56)]:
            self.assertEqual(len(beta.mutation_cases(version)), count)

    def test_positive_must_pass_before_any_executor_or_mutation(self):
        with patch.object(beta, 'verify', side_effect=AssertionError('positive rejected')), \
             patch.object(beta, 'ThreadPoolExecutor', side_effect=AssertionError('POOL MUST NOT START')), \
             patch.object(beta, 'verify_mutation') as mutation:
            with self.assertRaisesRegex(AssertionError, 'positive rejected'):
                self.run_quiet()
            mutation.assert_not_called()

    def test_two_workers_really_overlap_and_all_cases_complete(self):
        state = {'positive': False, 'active': 0, 'peak': 0}
        seen, workers = [], []
        lock, barrier = threading.Lock(), threading.Barrier(2)
        def positive(*args):
            self.assertEqual(args[2:], (True, 'installation was not performed'))
            state['positive'] = True
        def mutation(package, manifest, *case):
            self.assertTrue(state['positive'])
            with lock:
                state['active'] += 1; state['peak'] = max(state['peak'], state['active'])
            try:
                barrier.wait(timeout=3)
                time.sleep(0.001)
                with lock: seen.append(case)
            finally:
                with lock: state['active'] -= 1
        def executor(*args, **kwargs):
            workers.append(kwargs['max_workers'])
            return ThreadPoolExecutor(*args, **kwargs)
        with patch.object(beta, 'verify', side_effect=positive), patch.object(beta, 'verify_mutation', side_effect=mutation), \
             patch.object(beta, 'ThreadPoolExecutor', side_effect=executor):
            self.assertEqual(self.run_quiet(), 56)
        self.assertEqual(workers, [2]); self.assertEqual(state['peak'], 2)
        self.assertCountEqual(seen, self.cases)

    def test_failure_is_not_pass_or_cancellation_of_later_cases(self):
        seen, lock = [], threading.Lock()
        failed = {self.cases[0], self.cases[8]}
        def mutation(package, manifest, *case):
            with lock: seen.append(case)
            if case in failed: raise AssertionError('CANNED failure ' + case[0])
        with patch.object(beta, 'verify'), patch.object(beta, 'verify_mutation', side_effect=mutation):
            with self.assertRaisesRegex(AssertionError, '2/56 beta mutation cases failed'):
                self.run_quiet()
        self.assertCountEqual(seen, self.cases)

    def test_actual_mutation_function_uses_unique_paths_and_strict_verify_only_flags(self):
        resource_reasons = {c[0]: c[2] for c in self.cases}
        suffix = Path('OS-1-component.pkg/Payload/Applications/OS-1 CLODEX.app/Contents/Resources')
        paths, checks, lock = [], [], threading.Lock()
        before = self.package.read_bytes(), self.manifest.read_bytes()
        def fake_run(argv, **kwargs):
            if argv[:2] == ['pkgutil', '--expand-full']:
                self.assertEqual(Path(argv[2]), self.package)
                expanded = Path(argv[3])
                with lock: paths.append(expanded)
                for name in resource_reasons:
                    f = expanded / suffix / name; f.parent.mkdir(parents=True, exist_ok=True); f.write_text('ORIGINAL')
                return subprocess.CompletedProcess(argv, 0)
            if argv[:2] == ['pkgutil', '--flatten']:
                expanded, changed = Path(argv[2]), Path(argv[3])
                self.assertEqual(expanded.parent, changed.parent)
                files = {str(f.relative_to(expanded / suffix)): 'SYMLINK' if f.is_symlink() else f.read_text()
                         for f in (expanded / suffix).rglob('*') if f.is_file() or f.is_symlink()}
                changed.write_text(json.dumps(files)); return subprocess.CompletedProcess(argv, 0)
            self.assertEqual(argv, ['bash', str(beta.installer)])
            env = kwargs['env']
            for key, value in [('OS1_ALLOW_UNNOTARIZED_BETA', '1'), ('OS1_VERIFY_ONLY', '1'),
                               ('OS1_SKIP_PREREQUISITES', '1'), ('OS1_SKIP_LOGIN', '1'), ('OS1_ENABLE_FLEET', '0')]:
                self.assertEqual(env[key], value)
            pkg, meta = Path(env['OS1_BETA_PACKAGE_PATH']), Path(env['OS1_BETA_MANIFEST_PATH'])
            parsed = json.loads(meta.read_text())
            self.assertEqual(parsed['sha256'], hashlib.sha256(pkg.read_bytes()).hexdigest())
            self.assertEqual(parsed['size'], pkg.stat().st_size)
            with lock: checks.append((pkg, meta))
            if pkg == self.package:
                return subprocess.CompletedProcess(argv, 0, 'installation was not performed', '')
            self.assertEqual(pkg.parent, meta.parent)
            files = json.loads(pkg.read_text())
            missing = [name for name in resource_reasons if name not in files]
            reason = resource_reasons[missing[0]] if missing else 'refused a symbolic link' if 'SYMLINK' in files.values() else 'refused the unnotarized beta package'
            return subprocess.CompletedProcess(argv, 1, '', reason)
        with patch.object(beta.subprocess, 'run', side_effect=fake_run):
            self.assertEqual(self.run_quiet(), 56)
        self.assertEqual(len(paths), 56); self.assertEqual(len(set(paths)), 56)
        self.assertEqual(len(checks), 57)
        self.assertEqual((self.package.read_bytes(), self.manifest.read_bytes()), before)
        self.assertTrue(all(not p.exists() for p in paths))

    def test_exit_and_reason_assertions_are_not_weakened(self):
        for expected, code, output in [(True, 1, 'installation was not performed'),
                                       (False, 0, 'required rejection'), (False, 1, 'wrong reason')]:
            with patch.object(beta.subprocess, 'run', return_value=subprocess.CompletedProcess([], code, output, '')):
                with self.assertRaises(AssertionError):
                    beta.verify(self.package, self.manifest, expected, 'installation was not performed' if expected else 'required rejection')

    def test_installer_early_exit_remains_before_live_mutations(self):
        source = beta.installer.read_text()
        early = source.index('if [[ "$verify_only" == "1" ]]; then')
        end = source.index('\nfi', early)
        self.assertIn('exit 0', source[early:end])
        self.assertLess(end, source.index('mkdir -p "$local_bin"'))
        self.assertLess(end, source.index('os1_user_backup="$(mktemp'))
        self.assertIn('os1_tmp="$(mktemp -d /tmp/os1-install.XXXXXX)"', source)
        self.assertIn('local expanded_root="$os1_tmp/expanded"', source)
        self.assertEqual(beta.MUTATION_WORKERS, 2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
