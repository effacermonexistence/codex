#!/usr/bin/env python3
"""Run real beta-package verification without installation or provider calls."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

package, manifest = (Path(p).resolve() for p in sys.argv[1:])
installer = Path(__file__).with_name('install-os1.sh').resolve()

def verify(pkg, meta, expected, reason):
    env = dict(os.environ, OS1_ALLOW_UNNOTARIZED_BETA='1',
               OS1_BETA_PACKAGE_PATH=str(pkg), OS1_BETA_MANIFEST_PATH=str(meta),
               OS1_VERIFY_ONLY='1', OS1_SKIP_PREREQUISITES='1',
               OS1_SKIP_LOGIN='1', OS1_ENABLE_FLEET='0')
    result = subprocess.run(['bash', str(installer)], env=env,
                            capture_output=True, text=True)
    assert (result.returncode == 0) == expected, result.stdout + result.stderr
    assert reason in result.stdout + result.stderr, result.stdout + result.stderr

verify(package, manifest, True, 'installation was not performed')
for mutation in ('rename', 'content'):
    with tempfile.TemporaryDirectory(prefix='os1-beta-policy-') as tmp:
        root = Path(tmp)
        expanded = root / 'expanded'
        subprocess.run(['pkgutil', '--expand-full', str(package), str(expanded)], check=True)
        helper = expanded / 'OS-1-component.pkg/Payload/Applications/OS-1 CLODEX.app/Contents/Resources/sync-owner-policy.py'
        assert helper.is_file()
        if mutation == 'rename':
            helper.rename(helper.with_name('unexpected-policy.py'))
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
               'unexpected payload file' if mutation == 'rename' else 'refused the unnotarized beta package')
print('PASS: legitimate helper accepted; same-count rename and signed-resource mutation rejected')
