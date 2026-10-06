#!/usr/bin/env python3
"""Standard-library-only archive validation and full-file USUNG inventory."""
import sys, os, json, hashlib, tarfile, shutil, stat
from pathlib import Path, PurePosixPath

def safe_name(name):
    if '\\' in name or '\n' in name or '\r' in name: raise ValueError('Invalid archive path')
    p=PurePosixPath(name)
    if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0]!='usung-corporate': raise ValueError('Archive escaped product root')
    deny={'.git','.wrangler','.railway','.codex','node_modules','.npmrc','.netrc','id_rsa','id_ed25519','credentials.json','oauth.json','auth.json'}
    for part in p.parts:
        if part in deny or part.startswith('.env') or part.startswith('.dev.vars'): raise ValueError('Excluded env/auth path: '+name)
    return p

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()

def inventory(root):
    root=Path(root); product=root/'usung-corporate'
    if not product.is_dir() or product.is_symlink(): raise ValueError('Missing regular product directory')
    result=[]
    for p in sorted(product.rglob('*')):
        rel=p.relative_to(root).as_posix(); safe_name(rel); s=p.lstat()
        if stat.S_ISDIR(s.st_mode): continue
        if not stat.S_ISREG(s.st_mode): raise ValueError('Nonregular product file: '+rel)
        result.append({'path':rel,'bytes':s.st_size,'sha256':sha(p),'mode':format(stat.S_IMODE(s.st_mode),'04o')})
    return result

def extract(archive,destination):
    dst=Path(destination)
    if dst.exists() and any(dst.iterdir()): raise ValueError('Extraction target must be empty')
    dst.mkdir(parents=True,exist_ok=True)
    with tarfile.open(archive,'r:gz') as t:
        members=t.getmembers(); seen=set(); total=0
        if len(members)>50000: raise ValueError('Too many archive entries')
        for m in members:
            p=safe_name(m.name)
            if str(p) in seen: raise ValueError('Duplicate archive path')
            seen.add(str(p))
            if not (m.isfile() or m.isdir()): raise ValueError('Links/devices/special entries forbidden')
            if m.size<0: raise ValueError('Invalid file size')
            total+=m.size
        if total>2*1024**3: raise ValueError('Archive exceeds bounded product size')
        for m in members:
            target=dst.joinpath(*safe_name(m.name).parts)
            if m.isdir(): target.mkdir(parents=True,exist_ok=True); continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with t.extractfile(m) as src, target.open('xb') as out: shutil.copyfileobj(src,out,1024*1024)
            target.chmod(m.mode&0o777)
    return inventory(dst)

command=sys.argv[1]
if command=='extract': value=extract(sys.argv[2],sys.argv[3])
elif command=='inventory': value=inventory(sys.argv[2])
elif command=='verify':
    expected=json.loads(Path(sys.argv[3]).read_text())['files']; actual=inventory(sys.argv[2])
    if actual!=expected:
        ex={x['path']:x for x in expected}; ac={x['path']:x for x in actual}
        differences=[p for p in sorted(set(ex)|set(ac)) if ex.get(p)!=ac.get(p)]
        raise ValueError('Full-file inventory mismatch: '+', '.join(differences[:20]))
    value={'filesVerified':len(actual),'allFileBytesModesSHA256Match':True}
else: raise ValueError('Unknown helper command')
print(json.dumps(value,sort_keys=True,separators=(',',':')))
