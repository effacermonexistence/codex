"""Deterministic GRP decoding, not a generated approximation of unit animation.
Downloads must be supplied separately; no game credentials or local installation read.
Usage: python3 tools/extract-classic-sprites.py /tmp/os1-scv-src public
"""
from pathlib import Path
from PIL import Image
import sys, struct, json, hashlib
src,out=map(Path,sys.argv[1:]);out.mkdir(parents=True,exist_ok=True)
commit='997130ec718841ef74e0aafe29a193aa66bec975'
palette=(src/'jungle.wpe').read_bytes()
def frames(name):
 b=(src/f'{name}.grp').read_bytes(); count,w,h=struct.unpack_from('<HHH',b);result=[]
 for f in range(count):
  x,y,fw,fh,ptr=struct.unpack_from('<BBBBI',b,6+f*8); pixels=[]
  for row in range(fh):
   p=ptr+struct.unpack_from('<H',b,ptr+row*2)[0]; col=0
   while col<fw:
    token=b[p];p+=1
    if token&128: col+=token&127;continue
    n=token&63 if token&64 else token
    colors=[b[p]]*n if token&64 else b[p:p+n];p+=1 if token&64 else n
    for color in colors:
     if col>=fw: raise ValueError('GRP row overflow')
     pixels.append((x+col,y+row,color));col+=1
  result.append(pixels)
 return count,w,h,result
def atlas(name,filename,columns,part='all'):
 n,w,h,decoded=frames(name);im=Image.new('RGBA',(w*columns,h*((n+columns-1)//columns)))
 for i,pixels in enumerate(decoded):
  for x,y,index in pixels:
   team=8<=index<=15
   if part=='body' and team or part=='team' and not team:continue
   rgb=tuple(palette[index*4:index*4+3])
   if part=='team':
    # Neutral ramp; the runtime multiplies the chosen accent into this layer.
    # Team indices are isolated; metal, glass and cargo are not hue shifted.
    shade=[90,110,130,150,175,205,225,245][index-8];rgb=(shade,)*3
   im.putpixel((i%columns*w+x,i//columns*h+y),rgb+(255,))
 im.save(out/filename)
 return {'image':filename,'frames':n,'frameWidth':w,'frameHeight':h,'columns':columns,'sha256':hashlib.sha256((out/filename).read_bytes()).hexdigest()}
meta={'format':'os1-classic-animation-atlas-v1','sourceRepository':'https://github.com/dada78641/bwmapgfx','sourceCommit':commit,'sourceFiles':{},'scvBody':atlas('scv','scv-body.png',17,'body'),'scvTeam':atlas('scv','scv-team.png',17,'team'),'probeBody':atlas('probe','probe-body.png',17,'body'),'probeTeam':atlas('probe','probe-team.png',17,'team'),'spark':atlas('scvspark','scv-spark.png',10),'minerals':[atlas(f'min0{i}',f'mineral-{i}.png',4) for i in range(1,4)],'scvAnimation':{'directions':17,'poses':3,'mirroredWest':True,'frameOrder':'pose * 17 + half-circle direction','purpose':'locomotion / drill pose cycling, never token accounting'}}
for name in ['scv','probe','scvspark','min01','min02','min03']:
 folder='terran' if name=='scv' else 'protoss' if name=='probe' else 'bullet' if name=='scvspark' else 'neutral';p=src/f'{name}.grp';meta['sourceFiles'][name]={'url':f'https://raw.githubusercontent.com/dada78641/bwmapgfx/{commit}/resources/unit/{folder}/{name}.grp','sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size}
meta['sourceFiles']['palette']={'url':f'https://raw.githubusercontent.com/dada78641/bwmapgfx/{commit}/resources/tileset/jungle.wpe','sha256':hashlib.sha256(palette).hexdigest(),'bytes':len(palette)}
(out/'classic-sprites.json').write_text(json.dumps(meta,indent=2)+'\n')
print(json.dumps(meta,indent=2))
