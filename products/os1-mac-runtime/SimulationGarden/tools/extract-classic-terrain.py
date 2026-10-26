"""Decode compatible SC1 jungle grass megatiles directly from VX4/VR4 + WPE.
Usage: python3 tools/extract-classic-terrain.py /tmp/os1-scv-src public
No screenshot tiling, synthesis, private installation, or game credential access.
"""
from pathlib import Path
from PIL import Image
import struct,hashlib,json,sys
src,out=map(Path,sys.argv[1:]);commit='997130ec718841ef74e0aafe29a193aa66bec975'
vr=(src/'jungle.vr4').read_bytes();vx=(src/'jungle.vx4').read_bytes();pal=(src/'jungle.wpe').read_bytes();cv=(src/'jungle.cv5').read_bytes()
ids=list(dict.fromkeys(n for g in [8,9] for n in struct.unpack_from('<16H',cv,g*52+20) if n))
columns=8;im=Image.new('RGBA',(columns*32,((len(ids)+columns-1)//columns)*32))
for i,tile in enumerate(ids):
 refs=struct.unpack_from('<16H',vx,tile*32)
 for q,ref in enumerate(refs):
  index,flip=ref>>1,ref&1
  for y in range(8):
   for x in range(8):
    color=vr[index*64+y*8+(7-x if flip else x)];im.putpixel((i%columns*32+q%4*8+x,i//columns*32+q//4*8+y),tuple(pal[color*4:color*4+3])+(255,))
im.save(out/'classic-terrain.png');meta={'format':'sc1-megatile-atlas-v1','sourceRepository':'https://github.com/dada78641/bwmapgfx','sourceCommit':commit,'groupIDs':[8,9],'tileIDs':ids,'tileSize':32,'columns':columns,'frames':len(ids),'image':'classic-terrain.png','imageSHA256':hashlib.sha256((out/'classic-terrain.png').read_bytes()).hexdigest(),'sourceFiles':{}}
for ext in ['cv5','vx4','vr4','wpe']:
 b=(src/('jungle.'+ext)).read_bytes();meta['sourceFiles'][ext]={'url':f'https://raw.githubusercontent.com/dada78641/bwmapgfx/{commit}/resources/tileset/jungle.{ext}','bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
(out/'classic-terrain.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta))
