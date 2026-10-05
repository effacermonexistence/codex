#!/usr/bin/env python3
"""Deterministic source-acquisition regressions. No Notes, network, or model calls."""
import importlib.util, json, pathlib, re, subprocess, tempfile, unittest
spec=importlib.util.spec_from_file_location('policy_sync', pathlib.Path(__file__).with_name('sync-owner-policy.py'))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ANCHORS=['CORE OPERATION','PART 1 — RCC CORE LAWS','PART 22A — MEMORY RECALL / PROVENANCE HARD GATE',
         'PART 1C — RCC FOUNDATIONAL BOUNDARY THEORY','UNKNOWN STATE PRESERVATION /',
         'LOCAL FRAME PRIORITY /','STRATEGIC DECISION RANKING STABILITY /']
SOURCE='REVAS\n'+'\n'.join(a+'\n'+('fixture rule\n'*155) for a in ANCHORS)
INDEX='x-coredata://fixture/ICNote/p1\t100'
FAST_ID='x-coredata://00000000-0000-0000-0000-000000000001/ICNote/p1'
OTHER_ID='x-coredata://00000000-0000-0000-0000-000000000002/ICNote/p2'
FAST_INDEX=FAST_ID+'\t100'
class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.root=pathlib.Path(self.tmp.name)/'policy'
    def tearDown(self): self.tmp.cleanup()
    def capture(self, indexes=None, source=SOURCE, now=None):
        answers=iter(indexes or [INDEX,INDEX]); self.exports=0; self.index_reads=0
        def call(script):
            if script==m.INDEX_SCRIPT: self.index_reads+=1; return next(answers)
            self.exports+=1; return source
        return m.refresh(self.root,call,now or m.time.time)
    def test_roundtrip_and_cache(self):
        result=self.capture(); raw=(self.root/'active.json').read_bytes()
        record=json.loads(raw); self.assertEqual(result['sourceSHA256'],m.sha(SOURCE+'\n'))
        self.assertEqual(record['projectionSHA256'],m.sha(record['routing']+'\n'+record['projection']))
        self.capture(); self.assertEqual(self.exports,0)
        self.assertEqual((self.root/record['sourceFile']).stat().st_mode & 0o777,0o600)
    def test_changed_during_export_preserves_pointer(self):
        self.capture(); before=(self.root/'active.json').read_bytes()
        with self.assertRaises(ValueError): self.capture([INDEX.replace('100','101'), INDEX.replace('100','102')])
        self.assertEqual(before,(self.root/'active.json').read_bytes())
    def test_cache_hit_is_one_read_and_no_write(self):
        self.capture(); p=self.root/'active.json'; before=p.read_bytes(); stamp=p.stat().st_mtime_ns
        record=json.loads(before); source=self.root/record['sourceFile']; source_stamp=source.stat().st_mtime_ns
        result=self.capture([INDEX])
        self.assertEqual((self.index_reads,self.exports),(1,0))
        self.assertEqual((p.read_bytes(),p.stat().st_mtime_ns,source.stat().st_mtime_ns),(before,stamp,source_stamp))
        self.assertEqual(result['sourceSHA256'],record['sourceSHA256'])
    def test_stale_certification_is_renewed_without_recapture(self):
        self.capture(); record=json.loads((self.root/'active.json').read_text())
        later=record['checkedAt']+m.RECERTIFY_SECONDS+5
        self.capture([INDEX], now=lambda: later)
        renewed=json.loads((self.root/'active.json').read_text())
        self.assertEqual((self.exports,renewed['checkedAt'],renewed['sourceSHA256']),(0,later,record['sourceSHA256']))
    def test_newer_note_on_index_forces_capture(self):
        self.capture(); newer=INDEX.replace('100','101')
        self.capture([newer,newer],SOURCE+'added rule\n')
        record=json.loads((self.root/'active.json').read_text())
        self.assertEqual((self.exports,record['sourceModified'],record['sourceSHA256']),(1,'101',m.sha(SOURCE+'added rule\n'+'\n')))
    def test_newer_note_during_capture_preserves_pointer(self):
        self.capture(); before=(self.root/'active.json').read_bytes()
        newer=INDEX.replace('100','101')
        with self.assertRaises(ValueError): self.capture([newer, newer+'\nx-coredata://other\t102'])
        self.assertEqual(before,(self.root/'active.json').read_bytes())
    def test_core_laws_are_sent_whole(self):
        laws='\n'.join(f'{n}. law {n} text' for n in range(300))
        bar='='*60
        source=SOURCE.replace('PART 1 — RCC CORE LAWS\n', 'PART 1 — RCC CORE LAWS\n'+laws+'\n\n'+bar+'\nPART 2 — NEXT\n'+bar+'\n',1)
        self.capture(source=source)
        projection=json.loads((self.root/'active.json').read_text())['projection']
        self.assertIn('299. law 299 text', projection)
        self.assertNotIn('PART 2 — NEXT', projection)
        self.assertEqual(projection.count('[EXACT SOURCE EXCERPT'), len(ANCHORS))
    def test_latest_selection(self):
        self.assertEqual(m.latest_note(INDEX+'\nx-coredata://older\t99'),tuple(INDEX.split('\t')))
    def test_applescript_scientific_time(self):
        self.assertEqual(m.latest_note(INDEX.replace("100","1.00E+2")),tuple(INDEX.split("\t")))
    def test_tie_rejected(self):
        with self.assertRaises(ValueError): m.latest_note(INDEX+'\nx-coredata://other\t100')
    def test_invalid_identity(self):
        for value in ['', 'bad\t100','x-coredata://bad"\t100', 'x-coredata://bad\\path\t100', 'x-coredata://ok\tNaN']:
            with self.assertRaises(ValueError): m.latest_note(value)
    def test_cached_path_rejected(self):
        self.capture(); p=self.root/'active.json'; record=json.loads(p.read_text());record['sourceFile']='../outside'
        p.write_text(json.dumps(record));before=p.read_bytes()
        with self.assertRaises(ValueError): self.capture()
        self.assertEqual(p.read_bytes(),before)
    def test_cached_source_tamper(self):
        self.capture(); record=json.loads((self.root/'active.json').read_text())
        (self.root/record['sourceFile']).write_text('tampered')
        with self.assertRaises(ValueError): self.capture()
    def test_cached_symlink(self):
        self.capture();record=json.loads((self.root/'active.json').read_text());p=self.root/record['sourceFile']
        other=self.root/'original';p.rename(other);p.symlink_to(other)
        with self.assertRaises(ValueError): self.capture()
    def test_missing_anchor_preserves_pointer(self):
        self.capture();before=(self.root/'active.json').read_bytes()
        with self.assertRaises(SystemExit): self.capture([INDEX.replace('100','101')]*2, SOURCE.replace(ANCHORS[-1],'REMOVED'))
        self.assertEqual(before,(self.root/'active.json').read_bytes())
    def test_transport_failure_preserves_pointer(self):
        self.capture(); before=(self.root/'active.json').read_bytes()
        def fail(_): raise OSError('transport unavailable')
        with self.assertRaises(OSError): m.refresh(self.root,fail)
        self.assertEqual(before,(self.root/'active.json').read_bytes())
    def test_no_locale_date_literal(self):
        self.assertNotIn('date "Thursday',m.INDEX_SCRIPT)
    def seed_fast(self): self.capture([FAST_INDEX,FAST_INDEX])
    def fast_refresh(self, returned=FAST_ID, indexes=None, error=None, now=None):
        record=json.loads((self.root/'active.json').read_text())
        predicate=m.cached_latest_script(record['sourceID'],record['sourceModified'])
        answers=iter(indexes or [FAST_INDEX]);self.fast_reads=0;self.index_reads=0;self.exports=0
        def call(script):
            if script==m.INDEX_SCRIPT:self.index_reads+=1;return next(answers)
            if script==predicate:
                self.fast_reads+=1
                if error is not None:raise error
                return returned
            self.exports+=1;return SOURCE
        return m.refresh(self.root,call,now or m.time.time)
    def test_fast_cached_one_fresh_query_no_write(self):
        self.seed_fast();p=self.root/'active.json';before=p.read_bytes();stamp=p.stat().st_mtime_ns
        self.fast_refresh()
        self.assertEqual((self.fast_reads,self.index_reads,self.exports),(1,0,0))
        self.assertEqual((p.read_bytes(),p.stat().st_mtime_ns),(before,stamp))
    def test_fast_non_singleton_and_malformed_fallback(self):
        self.seed_fast()
        for returned in ['', '\n', 'bad', FAST_ID+'\n'+OTHER_ID, FAST_ID+'\n'+FAST_ID,
                         ' '+FAST_ID, None, [], {}, FAST_ID+'\n\n']:
            self.fast_refresh(returned)
            self.assertEqual((self.fast_reads,self.index_reads,self.exports),(1,1,0))
    def test_fast_unsupported_and_error_fallback(self):
        self.seed_fast()
        for error in [OSError('unavailable'),ValueError('unsupported'),
                      subprocess.CalledProcessError(1,'osascript'),subprocess.TimeoutExpired('osascript',20)]:
            self.fast_refresh(error=error)
            self.assertEqual((self.fast_reads,self.index_reads,self.exports),(1,1,0))
    def test_fast_changed_time_full_capture_recheck(self):
        self.seed_fast();newer=FAST_ID+'\t101'
        self.fast_refresh('',[newer,newer])
        self.assertEqual((self.fast_reads,self.index_reads,self.exports),(1,2,1))
        self.assertEqual(json.loads((self.root/'active.json').read_text())['sourceModified'],'101')
    def test_fast_deleted_renamed_and_changed_id_fallback(self):
        for returned in ['', OTHER_ID]:
            self.seed_fast();replacement=OTHER_ID+'\t99'
            self.fast_refresh(returned,[replacement,replacement])
            self.assertEqual((self.fast_reads,self.index_reads,self.exports),(1,2,1))
            self.assertEqual(json.loads((self.root/'active.json').read_text())['sourceID'],OTHER_ID)
    def test_fast_new_note_tie_preserves_pointer(self):
        self.seed_fast();p=self.root/'active.json';before=p.read_bytes()
        with self.assertRaises(ValueError):self.fast_refresh(FAST_ID+'\n'+OTHER_ID,[FAST_INDEX+'\n'+OTHER_ID+'\t100'])
        self.assertEqual(p.read_bytes(),before)
    def test_fast_capture_race_keeps_full_second_index(self):
        self.seed_fast();p=self.root/'active.json';before=p.read_bytes()
        with self.assertRaises(ValueError):self.fast_refresh('',[FAST_ID+'\t101',FAST_ID+'\t102'])
        self.assertEqual((self.fast_reads,self.index_reads,self.exports),(1,2,1))
        self.assertEqual(p.read_bytes(),before)
    def test_fast_recertify_keeps_original_without_export(self):
        self.seed_fast();old=json.loads((self.root/'active.json').read_text());later=old['checkedAt']+m.RECERTIFY_SECONDS+1
        self.fast_refresh(now=lambda:later)
        new=json.loads((self.root/'active.json').read_text())
        self.assertEqual((self.fast_reads,self.index_reads,self.exports),(1,0,0))
        self.assertEqual((new['checkedAt'],new['sourceSHA256']),(later,old['sourceSHA256']))
    def test_fast_clock_and_identity_grammar_fail_closed(self):
        for note in [FAST_ID+'"', FAST_ID+'\\', FAST_ID+'\n', 'x-coredata://fixture/ICNote/p1',None,[]]:
            self.assertIsNone(m.cached_latest_script(note,'100'))
        for stamp in ['NaN','1e2','100.5','-1','+100','0100','9'*30,None,100,float('inf')]:
            self.assertIsNone(m.cached_latest_script(FAST_ID,stamp))
        script=m.cached_latest_script(FAST_ID,'100')
        self.assertIn('set lowerDate to epoch + 100',script)
        self.assertIn('set upperDate to lowerDate + 1',script)
        self.assertNotIn('date "',script)
    def test_fast_source_integrity_precedes_query(self):
        self.seed_fast();record=json.loads((self.root/'active.json').read_text())
        (self.root/record['sourceFile']).write_text('tampered')
        calls=[]
        with self.assertRaises(ValueError):m.refresh(self.root,lambda s:calls.append(s))
        self.assertEqual(calls,[])
    def test_fast_floor_half_second_semantics_match_original(self):
        self.seed_fast()
        # Current native metadata evidence includes .999541 -> floor, not
        # nearest-rounding. Model that same known whole-second cache contract.
        def selected(notes):
            return [note for note,date in notes if (note==FAST_ID and 100<=date<101) or (note!=FAST_ID and date>=100)]
        notes=[(FAST_ID,100.999541),(OTHER_ID,99.999541)]
        self.assertEqual(selected(notes),[FAST_ID])
        self.assertEqual(m.latest_note('\n'.join(note+'\t'+str(int(date)) for note,date in notes)),(FAST_ID,'100'))
        self.fast_refresh('\n'.join(selected(notes)))
        self.assertEqual((self.fast_reads,self.index_reads,self.exports),(1,0,0))
        tied=[(FAST_ID,100.025636),(OTHER_ID,100.999541)]
        self.assertEqual(selected(tied),[FAST_ID,OTHER_ID])
        with self.assertRaises(ValueError):m.latest_note('\n'.join(note+'\t'+str(int(date)) for note,date in tied))
    # A Notes query that times out right after login (2026-10-05: two 15 s
    # AppleEvent timeouts while Notes finished its iCloud start-up) is retried
    # once; an integrity failure never is, and a second failure fails closed.
    def notes(self, answers, source=SOURCE):
        self.sleeps=[]; self.reports=[]; self.index_reads=0; self.exports=0; queue=iter(answers)
        def call(script):
            if script==m.INDEX_SCRIPT:
                self.index_reads+=1; answer=next(queue)
                if isinstance(answer, BaseException): raise answer
                return answer
            self.exports+=1; return source
        return call
    def retrying_refresh(self, answers, source=SOURCE, clock=None):
        def sleep(seconds):
            # The wait happens outside the refresh lock: another OS-1 run can refresh meanwhile.
            with open(self.root/'sync.lock','a') as other:
                m.fcntl.flock(other, m.fcntl.LOCK_EX|m.fcntl.LOCK_NB); m.fcntl.flock(other, m.fcntl.LOCK_UN)
            self.sleeps.append(seconds)
        return m.refresh(self.root, self.notes(answers, source), m.time.time, sleep=sleep,
                         clock=clock or (lambda: 0.0), report=self.reports.append)
    def test_transient_notes_failure_retries_once_then_certifies(self):
        for error in [APPLE_EVENT_TIMEOUT, NOT_RUNNING, CONNECTION_INVALID, subprocess.TimeoutExpired('osascript', 20)]:
            self.capture(); record=json.loads((self.root/'active.json').read_text())
            result=self.retrying_refresh([error, INDEX])
            self.assertEqual((self.sleeps, self.index_reads, self.exports), ([15], 2, 0))
            self.assertEqual(result['sourceSHA256'], record['sourceSHA256'])
            self.assertEqual(len(self.reports), 1)
            self.assertIn('retrying once', self.reports[0])
    def test_transient_failure_before_first_capture_retries(self):
        result=self.retrying_refresh([APPLE_EVENT_TIMEOUT, INDEX, INDEX])
        self.assertEqual((self.sleeps, self.index_reads, self.exports), ([15], 3, 1))
        self.assertEqual(result['sourceSHA256'], m.sha(SOURCE+'\n'))
    def test_integrity_failure_is_never_retried(self):
        self.capture(); p=self.root/'active.json'; before=p.read_bytes()
        newer=INDEX.replace('100','101')
        cases=[([INDEX+'\nx-coredata://other\t100'], ValueError),                  # tie
               ([newer, INDEX.replace('100','102')], ValueError),                   # note changed during capture
               ([AUTOMATION_DENIED], subprocess.CalledProcessError),                # permission, not transient
               ([INDEX_CHANGED_DURING_READ], subprocess.CalledProcessError)]        # bulk-read race
        for answers, error in cases:
            with self.assertRaises(error): self.retrying_refresh(answers)
            self.assertEqual((self.sleeps, p.read_bytes()), ([], before))
        with self.assertRaises(SystemExit):
            self.retrying_refresh([newer, newer], SOURCE.replace(ANCHORS[-1], 'REMOVED'))
        self.assertEqual((self.sleeps, p.read_bytes()), ([], before))
        record=json.loads(before); (self.root/record['sourceFile']).write_text('tampered')
        with self.assertRaises(ValueError): self.retrying_refresh([APPLE_EVENT_TIMEOUT, INDEX])
        self.assertEqual((self.sleeps, self.index_reads, p.read_bytes()), ([], 0, before))
    def test_second_transient_failure_fails_closed(self):
        self.capture(); p=self.root/'active.json'; before=p.read_bytes()
        with self.assertRaises(subprocess.CalledProcessError):
            self.retrying_refresh([APPLE_EVENT_TIMEOUT, APPLE_EVENT_TIMEOUT, INDEX])
        self.assertEqual((self.sleeps, self.index_reads, p.read_bytes()), ([15], 2, before))
        with self.assertRaises(subprocess.CalledProcessError) as raised:
            self.retrying_refresh([subprocess.TimeoutExpired('osascript', 20), APPLE_EVENT_TIMEOUT, INDEX])
        self.assertIn('retried once', m.failure_message(raised.exception, raised.exception.os1_retried))
        self.assertEqual((self.sleeps, self.index_reads, p.read_bytes()), ([15], 2, before))
    def test_retry_stays_inside_the_refresh_budget(self):
        self.capture(); p=self.root/'active.json'; before=p.read_bytes()
        ticks=[0.0, m.REFRESH_BUDGET_SECONDS-m.RETRY_DELAY_SECONDS-m.OSA_TIMEOUT_SECONDS+1]
        clock=lambda: ticks.pop(0) if len(ticks)>1 else ticks[0]
        with self.assertRaises(subprocess.CalledProcessError): self.retrying_refresh([APPLE_EVENT_TIMEOUT, INDEX], clock=clock)
        self.assertEqual((self.sleeps, p.read_bytes()), ([], before))
        # The Swift caller outlasts the helper's own hard limit, so the helper decides.
        swift=(pathlib.Path(__file__).resolve().parent.parent/'Sources/OS1Context/OwnerPolicy.swift').read_text()
        caller=int(re.search(r'helperTimeoutSeconds = (\d+)', swift).group(1))
        self.assertGreaterEqual(caller, m.REFRESH_BUDGET_SECONDS+10)
    def test_each_notes_query_is_capped_by_the_remaining_budget(self):
        seen=[]
        def run(text, timeout): seen.append(timeout); return 'ok'
        self.assertEqual(m.bounded_osa(100.0, lambda: 90.0, run)('script'), 'ok')
        self.assertEqual(m.bounded_osa(100.0, lambda: 10.0, run)('script'), 'ok')
        self.assertEqual(seen, [10.0, m.OSA_TIMEOUT_SECONDS])
        with self.assertRaises(subprocess.TimeoutExpired): m.bounded_osa(100.0, lambda: 99.5, run)('script')
        self.assertEqual(len(seen), 2)
    def test_failure_message_names_the_cause_without_policy_text(self):
        message=m.failure_message(APPLE_EVENT_TIMEOUT, retried=True)
        self.assertIn('AppleEvent timed out. (-1712)', message); self.assertIn('retried once', message)
        self.assertIn('existing snapshot retained', message)
        long=subprocess.CalledProcessError(1, ['/usr/bin/osascript'], output=SOURCE, stderr='x'*5000+'\n'+SOURCE[:3000])
        for error in [long, ValueError('Canonical note tie requires resolution'), OSError(2, 'No such file'),
                      subprocess.TimeoutExpired('osascript', 20)]:
            text=m.failure_message(error, retried=False)
            self.assertLessEqual(len(text), 400); self.assertNotIn('\n', text)
            self.assertNotIn('fixture rule', text); self.assertNotIn('retried once', text)
        self.assertIn('Canonical note tie requires resolution', m.failure_message(ValueError('Canonical note tie requires resolution'), retried=False))
APPLE_EVENT_TIMEOUT=subprocess.CalledProcessError(1, ['/usr/bin/osascript'], output='',
    stderr='35:120: execution error: Notes got an error: AppleEvent timed out. (-1712)\n')
NOT_RUNNING=subprocess.CalledProcessError(1, ['/usr/bin/osascript'], output='',
    stderr='execution error: Notes got an error: Application isn’t running. (-600)\n')
CONNECTION_INVALID=subprocess.CalledProcessError(1, ['/usr/bin/osascript'], output='',
    stderr='execution error: Notes got an error: Connection is invalid. (-609)\n')
AUTOMATION_DENIED=subprocess.CalledProcessError(1, ['/usr/bin/osascript'], output='',
    stderr='execution error: Not authorized to send Apple events to Notes. (-1743)\n')
INDEX_CHANGED_DURING_READ=subprocess.CalledProcessError(1, ['/usr/bin/osascript'], output='',
    stderr='execution error: Canonical index changed during bulk read (-2700)\n')
if __name__=='__main__': unittest.main()
