#!/usr/bin/env python3
"""Refresh the latest explicitly named RCC engine note; no credentials or R2 writes.
Atomic, private, content addressed. No model calls and no silent full-text truncation.
"""
import fcntl, hashlib, json, math, os, pathlib, re, subprocess, sys, time
OSA_TIMEOUT_SECONDS = 20
def osa(text, timeout=OSA_TIMEOUT_SECONDS):
    return subprocess.run(['/usr/bin/osascript','-e',text],capture_output=True,text=True,timeout=timeout,check=True).stdout.rstrip('\n')

# Notes can be slow to answer right after login while it finishes its iCloud
# start-up (2026-10-05: two 15 s AppleEvent timeouts, then Notes answered in
# 0.17 s three minutes later). Such a query failure is retried exactly once,
# outside the refresh lock, inside one hard budget that the Swift caller
# outlasts (OwnerPolicyRefresh.helperTimeoutSeconds). Integrity failures
# (digest, tie, note changed during capture, missing anchors) and permission
# errors are never retried; the policy stays fail-closed.
RETRY_DELAY_SECONDS = 15
REFRESH_BUDGET_SECONDS = 95
# AppleEvent timed out, application isn't running, connection is invalid.
TRANSIENT_NOTES_ERRORS = ('(-1712)', '(-600)', '(-609)')

def transient_notes_failure(error):
    if isinstance(error, subprocess.TimeoutExpired): return True
    return isinstance(error, subprocess.CalledProcessError) and isinstance(error.stderr, str) \
        and any(code in error.stderr for code in TRANSIENT_NOTES_ERRORS)

class RefreshBudgetExhausted(subprocess.SubprocessError):
    """The refresh budget ran out before the next Notes query could be sent (a
    long sync.lock wait, or earlier queries and the retry used it up). That
    query was never sent, so this is not its timeout; fail closed, never
    retried. refresh_locked names the unsent query (os1_query), whether any
    query was sent in this refresh (os1_sent) and an earlier Notes failure it
    swallowed in this refresh (os1_earlier), so the cause stays honest."""

def bounded_osa(deadline, clock=time.monotonic, run=osa):
    # No single Notes query outlives the refresh budget.
    def call(text):
        remaining = deadline - clock()
        if remaining < 1: raise RefreshBudgetExhausted()
        return run(text, timeout=min(OSA_TIMEOUT_SECONDS, remaining))
    return call

def one_line(text, limit=200, keep_end=False):
    lines = [l.strip() for l in str(text).splitlines() if l.strip()]
    line = ''.join(c if c.isprintable() else ' ' for c in (lines[-1] if lines else ''))
    if len(line) <= limit: return line
    return '...'+line[-(limit-3):] if keep_end else line[:limit]

def osascript_error_code(line):
    # osascript ends its message with Apple's error number, e.g. "(-1728)".
    found = re.search(r'\((-?[0-9]{1,6})\)\s*$', line)
    return found.group(1) if found else None

def describe(error):
    # The cause, bounded and on one line, the discriminating part first:
    # the Swift caller records each stderr line capped, and Apple's error code
    # is what tells two causes apart. osascript's stderr carries Apple's error
    # text and code, never the note's text (that is stdout only).
    if isinstance(error, RefreshBudgetExhausted):
        query = getattr(error, 'os1_query', None) or 'the next Notes query'
        earlier = getattr(error, 'os1_earlier', None)
        if earlier:
            # 2026-10-05 review: a swallowed Notes timeout used up the budget;
            # the cause must point at Notes, not say nothing was asked.
            return 'RefreshBudgetExhausted: '+earlier+'; refresh time budget then exhausted before '+query
        if getattr(error, 'os1_sent', None) is False:
            return 'RefreshBudgetExhausted: refresh time budget exhausted before querying Notes'
        return 'RefreshBudgetExhausted: refresh time budget exhausted before '+query
    if isinstance(error, subprocess.CalledProcessError):
        # The end of the line holds the code; keep it when the line is long.
        line = one_line(error.stderr or '', keep_end=True)
        code = osascript_error_code(line)
        return ('osascript error '+code+' (exit '+str(error.returncode)+')' if code
                else 'osascript exit '+str(error.returncode))+': '+line
    if isinstance(error, subprocess.TimeoutExpired):
        cause = 'Notes did not answer within '+str(int(error.timeout or 0))+' s'
    elif isinstance(error, OSError):
        cause = one_line(error.strerror or '')
    else:
        cause = one_line(error)
    return type(error).__name__+': '+cause

