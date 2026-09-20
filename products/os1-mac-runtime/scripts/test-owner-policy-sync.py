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
    def capture(self, indexes=None, source=SOURCE):
        answers=iter(indexes or [INDEX,INDEX]); self.exports=0
        def call(script):
            if script==m.INDEX_SCRIPT: return next(answers)
            self.exports+=1; return source
        return m.refresh(self.root,call)
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
    def test_newer_note_during_cache_preserves_pointer(self):
        self.capture(); before=(self.root/'active.json').read_bytes()
        with self.assertRaises(ValueError): self.capture([INDEX, INDEX+'\nx-coredata://other\t101'])
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
