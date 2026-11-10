"""Video-only, source-locked spatial recursion rebalance.
Current L=.88*S+.12*R. A precomputed smooth mask derives the required L/R mix
for 20% recursion in the design core and 80% in the surrounding moving field.
All three maskedmerge inputs use full-range planar RGB; no chroma-mask shortcut.
"""
from pathlib import Path
import argparse,json,hashlib,subprocess,concurrent.futures,time
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
old=json.loads((ROOT/'content/tattoo-legibility/delivery.json').read_text());original=json.loads((ROOT/'content/tattoo-motion/manifest.json').read_text())
def render(pair,ff,out):
 i,fmt=pair;w=old['works'][i];a=w[fmt];r=original['works'][i][fmt];assert original['works'][i]['id']==w['id'];assert original['works'][i]['sourceSha256']==w['sourceSha256']
 readable=a
 if a.get('sourceReadableMovieSha256'):
  readable=next(x for x in old.get('previousMovies',[])if x['sha256']==a['sourceReadableMovieSha256'])
 lp=ROOT/'site/s'/readable['file'];rp=ROOT/'site/s'/r['file'];assert sha(lp)==readable['sha256'];assert sha(rp)==r['sha256'];t=time.time();temp=out/(w['id']+'-'+fmt+'.mp4');log=out/(w['id']+'-'+fmt+'.log');width,height=a['width'],a['height']
 yy,xx=np.mgrid[:height,:width];rx=a['anchor']['width']*.38;ry=a['anchor']['height']*.38;distance=np.sqrt(((xx-width/2)/rx)**2+((yy-height/2)/ry)**2);u=np.clip((distance-.6)/.65,0,1);target=.20+.60*(u*u*(3-2*u));mix=(target-.12)/.88;mask=np.rint(mix*255).astype('uint8');maskfile=out/(w['id']+'-'+fmt+'-mix-mask.png');Image.fromarray(np.repeat(mask[:,:,None],3,axis=2)).save(maskfile)
 graph='[0:v]format=gbrp[l];[1:v]format=gbrp[r];[2:v]format=gbrp[m];[l][r][m]maskedmerge=planes=7,format=yuv420p[v]'
 with log.open('wb')as err:
  subprocess.run([ff,'-hide_banner','-loglevel','error','-y','-threads','1','-i',str(lp),'-threads','1','-i',str(rp),'-loop','1','-framerate','24','-i',str(maskfile),'-filter_complex_threads','2','-filter_complex',graph,'-map','[v]','-frames:v','432','-t','18','-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-threads','2','-movflags','+faststart',str(temp)],check=True,stderr=err)
 digest=sha(temp);file=f"tattoo-visible-{w['id']}-{fmt}-{digest[:16]}.mp4";temp.rename(out/file)
 poster=out/(w['id']+'-'+fmt+'-poster.jpg');subprocess.run([ff,'-hide_banner','-loglevel','error','-i',str(out/file),'-frames:v','1','-q:v','2','-update','1','-y',str(poster)],check=True);ph=sha(poster);pf=f"tattoo-visible-{w['id']}-{fmt}-{ph[:16]}.jpg";poster.rename(out/pf)
 anchor={k:v for k,v in a['anchor'].items()if k not in ['recursiveMix','minimumOriginalContribution']};anchor.update({'recursiveMixCore':.20,'recursiveMixOuter':.80,'coreMinimumOriginalContribution':.915*.80,'outerMinimumOriginalContribution':.915*.20,'contributionMeaning':'Modeled direct source-photo weight before encoding, inside the opaque photo plate; not perceptual similarity proof','protectedCenter':[.5,.5],'protectedRadius':[rx/width,ry/height],'maskFeatherDistance':[.6,1.25],'maskSha256':sha(maskfile),'nonrigidWarp':False})
 result={**a,'file':file,'url':'/s/'+file,'bytes':(out/file).stat().st_size,'sha256':digest,'posterFile':pf,'posterUrl':'/s/'+pf,'posterBytes':(out/pf).stat().st_size,'posterSha256':ph,'sourceReadableMovieSha256':readable['sha256'],'sourceMovieSha256':r['sha256'],'anchor':anchor}
 assert 0<result['bytes']<=15000000; (out/(w['id']+'-'+fmt+'.json')).write_text(json.dumps(result,indent=2)+'\n');print(w['id'],fmt,result['bytes'],round(time.time()-t,1),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--ffmpeg',required=True);p.add_argument('--out',required=True,type=Path);p.add_argument('--ids',nargs='*');p.add_argument('--formats',nargs='*',default=['desktop','mobile']);p.add_argument('--workers',type=int,default=2);a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True);jobs=[(i,f)for i,w in enumerate(old['works'])if not a.ids or w['id']in a.ids for f in a.formats]
 with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers)as pool:list(pool.map(lambda j:render(j,a.ffmpeg,a.out),jobs))
