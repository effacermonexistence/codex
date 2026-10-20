#!/usr/bin/env python3
"""Offline exact-token scanner regression for an unrelated dirty source tree."""

from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
GENERATOR = HERE / "generate-client-scan-policy.py"
spec = importlib.util.spec_from_file_location("os1_client_scan_policy", GENERATOR)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def git(root: Path, *arguments: str) -> str:
    return subprocess.check_output(["git", "-C", str(root), *arguments], text=True).strip()


with tempfile.TemporaryDirectory(prefix="os1-public-lock-policy-") as directory:
    root = Path(directory) / "source"
    root.mkdir()
    git(root, "init", "-q")
    git(root, "config", "user.name", "OS1 Fixture")
    git(root, "config", "user.email", "fixture@example.invalid")
    app_resources = root / module.RESOURCE_PREFIX
    app_resources.mkdir(parents=True)
    setup_path = root / module.SETUP_RELATIVE
    setup_path.parent.mkdir(parents=True)
    for name in module.RESOURCE_NAMES:
        shutil.copyfile(REPO / module.RESOURCE_PREFIX / name, app_resources / name)
    shutil.copyfile(REPO / module.SETUP_RELATIVE, setup_path)
    git(root, "add", ".")
    git(root, "commit", "-qm", "exact public pin fixture")
    commit = git(root, "rev-parse", "HEAD")

    expanded = Path(directory) / "expanded"
    packaged = expanded / module.INSTALLED_PREFIX
    packaged.mkdir(parents=True)
    for name in module.RESOURCE_NAMES:
        shutil.copyfile(app_resources / name, packaged / name)
    shutil.copyfile(setup_path, packaged / setup_path.name)
    policy_path = Path(directory) / "policy.json"
    output_path = Path(directory) / "source-bound.json"
    policy_path.write_text(json.dumps({
        "forbiddenPathFragments": [],
        "forbiddenContentFragments": [],
        "entropy": {"minimumLength": 48, "minimumBitsPerCharacter": 4.7,
                    "allowedTokenSha256": []},
    }))

    # An unrelated untracked file makes the tree dirty. Public source files
    # are nevertheless byte-identical to the committed and packaged files.
    (root / "unrelated-generated-output.txt").write_text("not release source")
    assert git(root, "status", "--porcelain=v1")
    result = module.generate(policy_path, output_path, commit, False, root, expanded)
    lock = json.loads((app_resources / module.RESOURCE_NAMES[0]).read_bytes())
    top = lock["packages"]["node_modules/openclaw"]["integrity"]
    fingerprint = hashlib.sha256(top.encode()).hexdigest()
    assert fingerprint in result["entropy"]["allowedTokenSha256"]
    assert result["publicTokenProvenance"][fingerprint]["tokenKind"] == "public_npm_sha512_integrity"
    assert hashlib.sha256(commit.encode()).hexdigest() not in result["entropy"]["allowedTokenSha256"]
    scanned = subprocess.check_output([
        "node", str(REPO / "products/os1-route-core/scripts/client-artifact-scan.mjs"),
        str(packaged / module.RESOURCE_NAMES[0]),
        str(packaged / module.RESOURCE_NAMES[1]),
        str(packaged / setup_path.name),
    ], env={**__import__("os").environ, "OS1_CLIENT_SCAN_POLICY_PATH": str(output_path)}, text=True)
    assert json.loads(scanned)["findings"] == []

    # A changed working lock or changed packaged lock may not inherit the
    # committed public-token exception. This is not a generic entropy bypass.
    lock_path = app_resources / module.RESOURCE_NAMES[0]
    original = lock_path.read_bytes()
    lock_path.write_bytes(original + b" ")
    try:
        module.generate(policy_path, output_path, commit, False, root, expanded)
        raise AssertionError("mutated working lock unexpectedly accepted")
    except ValueError as error:
        assert "differs from commit" in str(error)
    lock_path.write_bytes(original)
    packaged_lock = packaged / module.RESOURCE_NAMES[0]
    packaged_lock.write_bytes(original + b" ")
    try:
        module.generate(policy_path, output_path, commit, False, root, expanded)
        raise AssertionError("mutated packaged lock unexpectedly accepted")
    except ValueError as error:
        assert "Packaged public scan source differs" in str(error)

print("Public npm scan policy: unrelated dirty source accepted only for exact committed and packaged lock bytes; tampering rejected")

