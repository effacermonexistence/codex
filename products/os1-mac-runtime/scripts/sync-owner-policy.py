#!/usr/bin/env python3
"""Refresh the latest explicitly named RCC engine note; no credentials or R2 writes.
Atomic, private, content addressed. No model calls and no silent full-text truncation.
"""
import fcntl, hashlib, json, math, os, pathlib, subprocess, time
def osa(text):
    return subprocess.run(['/usr/bin/osascript','-e',text],capture_output=True,text=True,timeout=20,check=True).stdout.rstrip('\n')
def sha(s): return hashlib.sha256(s.encode()).hexdigest()
def write(root, name, body):
    p=root/name; tmp=root/(name+'.'+str(os.getpid())+'.tmp')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:
        f.write(body)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp,p)

def latest_note(index):
    rows=[r.split('\t') for r in index.splitlines() if '\t' in r]
    if not rows: raise ValueError('No canonical RCC engine note available')
    for row in rows:
        if len(row)!=2 or not row[0].startswith('x-coredata://') or any(c in row[0] for c in ['"', '\\', '\r', '\n']):
            raise ValueError('Invalid note identity')
        timestamp=float(row[1])
        if not math.isfinite(timestamp) or timestamp<0 or not timestamp.is_integer():
            raise ValueError('Invalid note modification time')
        row[1]=str(int(timestamp))
    newest=max(int(r[1]) for r in rows)
    candidates=set(tuple(r) for r in rows if int(r[1])==newest)
    if len(candidates)!=1: raise ValueError('Canonical note tie requires resolution')
    return next(iter(candidates))

INDEX_SCRIPT = 'with timeout of 15 seconds\n tell application "Notes"\n set epoch to current date\n set year of epoch to 1970\n set month of epoch to January\n set day of epoch to 1\n set time of epoch to 0\n set rows to ""\n repeat with n in (every note whose name contains "RCC ENGINE v26")\n set rows to rows & (id of n) & tab & ((modification date of n) - epoch) & linefeed\n end repeat\n return rows\n end tell\nend timeout'

def refresh(root, run_osa=osa):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    with open(root/"sync.lock", "a") as lock:
        os.chmod(root/"sync.lock", 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        return refresh_locked(root, run_osa)

def refresh_locked(ROOT, run_osa):
    note,modified=latest_note(run_osa(INDEX_SCRIPT))
    active=ROOT/'active.json'
    if active.is_symlink(): raise ValueError('Policy pointer must not be a symlink')
    old=json.loads(active.read_text()) if active.exists() else {}
    if old.get('sourceID')==note and old.get('sourceModified')==modified:
        digest=old.get('sourceSHA256', '')
        if len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest) or old.get('sourceFile')!=digest+'.txt':
            raise ValueError('Invalid cached source path')
        path=ROOT/old['sourceFile']
        if path.is_symlink() or path.stat().st_size>4_000_000: raise ValueError('Invalid cached source')
        source=path.read_text()
        if sha(source)!=digest: raise ValueError('Cached source integrity failure')
    else:
        source=run_osa('with timeout of 20 seconds\n tell application "Notes" to get plaintext of note id "'+note+'"\nend timeout')+'\n'
    # A concurrent edit/newer note must never be certified with the old timestamp.
    if latest_note(run_osa(INDEX_SCRIPT)) != (note, modified):
        raise ValueError('Canonical note changed during capture; existing snapshot retained')
    if not 1000<len(source.encode())<=4_000_000 or 'REVAS' not in source: raise SystemExit('Invalid canonical note')
    # Exact, bounded extracts. Required anchors missing => no promotion. Original is
    # preserved in full, including patches outside the execution projection.
    anchors=['CORE OPERATION','PART 1 — RCC CORE LAWS','PART 22A — MEMORY RECALL / PROVENANCE HARD GATE',
             'PART 1C — RCC FOUNDATIONAL BOUNDARY THEORY','UNKNOWN STATE PRESERVATION /',
             'LOCAL FRAME PRIORITY /','STRATEGIC DECISION RANKING STABILITY /']
    sections=[]
    for anchor in anchors:
        i=source.find(anchor)
        if i<0: raise SystemExit('Required policy anchor absent: '+anchor)
        fragment=source[i:i+1700]
        # End at a complete line, explicitly identifying a section excerpt.
        fragment=fragment.rsplit('\n',1)[0]
        line=source[:i].count("\n")+1
        sections.append('[EXACT SOURCE EXCERPT: '+anchor+"; source line "+str(line)+']\n'+fragment)
    projection='\n\n'.join(sections)
    routing='''Routing adapter derived from the owner governance policy:
    Preserve the current objective and explicit provider preference; history is evidence, not a new command.
    Choose only a currently available model/effort/capability tuple. Architecture, diagnosis and verification
    require sufficient capability; routine implementation may use a cheaper capable route. Minimize total
    expected work including retries, not just a single-call token count. Respect capacity and route to a
    usable alternative on pre-dispatch unavailability. Never replay uncertain external effects blindly.
    Use actual token usage when returned; label estimates and missing quota/cost values. No invented
    savings or completion rates. OS1 delegates execution; backend permissions remain authoritative.'''
    digest=sha(source); write(ROOT, digest+'.txt',source)
    record=dict(schema=1,sourceSHA256=digest,sourceFile=digest+'.txt',projectionSHA256=sha(routing+'\n'+projection),
     projection=projection,sourceID=note,sourceModified=modified,checkedAt=time.time(),routing=routing)
    write(ROOT, 'active.json',json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    return {k:record[k] for k in ['sourceSHA256','projectionSHA256','checkedAt']}

if __name__ == '__main__':
    try:
        print(json.dumps(refresh(pathlib.Path.home()/'.os1/owner-policy')))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit('Owner policy refresh rejected ('+type(error).__name__+'); existing snapshot retained.')
