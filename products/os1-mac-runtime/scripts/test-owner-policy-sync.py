#!/usr/bin/env python3
"""Deterministic source-acquisition regressions. No Notes, network, or model calls."""
import importlib.util, json, pathlib, tempfile, unittest
spec=importlib.util.spec_from_file_location('policy_sync', pathlib.Path(__file__).with_name('sync-owner-policy.py'))
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ANCHORS=['CORE OPERATION','PART 1 — RCC CORE LAWS','PART 22A — MEMORY RECALL / PROVENANCE HARD GATE',
         'PART 1C — RCC FOUNDATIONAL BOUNDARY THEORY','UNKNOWN STATE PRESERVATION /',
         'LOCAL FRAME PRIORITY /','STRATEGIC DECISION RANKING STABILITY /']
SOURCE='REVAS\n'+'\n'.join(a+'\n'+('fixture rule\n'*155) for a in ANCHORS)
INDEX='x-coredata://fixture/ICNote/p1\t100'
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
if __name__=='__main__': unittest.main()