# Clean-build diagnostic paths follow the exact registered public source,
# rather than one machine's absolute checkout name. Negative fixtures still
# inspect both universal slices with the unchanged canonical scanner.
import base64, copy, pathlib, struct, unittest
M = module
BASE=json.loads((REPO/'products/os1-route-core/security/client-artifact-scan-policy.json').read_text())
REG='bab36416d7f32a22778d82ce3a81b860644a30e8b80180f69695429177225c23'
REL='products/os1-mac-runtime/Sources/OS1/ConsumerChatGPTTransport.swift'
SCANNER=REPO/'products/os1-route-core/scripts/client-artifact-scan.mjs'
def sha(b):return hashlib.sha256(b).hexdigest()
def git(r,*args):return subprocess.check_output(['git','-C',str(r),*args],text=True,stderr=subprocess.DEVNULL).strip()
def thin(value):
 data=value+b'\0';h=bytearray(184);struct.pack_into('<I',h,0,0xfeedfacf);struct.pack_into('<I',h,16,1);struct.pack_into('<II',h,32,0x19,152);struct.pack_into('<I',h,96,1);h[104:113]=b'__cstring';h[120:126]=b'__TEXT';struct.pack_into('<Q',h,144,len(data));struct.pack_into('<I',h,152,len(h));return bytes(h)+data
