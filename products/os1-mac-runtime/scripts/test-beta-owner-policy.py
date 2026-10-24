#!/usr/bin/env python3
"""Run real beta-package verification without installation or provider calls."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

installer = Path(__file__).with_name('install-os1.sh').resolve()
MUTATION_WORKERS = 2

def verify(pkg, meta, expected, reason):
    env = dict(os.environ, OS1_ALLOW_UNNOTARIZED_BETA='1',
               OS1_BETA_PACKAGE_PATH=str(pkg), OS1_BETA_MANIFEST_PATH=str(meta),
               OS1_VERIFY_ONLY='1', OS1_SKIP_PREREQUISITES='1',
               OS1_SKIP_LOGIN='1', OS1_ENABLE_FLEET='0')
    result = subprocess.run(['bash', str(installer)], env=env,
                            capture_output=True, text=True)
    assert (result.returncode == 0) == expected, result.stdout + result.stderr
    assert reason in result.stdout + result.stderr, result.stdout + result.stderr

def mutation_cases(version):
    version = tuple(map(int, version.split('.')))
    resources = [('sync-owner-policy.py', 'requires the owner-policy helper')]
    if version >= (0, 9, 274):
        resources.append(('CodexDictationCapture.html', 'requires the browser capture document'))
    if version >= (0, 9, 295):
        resources.append(('local-controller-sources.json', 'requires signed local-controller resource'))
        resources.append(('provision-local-controller.mjs', 'requires signed local-controller resource'))
        resources.append(('openclaw-os1-bridge/index.mjs', 'requires signed controller bridge'))
    if version >= (0, 9, 302):
        resources.append(('openclaw-os1-bridge/rcc-runtime.mjs', 'requires signed RCC task-runtime module'))
        resources.append(('openclaw-os1-bridge/rcc-plugin.mjs', 'requires signed RCC task-runtime module'))
    if version >= (0, 9, 343):
        resources.append(('openclaw-os1-bridge/resource-usage.mjs', 'requires signed RCC resource-usage module'))
    routing_companions = ('adaptive-plan-host.mjs', 'adaptive-routing-policy.mjs', 'joint-route-selector.mjs', 'local-plan-planner.mjs', 'local-plan-proposal.mjs', 'routing-outcome.mjs', 'routing-outcome-capture.mjs')
    if version >= (0, 9, 350):
        resources.extend(('openclaw-os1-bridge/' + name, 'requires signed RCC routing companion: ' + name) for name in routing_companions)
    frozen_companions = ('frozen-route-artifacts.mjs', 'frozen-route-predictor.mjs')
    if version >= (0, 9, 351):
        resources.extend(('openclaw-os1-bridge/' + name, 'requires signed RCC frozen route companion: ' + name) for name in frozen_companions)
    calibrated_companions = ('offline-route-calibration.mjs', 'frozen-route-evidence.mjs', 'calibrated-route-evidence.mjs', 'calibrated-route-predictor.mjs')
    if version >= (0, 9, 356):
        resources.extend(('openclaw-os1-bridge/' + name, 'requires signed RCC calibrated route companion: ' + name) for name in calibrated_companions)
    return [(filename, mutation, missing_reason)
            for filename, missing_reason in resources
            for mutation in (('rename', 'content', 'symlink') if (filename.endswith('/resource-usage.mjs') or filename.rsplit('/', 1)[-1] in routing_companions + frozen_companions + calibrated_companions) else ('rename', 'content'))]


def verify_mutation(package, manifest, filename, mutation, missing_reason):
    # Only immutable package/manifest inputs are shared. Each worker and each
    # installer invocation owns a distinct temporary extraction and output.
    with tempfile.TemporaryDirectory(prefix='os1-beta-policy-') as tmp:
        root = Path(tmp)
        expanded = root / 'expanded'
        subprocess.run(['pkgutil', '--expand-full', str(package), str(expanded)], check=True)
        helper = expanded / 'OS-1-component.pkg/Payload/Applications/OS-1 CLODEX.app/Contents/Resources/' / filename
        assert helper.is_file()
        if mutation == 'rename':
            helper.rename(helper.with_name('unexpected-' + helper.name))
        elif mutation == 'symlink':
            # Preserve the payload's file count while proving aliases are refused.
            target = helper.with_name('moved-' + helper.name)
            helper.rename(target)
            helper.symlink_to(target.name)
        else:
            with helper.open('a') as f:
                f.write('\n# unauthorized payload mutation\n')
        changed = root / 'changed.pkg'
        subprocess.run(['pkgutil', '--flatten', str(expanded), str(changed)], check=True)
        meta = json.loads(manifest.read_text())
        meta['sha256'] = hashlib.sha256(changed.read_bytes()).hexdigest()
        meta['size'] = changed.stat().st_size
        changed_meta = root / 'changed.json'
        changed_meta.write_text(json.dumps(meta))
        verify(changed, changed_meta, False,
               missing_reason if mutation == 'rename' else
               'refused a symbolic link' if mutation == 'symlink' else
               'refused the unnotarized beta package')


def run_verification(package, manifest):
    # The legitimate positive MUST finish serially before any mutation starts.
    verify(package, manifest, True, 'installation was not performed')
    cases = mutation_cases(json.loads(manifest.read_text())['version'])
    failures = []
    with ThreadPoolExecutor(max_workers=MUTATION_WORKERS) as pool:
        futures = [(case, pool.submit(verify_mutation, package, manifest, *case)) for case in cases]
        # Observe EVERY result, in the original case order. A failure cannot
        # hide later cases, cancel their checks, or become a successful return.
        for case, future in futures:
            try:
                future.result()
            except Exception as error:
                failures.append((case, error))
    if failures:
        detail = '\n'.join(f'{case[0]} [{case[1]}]: {error}' for case, error in failures)
        raise AssertionError(f'{len(failures)}/{len(cases)} beta mutation cases failed:\n{detail}') from failures[0][1]
    print('PASS: legitimate payload accepted; same-count resource rename and signed-resource mutation rejected')
    return len(cases)


if __name__ == '__main__':
    package, manifest = (Path(p).resolve() for p in sys.argv[1:])
    run_verification(package, manifest)
