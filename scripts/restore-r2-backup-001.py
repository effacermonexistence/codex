#!/usr/bin/env python3
"""Restore R2 BACKUP #1 into a NEW local directory; never deploy or overwrite it."""
import argparse,pathlib,json,hashlib,subprocess,tarfile,shutil,sys,concurrent.futures
MANIFEST_KEY='effacer-site/r2-backup-001/20261110T005519Z-477f5fec62/manifest.json'
MANIFEST_SHA='2dcca12f6439bca3522c5e6ff550108ca69f21cb5df5b365e23ecd51bb4d66e1'
COMMIT='759e3ea5c98b9bee9fd58bdaba02a9673e113b6c'
BUCKET='omar-private-archive'
a=argparse.ArgumentParser(description=__doc__);a.add_argument('--destination',required=True);a.add_argument('--cache',required=True);a.add_argument('--wrangler-project',default='/Users/lua/Documents/Codex/codex');args=a.parse_args()
dest=pathlib.Path(args.destination).expanduser().resolve();cache=pathlib.Path(args.cache).expanduser().resolve()
if dest.exists():raise SystemExit('Refusing existing destination: '+str(dest))
cache.mkdir(parents=True,exist_ok=True)
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1024*1024):h.update(b)
 return h.hexdigest()
def get(key,p,expected):
 if p.is_file() and sha(p)==expected:return
 for attempt in range(3):
  r=subprocess.run(['pnpm','exec','wrangler','r2','object','get',BUCKET+'/'+key,'--remote','--file',str(p)],cwd=args.wrangler_project,capture_output=True,timeout=180)
  if r.returncode==0 and p.exists() and sha(p)==expected:return
 raise RuntimeError('Could not verify '+key)
manifest=cache/'manifest.json';get(MANIFEST_KEY,manifest,MANIFEST_SHA);m=json.loads(manifest.read_text());assert m['git']['commit']==COMMIT and m['label']=='R2 BACKUP #1'
inventory=cache/'production-files.json';get(m['sourceInventory']['key'],inventory,m['sourceInventory']['sha256'])
def fetch_part(p):
 f=cache/p['file'];get(p['key'],f,p['sha256']);assert f.stat().st_size==p['bytes'];return f
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:parts=list(pool.map(fetch_part,m['parts']))
archive=cache/'restore.tar.gz'
with archive.open('wb') as out:
 for f in parts:
  with f.open('rb') as src:shutil.copyfileobj(src,out)
assert archive.stat().st_size==m['production']['archiveBytes'] and sha(archive)==m['production']['archiveSha256']
with tarfile.open(archive,'r:gz') as t:
 for x in t.getmembers():
  p=pathlib.PurePosixPath(x.name);assert not p.is_absolute() and '..' not in p.parts and (x.isfile() or x.isdir())
 dest.mkdir();t.extractall(dest)
expected={x['path']:x for x in json.loads(inventory.read_text())['files']};found={str(f.relative_to(dest)):f for f in dest.rglob('*') if f.is_file()};assert set(found)==set(expected)
for name,f in found.items():assert f.stat().st_size==expected[name]['bytes'] and sha(f)==expected[name]['sha256'] and f.stat().st_mode&511==expected[name]['mode'],name
print(json.dumps({'restored':str(dest),'filesVerified':len(found),'backupCommit':COMMIT,'manifestSha256':MANIFEST_SHA,'deployed':False},indent=2))
