"""Render readable tattoo loops from pinned photos over their existing recursion.
Requires Pillow/numpy and an ffmpeg executable; not invoked by the website build.
"""
from pathlib import Path
import argparse,math,json,hashlib,subprocess,concurrent.futures,time
import numpy as np
from PIL import Image,ImageOps,ImageFilter
ROOT=Path(__file__).resolve().parents[1]
MANIFEST=json.loads((ROOT/'content/tattoo-motion/manifest.json').read_text())
WORKS={w['id']:w for w in json.loads((ROOT/'content/continuous-render/works.json').read_text())['works']}
FRAMES=432;FPS=24
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def plate(work,width,height,fmt):
 source=ROOT/'site/s'/WORKS[work['id']]['image']['file'];assert sha(source)==work['sourceSha256']
 image=Image.open(source).convert('RGB');maxw=round(width*.94);maxh=round(height*.94)
 image=ImageOps.contain(image,(maxw,maxh),Image.Resampling.LANCZOS);w,h=image.size;padding=round(min(w,h)*.07)
 rgb=np.pad(np.asarray(image),((padding,padding),(padding,padding),(0,0)),mode='edge')
 yy,xx=np.mgrid[:rgb.shape[0],:rgb.shape[1]];dx=np.maximum(np.maximum(padding-xx,xx-(padding+w-1)),0);dy=np.maximum(np.maximum(padding-yy,yy-(padding+h-1)),0)
 u=np.clip(1-np.hypot(dx,dy)/max(1,padding),0,1);alpha=np.rint(255*u*u*(3-2*u)).astype('uint8')
 rgba=Image.fromarray(np.dstack([rgb,alpha]),'RGBA');margin=round(max(width,height)*.008)+4
 return rgba,margin,{'x':(width-w)/2,'y':(height-h)/2,'width':w,'height':h,'alphaCoreMin':.915,'alphaCoreMax':.945,'recursiveMix':.12,'minimumOriginalContribution':.8052,'sourceAspectPreserved':True,'rigidScaleAmplitude':.008,'nonrigidWarp':False}
def compose(background,rgba,margin,index):
 height,width=background.shape[:2];phase=2*math.pi*index/FRAMES;scale=1+.008*math.sin(phase)
 tw,th=rgba.size;ow,oh=tw+2*margin,th+2*margin;sx=width*.003*math.sin(phase);sy=height*.002*math.sin(phase*2)
 cx,cy=tw/2,th/2;matrix=(1/scale,0,cx-(cx+margin+sx)/scale,0,1/scale,cy-(cy+margin+sy)/scale)
 fg=rgba.transform((ow,oh),Image.Transform.AFFINE,matrix,Image.Resampling.BICUBIC,fillcolor=(0,0,0,0));a=np.asarray(fg);alpha=(a[:,:,3:4].astype('float32')/255)*(.93+.015*math.sin(phase+.6))
 x=(width-ow)//2;y=(height-oh)//2;x0=max(0,x);y0=max(0,y);x1=min(width,x+ow);y1=min(height,y+oh);fg=a[y0-y:y1-y,x0-x:x1-x,:3];alpha=alpha[y0-y:y1-y,x0-x:x1-x];patch=background[y0:y1,x0:x1].astype('float32');background[y0:y1,x0:x1]=np.rint(fg*alpha+patch*(1-alpha)).astype('uint8');return background

def background(work,width,height):
 source=ROOT/'site/s'/WORKS[work['id']]['image']['file'];image=Image.open(source).convert('RGB')
 return np.asarray(ImageOps.fit(image,(width,height),Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(max(18,min(width,height)*.045)))).copy()

def render(work,fmt,ffmpeg,out):
 t=time.time();old=work[fmt];source=ROOT/'site/s'/old['file'];assert sha(source)==old['sha256'];width,height=old['width'],old['height'];rgba,margin,bounds=plate(work,width,height,fmt);ambient=background(work,width,height)
 temp=out/(work['id']+'-'+fmt+'.mp4');log=out/(work['id']+'-'+fmt+'.log')
 with log.open('wb') as error:
  decoder=subprocess.Popen([ffmpeg,'-hide_banner','-loglevel','error','-threads','1','-i',str(source),'-f','rawvideo','-pix_fmt','rgb24','-threads','1','-'],stdout=subprocess.PIPE,stderr=error)
  encoder=subprocess.Popen([ffmpeg,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',str(width)+'x'+str(height),'-framerate',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-threads','2','-movflags','+faststart',str(temp)],stdin=subprocess.PIPE,stderr=error)
  try:
   for i in range(FRAMES):
    buf=decoder.stdout.read(width*height*3);assert len(buf)==width*height*3,(work['id'],fmt,i,len(buf));b=np.frombuffer(buf,dtype='uint8').reshape(height,width,3);stable=compose(ambient.copy(),rgba,margin,i);frame=np.rint(stable.astype('float32')*.88+b.astype('float32')*.12).astype('uint8');encoder.stdin.write(frame.tobytes())
   assert not decoder.stdout.read(1);encoder.stdin.close();assert decoder.wait()==0;assert encoder.wait()==0
  except:
   decoder.kill();encoder.kill();raise
 digest=sha(temp);file='tattoo-visible-'+work['id']+'-'+fmt+'-'+digest[:16]+'.mp4';final=out/file;temp.rename(final)
 poster=out/('tattoo-visible-'+work['id']+'-'+fmt+'-poster.jpg');subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-i',str(final),'-frames:v','1','-q:v','2','-update','1','-y',str(poster)],check=True)
 ph=sha(poster);posterFile='tattoo-visible-'+work['id']+'-'+fmt+'-'+ph[:16]+'.jpg';poster.rename(out/posterFile)
 ambientFile=out/('tattoo-visible-'+work['id']+'-'+fmt+'-ambient.jpg');Image.open(out/posterFile).filter(ImageFilter.GaussianBlur(max(20,min(width,height)*.05))).save(ambientFile,quality=90);ah=sha(ambientFile);ambientName='tattoo-visible-'+work['id']+'-'+fmt+'-ambient-'+ah[:16]+'.jpg';ambientFile.rename(out/ambientName)
 record={'file':file,'url':'/s/'+file,'bytes':final.stat().st_size,'sha256':digest,'width':width,'height':height,'fps':FPS,'duration':18,'decodedFrames':FRAMES,'posterFile':posterFile,'posterUrl':'/s/'+posterFile,'posterBytes':(out/posterFile).stat().st_size,'posterSha256':ph,'ambientFile':ambientName,'ambientUrl':'/s/'+ambientName,'ambientBytes':(out/ambientName).stat().st_size,'ambientSha256':ah,'sourceMovieSha256':old['sha256'],'sourcePhotoSha256':work['sourceSha256'],'anchor':bounds}
 (out/(work['id']+'-'+fmt+'.json')).write_text(json.dumps(record,indent=2)+'\n');print(work['id'],fmt,'rendered',record['bytes'],'bytes',round(time.time()-t,1),'seconds',flush=True);return record
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--ffmpeg',required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--ids',nargs='*');p.add_argument('--formats',nargs='*',default=['desktop','mobile']);p.add_argument('--workers',type=int,default=3);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
 jobs=[(w,f)for w in MANIFEST['works'] if not a.ids or w['id'] in a.ids for f in a.formats]
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as ex:list(ex.map(lambda j:render(j[0],j[1],a.ffmpeg,a.out),jobs))