def failure_message(error, retried):
    # Cause first, then what OS-1 did about it.
    return (describe(error)+'; owner policy refresh rejected'
            +('; retried once after '+str(RETRY_DELAY_SECONDS)+' s' if retried else '')
            +'; existing snapshot retained.')
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

def swallowed_notes_failure(error, query):
    # One line for a transient Notes failure refresh_locked swallowed.
    if isinstance(error, subprocess.TimeoutExpired):
        return 'Notes query timed out ('+query+')'
    code = osascript_error_code(one_line(getattr(error, 'stderr', '') or '', keep_end=True))
    return 'Notes query failed'+(' with osascript error '+code if code else '')+' ('+query+')'

def refresh(root, run_osa=None, now=time.time, sleep=time.sleep, clock=time.monotonic,
            report=lambda line: print(line, file=sys.stderr, flush=True)):
    deadline = clock() + REFRESH_BUDGET_SECONDS
    if run_osa is None: run_osa = bounded_osa(deadline, clock)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    retried = False
    # Across both attempts: whether Notes was queried at all, and the latest
    # Notes failure refresh_locked swallowed (for an honest final cause).
    trace = {'sent': 0, 'swallowed': None}
    while True:
        try:
            with open(root/"sync.lock", "a") as lock:
                os.chmod(root/"sync.lock", 0o600)
                fcntl.flock(lock, fcntl.LOCK_EX)
                return refresh_locked(root, run_osa, now, trace)
        except subprocess.SubprocessError as error:
            # Nothing is written before every query has answered, so a whole
            # second attempt is safe. Exactly one, and only with time left.
            if retried or not transient_notes_failure(error) \
                    or deadline-clock() < RETRY_DELAY_SECONDS+OSA_TIMEOUT_SECONDS:
                error.os1_retried = retried
                raise
            retried = True
            report(describe(error)+'; Notes query failed, retrying once in '+str(RETRY_DELAY_SECONDS)+' s.')
        sleep(RETRY_DELAY_SECONDS)

def refresh_locked(ROOT, run_osa, now=time.time, trace=None):
    trace = {'sent': 0, 'swallowed': None} if trace is None else trace
    def ask(script, query):
        # Every Notes query, counted and named: a budget that runs out names
        # the query it could not send and any earlier swallowed Notes failure.
        try:
            answer = run_osa(script)
        except RefreshBudgetExhausted as error:
            error.os1_query = query
            error.os1_sent = trace['sent'] > 0
            error.os1_earlier = trace['swallowed']
            raise
        except BaseException:
            trace['sent'] += 1
            raise
        trace['sent'] += 1
        return answer
    active=ROOT/'active.json'
    if active.is_symlink(): raise ValueError('Policy pointer must not be a symlink')
    old=json.loads(active.read_text()) if active.exists() else {}
    if not isinstance(old, dict): raise ValueError('Invalid policy pointer')
    source = verified_cached_source(ROOT, old) if old else None
    script = cached_latest_script(old.get('sourceID'), old.get('sourceModified'))
    certified = False
    if script is not None and source is not None:
        try:
            returned = ask(script, 'the cached certification')
            # No deduplication, inferred type conversion, whitespace repair,
            # TTL or database proxy. Every promotion has a fresh Notes query.
            certified = isinstance(returned, str) and returned.splitlines() == [old['sourceID']]
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            certified = False
            if transient_notes_failure(error):
                trace['swallowed'] = swallowed_notes_failure(error, 'cached certification')
    if certified:
        note,modified=old['sourceID'],old['sourceModified']
    else:
        note,modified=latest_note(ask(INDEX_SCRIPT, 'the index query'))
    cached = old.get('sourceID')==note and old.get('sourceModified')==modified
    if cached:
        if source is None: source=verified_cached_source(ROOT, old)
        # A live predicate or complete index certified the same identity/time.
        # Nothing was captured; full capture below retains its second index.
    else:
        source=ask('with timeout of 20 seconds\n tell application "Notes" to get plaintext of note id "'+note+'"\nend timeout',
                   'the note capture')+'\n'
        # A concurrent edit/newer note must never be certified with the old timestamp.
        if latest_note(ask(INDEX_SCRIPT, 'the capture re-check index query')) != (note, modified):
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
        raise SystemExit(failure_message(error, getattr(error, 'os1_retried', False)))
