#!/usr/bin/env python3
"""Refresh the latest explicitly named RCC engine note; no credentials or R2 writes.
Atomic, private, content addressed. No model calls and no silent full-text truncation.
"""
import fcntl, hashlib, json, math, os, pathlib, re, subprocess, time
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

# Bulk property reads: two Apple Events for the matching list instead of
# N lazy note-property roundtrips. Same live index, tie and capture-race gates.
INDEX_SCRIPT = 'with timeout of 15 seconds\n tell application "Notes"\n set noteIDs to id of (every note whose name contains "RCC ENGINE v26")\n set noteDates to modification date of (every note whose name contains "RCC ENGINE v26")\n set verifyIDs to id of (every note whose name contains "RCC ENGINE v26")\n if noteIDs is not equal to verifyIDs then error "Canonical index changed during bulk read"\n end tell\n set epoch to current date\n set year of epoch to 1970\n set month of epoch to January\n set day of epoch to 1\n set time of epoch to 0\n set rows to ""\n repeat with i from 1 to count of noteIDs\n set rows to rows & (item i of noteIDs) & tab & ((item i of noteDates) - epoch) & linefeed\n end repeat\n return rows\nend timeout'

def cached_latest_script(note, modified):
    # Optimization only: unsupported identities/clocks use the original index.
    # Strict interpolation grammar; never quote or coerce arbitrary pointer data.
    if not isinstance(note, str) or re.fullmatch(
        r'x-coredata://[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}/ICNote/p[0-9]{1,20}', note) is None:
        return None
    if not isinstance(modified, str) or re.fullmatch(r'[0-9]{1,12}', modified) is None:
        return None
    stamp = int(modified)
    if str(stamp) != modified or not math.isfinite(float(stamp)):
        return None
    # Same AppleScript epoch arithmetic and whole-second frame as INDEX_SCRIPT.
    # Exactly [note] proves its membership/time bucket and absence of another
    # matching note at or above that bucket. Same-second edits were already
    # invisible to the original cached ID/integer-time comparison.
    return '''with timeout of 15 seconds
 set epoch to current date
 set year of epoch to 1970
 set month of epoch to January
 set day of epoch to 1
 set time of epoch to 0
 set cachedID to "'''+note+'''"
 set lowerDate to epoch + '''+modified+'''
 set upperDate to lowerDate + 1
 tell application "Notes"
  set noteIDs to id of (every note whose name contains "RCC ENGINE v26" and ((id is cachedID and modification date is greater than or equal to lowerDate and modification date is less than upperDate) or (id is not cachedID and modification date is greater than or equal to lowerDate)))
 end tell
 if class of noteIDs is not list then error "Unsupported canonical note ID list"
 if (count of noteIDs) is not 1 then return ""
 if class of (item 1 of noteIDs) is not text then error "Unsupported canonical note identity"
 if item 1 of noteIDs is cachedID then return cachedID
 return ""
end timeout'''

def verified_cached_source(ROOT, old):
    digest=old.get('sourceSHA256', '')
    if not isinstance(digest, str) or len(digest)!=64 or any(c not in '0123456789abcdef' for c in digest) or old.get('sourceFile')!=digest+'.txt':
        raise ValueError('Invalid cached source path')
    path=ROOT/old['sourceFile']
    if path.is_symlink() or path.stat().st_size>4_000_000:
        raise ValueError('Invalid cached source')
    source=path.read_text()
    if sha(source)!=digest: raise ValueError('Cached source integrity failure')
    return source

# An unchanged, recently certified snapshot is not rewritten. The Swift
# loader accepts a certification up to 24 h old; re-certify hourly.
RECERTIFY_SECONDS = 3600

def refresh(root, run_osa=osa, now=time.time):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    with open(root/"sync.lock", "a") as lock:
        os.chmod(root/"sync.lock", 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        return refresh_locked(root, run_osa, now)

def refresh_locked(ROOT, run_osa, now=time.time):
    active=ROOT/'active.json'
    if active.is_symlink(): raise ValueError('Policy pointer must not be a symlink')
    old=json.loads(active.read_text()) if active.exists() else {}
    if not isinstance(old, dict): raise ValueError('Invalid policy pointer')
    source = verified_cached_source(ROOT, old) if old else None
    script = cached_latest_script(old.get('sourceID'), old.get('sourceModified'))
    certified = False
    if script is not None and source is not None:
        try:
            returned = run_osa(script)
            # No deduplication, inferred type conversion, whitespace repair,
            # TTL or database proxy. Every promotion has a fresh Notes query.
            certified = isinstance(returned, str) and returned.splitlines() == [old['sourceID']]
        except (ValueError, OSError, subprocess.SubprocessError):
            certified = False
    if certified:
        note,modified=old['sourceID'],old['sourceModified']
    else:
        note,modified=latest_note(run_osa(INDEX_SCRIPT))
    cached = old.get('sourceID')==note and old.get('sourceModified')==modified
    if cached:
        if source is None: source=verified_cached_source(ROOT, old)
        # A live predicate or complete index certified the same identity/time.
        # Nothing was captured; full capture below retains its second index.
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
    # The core laws are sent whole, up to the next PART heading (bounded):
    # a 1700-character cut kept only laws 0-5 of the operational core.
    whole={'PART 1 — RCC CORE LAWS':9000}
    sections=[]
    for anchor in anchors:
        i=source.find(anchor)
        if i<0: raise SystemExit('Required policy anchor absent: '+anchor)
        following=re.search(r'\n=+[ \t]*\nPART \d', source[i+len(anchor):i+whole[anchor]]) if anchor in whole else None
        if following:
            fragment=source[i:i+len(anchor)+following.start()].rstrip()
        else:
            # End at a complete line, explicitly identifying a section excerpt.
            fragment=source[i:i+1700].rsplit('\n',1)[0]
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
    digest=sha(source)
    record=dict(schema=1,sourceSHA256=digest,sourceFile=digest+'.txt',projectionSHA256=sha(routing+'\n'+projection),
     projection=projection,sourceID=note,sourceModified=modified,checkedAt=now(),routing=routing)
    same=cached and all(old.get(k)==record[k] for k in record if k!='checkedAt')
    try: age=record['checkedAt']-float(old.get('checkedAt'))
    except (TypeError, ValueError): age=-1
    if same and 0<=age<RECERTIFY_SECONDS:
        return {k:old[k] for k in ['sourceSHA256','projectionSHA256','checkedAt']}
    if not cached: write(ROOT, digest+'.txt',source)
    write(ROOT, 'active.json',json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    return {k:record[k] for k in ['sourceSHA256','projectionSHA256','checkedAt']}

if __name__ == '__main__':
    try:
        print(json.dumps(refresh(pathlib.Path.home()/'.os1/owner-policy')))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        raise SystemExit('Owner policy refresh rejected ('+type(error).__name__+'); existing snapshot retained.')
