#!/usr/bin/env python3
"""Deterministic source-acquisition regressions. No Notes, network, or model calls."""
import importlib.util, json, pathlib, subprocess, tempfile, unittest
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
if __name__=='__main__': unittest.main()