def fat(values):
 h=bytearray(8+20*len(values));struct.pack_into('>II',h,0,0xcafebabe,len(values));out=bytearray(h)
 for i,v in enumerate(values):
  off=((len(out)+4095)//4096)*4096;out.extend(bytes(off-len(out)));sl=thin(v);struct.pack_into('>IIIII',out,8+20*i,0x1000007 if i==0 else 0x100000c,3,off,len(sl),12);out.extend(sl)
 return bytes(out)
class Relocation(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='os1-scan-relocation-');self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name).resolve()/'public-source-checkout';self.root.mkdir();self.source=self.root/REL;self.source.parent.mkdir(parents=True);self.source.write_bytes((REPO/REL).read_bytes());self.expanded=pathlib.Path(self.tmp.name).resolve()/'expanded';packaged=self.expanded/M.INSTALLED_PREFIX;packaged.mkdir(parents=True)
  for name in M.RESOURCE_NAMES:
   target=self.root/M.RESOURCE_PREFIX/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((REPO/M.RESOURCE_PREFIX/name).read_bytes());(packaged/name).write_bytes(target.read_bytes())
  setup=self.root/M.SETUP_RELATIVE;setup.parent.mkdir(parents=True,exist_ok=True);setup.write_bytes((REPO/M.SETUP_RELATIVE).read_bytes());(packaged/setup.name).write_bytes(setup.read_bytes());git(self.root,'init','-q');git(self.root,'config','user.name','fixture');git(self.root,'config','user.email','fixture@example.invalid');git(self.root,'add','.');git(self.root,'commit','-qm','fixture public source');self.commit=git(self.root,'rev-parse','HEAD');self.token=str(self.source.with_suffix('')).encode();self.fingerprint=sha(self.token)
 def policy(self):return {'forbiddenPathFragments':[],'forbiddenContentFragments':['private routing prompt'],'entropy':{'minimumLength':48,'minimumBitsPerCharacter':4.7,'allowedTokenSha256':[REG]},'publicTokenProvenance':{REG:copy.deepcopy(BASE['publicTokenProvenance'][REG])}}
 def scan(self,values,p):
  f=self.root/'fixture.bin';f.write_bytes(fat(values));policy=self.root/'policy.json';policy.write_text(json.dumps(p));code="import{scanClientArtifacts,loadPolicy}from"+json.dumps(SCANNER.as_uri())+";let r=await scanClientArtifacts([process.argv[1]],await loadPolicy(process.argv[2]));process.stdout.write(JSON.stringify(r));";return json.loads(subprocess.check_output(['node','--input-type=module','-e',code,str(f),str(policy)],text=True))
 def prepared(self):
  p=self.policy();self.assertEqual(M.add_relocated_diagnostic_source_paths(p,self.root,self.commit),1);return p
 def test_exact_source_bound_token_both_slices(self):
  p=self.prepared();self.assertEqual(self.scan([self.token+b'.swift']*2,p)['findings'],[]);self.assertEqual(p['entropy']['minimumBitsPerCharacter'],4.7);self.assertEqual(p['entropy']['minimumLength'],48)
 def test_altered_path_each_architecture_still_detected(self):
  p=self.prepared();bad=self.token[:-1]+b'X'
  for values in [[bad+b'.swift',self.token+b'.swift'],[self.token+b'.swift',bad+b'.swift']]:self.assertTrue(any(x['fingerprint']==sha(bad) for x in self.scan(values,p)['findings']))
 def test_adjacent_synthetic_secret_same_section_detected(self):
  p=self.prepared();secret=base64.b64encode(hashlib.sha512(b'explicitly synthetic noncredential scanner regression').digest());find=self.scan([self.token+b'.swift '+secret,self.token+b'.swift'],p)['findings'];self.assertTrue(any(x['fingerprint']==sha(secret) for x in find))
 def test_appended_synthetic_entropy_not_exempt(self):
  p=self.prepared();bad=self.token+b'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnop';self.assertTrue(any(x['fingerprint']==sha(bad) for x in self.scan([bad+b'.swift',self.token+b'.swift'],p)['findings']))
 def test_forbidden_content_still_detected(self):
  p=self.prepared();self.assertTrue(any(x['kind']=='forbidden_content' for x in self.scan([self.token+b'.swift private routing prompt',self.token+b'.swift'],p)['findings']))
 def test_uncommitted_source_gets_no_exception(self):
  p=self.policy();self.source.write_bytes(self.source.read_bytes()+b'\n');self.assertEqual(M.add_relocated_diagnostic_source_paths(p,self.root,self.commit),0);self.assertNotIn(self.fingerprint,p['entropy']['allowedTokenSha256'])
 def test_new_commit_changed_source_gets_no_exception(self):
  p=self.policy();self.source.write_bytes(self.source.read_bytes()+b'\n');git(self.root,'add','.');git(self.root,'commit','-qm','changed');self.assertEqual(M.add_relocated_diagnostic_source_paths(p,self.root,git(self.root,'rev-parse','HEAD')),0)
 def test_forged_registered_token_hash_rejected(self):
  p=self.policy();p['publicTokenProvenance'][REG]['publicToken']+='X'
  with self.assertRaises(ValueError):M.add_relocated_diagnostic_source_paths(p,self.root,self.commit)
 def test_registered_traversal_rejected(self):
  p=self.policy();p['publicTokenProvenance'][REG]['source']='../outside.swift'
  with self.assertRaises(ValueError):M.add_relocated_diagnostic_source_paths(p,self.root,self.commit)
 def test_stale_independent_row_does_not_validate_or_block_other_row(self):
  p=self.policy();bad=copy.deepcopy(p['publicTokenProvenance'][REG]);bad['sourceSHA256']='0'*64;p['publicTokenProvenance']['9e6f24e5038f815a68210f01a6ec546e7fd045d442247cff85c43f40daadf6ab']=copy.deepcopy(BASE['publicTokenProvenance']['9e6f24e5038f815a68210f01a6ec546e7fd045d442247cff85c43f40daadf6ab']);p['entropy']['allowedTokenSha256'].append('9e6f24e5038f815a68210f01a6ec546e7fd045d442247cff85c43f40daadf6ab');p['publicTokenProvenance'][REG]=bad;self.assertEqual(M.add_relocated_diagnostic_source_paths(p,self.root,self.commit),1)
 def test_without_approved_registration_no_new_exception(self):
  p=self.policy();p['publicTokenProvenance']={};self.assertEqual(M.add_relocated_diagnostic_source_paths(p,self.root,self.commit),0);self.assertNotIn(self.fingerprint,p['entropy']['allowedTokenSha256'])
 def test_dirty_build_never_gets_relocated_token(self):
  policy=self.root/'input-policy.json';policy.write_text(json.dumps(self.policy()));out=self.root/'dirty-source-policy.json';p=M.generate(policy,out,self.commit,False,self.root,self.expanded);self.assertNotIn(self.fingerprint,p['entropy']['allowedTokenSha256'])
 def test_space_root_skips_registration_and_preserves_scanning(self):
  self.root.rename(self.root.with_name(self.root.name+' with space'));self.root=self.root.with_name(self.root.name+' with space');self.source=self.root/REL;self.token=str(self.source.with_suffix('')).encode();p=self.policy();self.assertEqual(M.add_relocated_diagnostic_source_paths(p,self.root,self.commit),0);self.assertNotIn(sha(self.token),p['entropy']['allowedTokenSha256']);secret=base64.b64encode(hashlib.sha512(b'space-root synthetic noncredential').digest());self.assertTrue(any(x['fingerprint']==sha(secret) for x in self.scan([self.token+b'.swift '+secret],p)['findings']))
 def test_nonascii_root_skips_registration_and_preserves_scanning(self):
  self.root.rename(self.root.with_name(self.root.name+'-테스트'));self.root=self.root.with_name(self.root.name+'-테스트');self.source=self.root/REL;self.token=str(self.source.with_suffix('')).encode();p=self.policy();self.assertEqual(M.add_relocated_diagnostic_source_paths(p,self.root,self.commit),0);self.assertNotIn(sha(self.token),p['entropy']['allowedTokenSha256']);secret=base64.b64encode(hashlib.sha512(b'unicode-root synthetic noncredential').digest());self.assertTrue(any(x['fingerprint']==sha(secret) for x in self.scan([self.token+b'.swift '+secret],p)['findings']))
if __name__=='__main__':unittest.main(verbosity=2)
