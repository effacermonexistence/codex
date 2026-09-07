#!/usr/bin/env python3
"""Install a locally verified OS1 payload without system or credential changes.

Invoke only from install-os1.sh after its beta package allowlist/signature gate.
No postinstall system script runs in this per-user installation mode.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import time
import uuid

HOME = Path.home()
APP = HOME / 'Applications/OS-1 CLODEX.app'
CLI = HOME / '.local/bin/os1'
LABEL = 'com.os1.fleet-agent'
SERVICE = 'gui/' + str(os.getuid()) + '/' + LABEL
PLIST = HOME / ('Library/LaunchAgents/' + LABEL + '.plist')
FLEET = HOME / '.os1/fleet'
EXPECTED_AIR = 'device:41a2a3af-3e78-4fdf-a722-bd12fc48ae0f'

def run(args, timeout=30, check=True):
    p = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=timeout)
    if check and p.returncode:
        raise RuntimeError(Path(str(args[0])).name + ' failed with exit ' + str(p.returncode))
    return p

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for b in iter(lambda: stream.read(1_048_576), b''): h.update(b)
    return h.hexdigest()

def save(path, value):
    path.write_text(json.dumps(value, indent=2)); path.chmod(0o600)

def validate_app(path):
    info = plistlib.loads((path / 'Contents/Info.plist').read_bytes())
    if info['CFBundleIdentifier'] != 'com.omaragi.os1': raise RuntimeError('App identity mismatch')
    run(['/usr/bin/codesign', '--verify', '--deep', '--strict', path])
    return info

def process_ids(executable):
    records=run(['/bin/ps','-axo','pid=,comm=']).stdout.splitlines()
    return [int(line.strip().split(None,1)[0]) for line in records
            if len(line.strip().split(None,1)) == 2 and line.strip().split(None,1)[1] == str(executable)]

payload=Path(sys.argv[1]).resolve()
expected_version=sys.argv[2]
new_app=payload/'Applications/OS-1 CLODEX.app'
new_cli=payload/'usr/local/bin/os1'
assert APP.is_dir() and not APP.is_symlink() and CLI.is_file() and not CLI.is_symlink()
assert HOME == Path('/Users/LUA') and APP.parent == HOME/'Applications'
old_info=validate_app(APP); new_info=validate_app(new_app)
assert new_info['CFBundleShortVersionString'] == expected_version
run(['/usr/bin/codesign','--verify','--strict',new_cli])
assert 'Identifier=com.omaragi.os1.runtime\n' in run(['/usr/bin/codesign','-d','--verbose=2',CLI]).stderr
snapshot=json.loads(run([CLI,'fleet-snapshot']).stdout)
air=next(n for n in snapshot['nodes'] if n['device_id']==EXPECTED_AIR)
assert air['role']=='air' and air['queue_depth']==0
assert not (FLEET/'main-agent-active.json').exists()
assert not (FLEET/'main-agent-claim.json').exists()
sessions=HOME/'Library/Application Support/OS-1/sessions.json'
session_data=json.loads(sessions.read_text())
if isinstance(session_data,dict):
    assert not session_data.get('inFlight') and not session_data.get('queued')
paths=[HOME/'.local/bin/config.json', HOME/'.codex/hooks.json', HOME/'.claude/settings.json', PLIST]
preserved={str(p):digest(p) for p in paths}
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-air-repair-'+uuid.uuid4().hex[:8]
backup=HOME/'.os1/install-backups'/stamp
backup.mkdir(parents=True,mode=0o700)
run(['/usr/bin/ditto',CLI,backup/'os1'])
run(['/usr/bin/ditto',PLIST,backup/'fleet-agent.plist'])
run(['/usr/bin/ditto',HOME/'.local/bin/config.json',backup/'public-config.json'])
# Settings may contain environment credentials. Preserve hook declarations only;
# originals are never modified here and their whole-file hashes are checked.
save(backup/'hooks-only.json',{str(p):json.loads(p.read_text()).get('hooks') for p in paths[1:3]})
save(backup/'rollback.json',{'app':str(APP),'cli':str(CLI),'old_version':old_info['CFBundleShortVersionString'],
                          'old_build':old_info['CFBundleVersion'],'preserved_hashes':preserved})
staged_app=APP.parent/('.OS1-repair-'+uuid.uuid4().hex+'.app')
staged_cli=CLI.parent/('.os1-repair-'+uuid.uuid4().hex)
run(['/usr/bin/ditto',new_app,staged_app],timeout=90)
run(['/usr/bin/ditto',new_cli,staged_cli]); staged_cli.chmod(0o755)
validate_app(staged_app)
app_pids=process_ids(APP/'Contents/MacOS/OS1App')
stopped=False; swapped=False
try:
    run(['/bin/launchctl','bootout',SERVICE]); stopped=True
    if (FLEET/'main-agent-active.json').exists() or (FLEET/'main-agent-claim.json').exists():
        raise RuntimeError('Fleet claimed work during quiescence; upgrade cancelled')
    if app_pids:
        run(['/usr/bin/osascript','-e','tell application "'+str(APP)+'" to quit'])
        deadline=time.monotonic()+20
        while process_ids(APP/'Contents/MacOS/OS1App') and time.monotonic()<deadline: time.sleep(.25)
        if process_ids(APP/'Contents/MacOS/OS1App'): raise RuntimeError('OS1 app did not quit normally')
    APP.rename(backup/'OS-1 CLODEX.app')
    swapped=True
    staged_app.rename(APP)
    os.replace(staged_cli,CLI)
    assert digest(CLI)==digest(new_cli)
    validate_app(APP)
    for args in [[CLI,'self-test'],[CLI,'fleet-self-test'],[APP/'Contents/MacOS/OS1App','--self-test'],
                 [APP/'Contents/MacOS/OS1App','--self-test-parallel']]: run(args,timeout=90)
    assert {str(p):digest(p) for p in paths}==preserved
    run(['/bin/launchctl','bootstrap','gui/'+str(os.getuid()),PLIST])
    stopped=False
    if app_pids: run(['/usr/bin/open','-g','-a',APP])
    save(backup/'installed.json',{'version':expected_version,'build':new_info['CFBundleVersion'],
         'cli_sha256':digest(CLI),'preserved_hashes':preserved,'credential_files_copied':0})
    print(json.dumps({'installed':expected_version,'build':new_info['CFBundleVersion'],'rollback':str(backup),
                      'credential_files_copied':0}))
except Exception:
    if swapped:
        if APP.exists(): APP.rename(backup/'failed-new-app.app')
        (backup/'OS-1 CLODEX.app').rename(APP)
        run(['/usr/bin/ditto',backup/'os1',staged_cli]); os.replace(staged_cli,CLI)
    if stopped: run(['/bin/launchctl','bootstrap','gui/'+str(os.getuid()),PLIST],check=False)
    if app_pids: run(['/usr/bin/open','-g','-a',APP],check=False)
    raise
