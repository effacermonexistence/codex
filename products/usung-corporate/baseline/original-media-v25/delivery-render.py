import sys, json, hashlib, time, subprocess, importlib.util
from pathlib import Path
sys.path.insert(0,'outputs/website/usung-reference-branding-v22/tools')
import cv2, numpy as np, imageio_ffmpeg
D=Path('outputs/website/usung-rework-v25/video-diagnosis/candidate'); P=Path('outputs/website/usung-rework-v25/source-candidates')
spec=importlib.util.spec_from_file_location('signedit',D/'sign-edit.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
ff=imageio_ffmpeg.get_ffmpeg_exe()
outputs=['usung-delivery-film-v25.mp4','usung-delivery-film-v25-source-comparator.mp4']
procs=[]
for name in outputs:
 f=open(D/(name+'.log'),'w'); cmd=[ff,'-hide_banner','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','24','-i','-','-an','-c:v','libx264','-preset','fast','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',str(D/name)]
 procs.append((subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=f,stderr=f),f))
report={'status':'rendering','sources':[],'segments':[], 'signPerFrame':[], 'output':{'fps':24,'size':[1920,1080]},'generatedScene':False,'nativeEditOnly':'sign company pigment local masks; geometry, lighting, camera motion, background, visitors, instructions retained. Structural and tablet footage unedited before crop/resize/encode.'}
urls=json.loads((P/'candidate-source-urls.json').read_text())
for name in ['turner-jobsite-01.mp4','turner-jobsite-02.mp4','turner-tech-01.mp4']:
 b=(P/name).read_bytes();report['sources'].append({'file':str((P/name).resolve()),'url':urls[name],'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)})
count=0;started=time.time();keys=set([0,24,48,72,96,119,120,132,144,156,167,168,192,216,240,264,286]);thumbs=[]
for name,n,kind in [('turner-jobsite-01.mp4',120,'sign'),('turner-jobsite-02.mp4',48,'structure'),('turner-tech-01.mp4',119,'tablet')]:
 c=cv2.VideoCapture(str(P/name));start=count
 for i in range(n):
  ok,src=c.read();assert ok,(name,i)
  if kind=='sign':
   edited,stats=mod.sign_edit(src,i);dif=np.any(src!=edited,axis=2);ys,xs=np.where(dif)
   report['signPerFrame'].append({'sourceFrame':i,'changedPixels':int(dif.sum()),'changedBoundsNative':[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)] if len(xs) else None,'outsideMaskEqualityAssert':'passed in sign_edit','pigment':stats})
   original=cv2.resize(src,(1920,1080),interpolation=cv2.INTER_AREA);frame=cv2.resize(edited,(1920,1080),interpolation=cv2.INTER_AREA)
  elif kind=='structure':
   original=cv2.resize(src[400:1318,2208:3840],(1920,1080),interpolation=cv2.INTER_AREA);frame=original
  else:
   original=cv2.resize(src,(1920,1080),interpolation=cv2.INTER_AREA);frame=original
  for (p,_),im in zip(procs,[frame,original]):p.stdin.write(im.tobytes())
  if count in keys:
   cv2.imwrite(str(D/f'preencode-{count:03d}.jpg'),frame,[cv2.IMWRITE_JPEG_QUALITY,96]);cv2.imwrite(str(D/f'original-{count:03d}.jpg'),original,[cv2.IMWRITE_JPEG_QUALITY,96])
   pair=np.hstack([cv2.resize(original,(640,360)),cv2.resize(frame,(640,360))]);cv2.putText(pair,f'output {count} | source {name} #{i} | original / candidate',(10,25),cv2.FONT_HERSHEY_SIMPLEX,.6,(40,40,40),2);thumbs.append(pair)
  count+=1
  if i%24==0:print(name,i,'output',count,'elapsed',round(time.time()-started,1),flush=True)
 c.release();report['segments'].append({'source':name,'sourceFrameRangeInclusive':[0,n-1],'outputFrameRangeInclusive':[start,count-1],'seconds':n/24,'operation':'local sign company pigment replacement' if kind=='sign' else 'unaltered source crop' if kind=='structure' else 'unaltered source downsample','nativeCropXYWH':[2208,400,1632,918] if kind=='structure' else [0,0,3840,2160]})
for p,f in procs:p.stdin.close();assert p.wait()==0;f.close()
report['output']['framesWritten']=count;report['output']['seconds']=count/24
# Decode actual final movie and export matching frame-0 and frame-120 posters.
c=cv2.VideoCapture(str(D/outputs[0]));decoded=[]
while True:
 ok,f=c.read()
 if not ok:break
 if len(decoded)==0:cv2.imwrite(str(D/'usung-delivery-film-v25.jpg'),f,[cv2.IMWRITE_JPEG_QUALITY,97])
 if len(decoded)==120:cv2.imwrite(str(D/'usung-delivery-film-v25-wide.jpg'),f,[cv2.IMWRITE_JPEG_QUALITY,97])
 if len(decoded) in keys:cv2.imwrite(str(D/f'decoded-{len(decoded):03d}.jpg'),f,[cv2.IMWRITE_JPEG_QUALITY,96])
 decoded.append(f.shape)
assert len(decoded)==287,len(decoded);assert all(s==(1080,1920,3) for s in decoded)
report['verification']={'encoderExitCodes':[0,0],'decodedFrameCount':len(decoded),'decodedShapesAllEqual':[1080,1920,3],'fps':float(c.get(cv2.CAP_PROP_FPS)),'postersFromEncodedFrames':[0,120],'outsideLocalSignMaskOriginalPixelEquality':'120 of 120 native frames asserted in sign_edit before downsample/encode','structureTabletPixelEditing':'zero; only selected native crop and downsample','elapsedSeconds':round(time.time()-started,2)};c.release()
report['excludedWork']={'rejectedWideEdits':'SUNBELT RENTALS / JLG in full-frame wide salvage were rejected. No pixels from wide-edit.py output are used. Selected actual source structure crop excludes equipment and those marks; it contains no replacement USUNG glyph.','modelSafety':'No JLG 460SJ model/safety decals are repainted. Equipment decals are outside the selected crop. Visitor sign instructions and border remain source pixels.'}
report['retainedUnknown']=[{'segment':'tablet','object':'small blue-white cooler badge in background','classification':'unreadable unknown; not asserted as company or safety label','action':'original pixels retained; no all-brands-removed claim'}]
for name in outputs:
 b=(D/name).read_bytes();report.setdefault('artifacts',[]).append({'file':str((D/name).resolve()),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
report['status']='rendered-and-decoded'
(D/'delivery-report.json').write_text(json.dumps(report,indent=2))
for j in range(0,len(thumbs),5):cv2.imwrite(str(D/f'delivery-comparison-{j//5}.jpg'),np.vstack(thumbs[j:j+5]),[cv2.IMWRITE_JPEG_QUALITY,95])
print(json.dumps({'status':report['status'],'frames':count,'seconds':count/24,'verification':report['verification'],'artifacts':report['artifacts']}),flush=True)
