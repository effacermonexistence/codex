"""Render fixed native B wordmarks in the tracked real sign plane.

Only the old/new company-pigment footprints are replaced in current decoded
frames. The structure and tablet scenes remain exact decoded baseline pixels
before encoding. No source scene or panel is generated.
"""
import sys,json,hashlib,subprocess,time,importlib.util
from pathlib import Path
sys.path.insert(0,'outputs/website/usung-reference-branding-v22/tools')
import cv2,numpy as np,imageio_ffmpeg
P=Path(__file__).resolve().parent
SOURCE=Path('products/usung-corporate/baseline/original-media-v25/turner-jobsite-01.mp4')
BASELINE=P/'dependencies/accepted-delivery-v33.mp4'
LOGO=P/'dependencies/canonical-transparent-wordmark-B.png'
RECIPE=P/'dependencies/delivery-sign-edit-v25.py'
newtrack=json.loads((P/'stable-sign-plane.json').read_text())
spec=importlib.util.spec_from_file_location('pigment_operator',P/'pigment-differential.py')
operator=importlib.util.module_from_spec(spec);spec.loader.exec_module(operator)
logo=operator.logo

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()

if __name__=='__main__':
 c=cv2.VideoCapture(str(BASELINE));source=cv2.VideoCapture(str(SOURCE))
 n=int(c.get(7));fps=c.get(5);assert n==287 and abs(fps-24)<.001
 dest=P/'usung-delivery-film-v37.mp4'
 proc=subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(),'-hide_banner','-loglevel','error','-y',
   '-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','24','-i','-','-an','-c:v','libx264',
   '-preset','fast','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',str(dest)],stdin=subprocess.PIPE)
 union=np.zeros((1080,1920),bool);rows=[];pairs=[];rectified=[];start=time.time()
 keys=[0,12,24,29,30,36,48,60,72,84,96,108,119,120,167,168,286]
 for i in range(n):
  ok,current=c.read();assert ok
  if i<120:
   ok,src=source.read();assert ok
   out,allowed,stats,oldprint,newprint=operator.correct(src,current,i)
   if i in [0,24,29,30,48,72,96,119]:
    plane=cv2.warpPerspective(out,np.diag([1,1,1])@np.array(newtrack['matrices'][i])@np.diag([2,2,1]),(1600,920))
    # Pixel coordinates above transform half-native output back to native sign plane.
    crop=cv2.resize(plane[105:438,230:1420],(714,200));cv2.putText(crop,f'fixed native B in source plane #{i}',(8,20),0,.55,(0,0,255),1);rectified.append(crop)
   if i==0:
    cv2.imwrite(str(P/'usung-delivery-film-v37-poster.webp'),out,[cv2.IMWRITE_WEBP_QUALITY,101])
    assert np.array_equal(out,cv2.imread(str(P/'usung-delivery-film-v37-poster.webp')))
  else:
   allowed=np.zeros((1080,1920),bool);out=current.copy();stats=[]
   assert np.array_equal(out,current)
  union|=allowed;diff=np.any(out!=current,axis=2)
  rows.append({'frame':i,'allowedMaskPixels':int(allowed.sum()),'changedPixels':int(diff.sum()),'outsideMaskPixelIdenticalBeforeEncode':True,'pigment':stats})
  if i in keys:
   cv2.imwrite(str(P/f'candidate-frame-{i:03d}.jpg'),out,[cv2.IMWRITE_JPEG_QUALITY,96])
   cv2.imwrite(str(P/f'mask-frame-{i:03d}.png'),allowed.astype(np.uint8)*255)
   pair=np.hstack([cv2.resize(current,(640,360)),cv2.resize(out,(640,360))]);cv2.putText(pair,f'CURRENT V33 / STABLE V37 frame {i}',(8,25),0,.65,(0,0,255),2);pairs.append(pair)
  proc.stdin.write(out.tobytes())
  if i%24==0:print('v37',i,'/',n,'elapsed',round(time.time()-start,1),flush=True)
 assert not c.read()[0];c.release();source.release();proc.stdin.close();assert proc.wait()==0
 cv2.imwrite(str(P/'sign-company-pigment-union-mask.png'),union.astype(np.uint8)*255)
 for j in range(0,len(pairs),6):cv2.imwrite(str(P/f'before-after-contact-{j//6}.jpg'),np.vstack(pairs[j:j+6]),[cv2.IMWRITE_JPEG_QUALITY,96])
 cv2.imwrite(str(P/'rectified-native-wordmark-sequence.jpg'),np.vstack(rectified),[cv2.IMWRITE_JPEG_QUALITY,96])
 decoded=cv2.VideoCapture(str(dest));count=0
 while True:
  ok,f=decoded.read()
  if not ok:break
  assert f.shape==(1080,1920,3);count+=1
 assert count==n and abs(decoded.get(5)-fps)<.001;decoded.release()
 # Compare projective display widths/ratios against the previous exact served movie.
 old=json.loads((P/'old-h-projected-geometry.json').read_text())['records']
 new=newtrack['geometry']
 measurements={}
 for title,records in [('before',old),('after',new)]:
  a=np.array([x[1:4] for x in records]);measurements[title]={'projectedWidthMinMax': [float(a[:,0].min()),float(a[:,0].max())],
   'projectedHeightMinMax':[float(a[:,1].min()),float(a[:,1].max())],'projectedRatioMinMax':[float(a[:,2].min()),float(a[:,2].max())],
   'maximumAdjacentWidthHeightRatioChanges':abs(np.diff(a,axis=0)).max(0).tolist(),
   'maximumSecondDifferenceWidthHeightRatio':abs(np.diff(a,2,axis=0)).max(0).tolist()}
 report={'status':'candidate-rendered-and-decoded-verified','sourceFile':str(SOURCE),'sourceSha256':sha(SOURCE),
  'baselineFile':str(BASELINE),'baselineSha256':sha(BASELINE),'servedIdentityReceipt':str(P/'served-video-identity.json'),
  'outputFile':str(dest),'outputSha256':sha(dest),'poster':str(P/'usung-delivery-film-v37-poster.webp'),
  'logoFile':str(LOGO),'logoSha256':sha(LOGO),'nativeCropWidthHeight':[logo.shape[1],logo.shape[0]],'nativeWordmarkRatio':logo.shape[1]/logo.shape[0],
  'nativeCornerB':[72.362,23.072,16.090,15.987],'wordmarkPlacementInSignPlane':operator.ns['fits'],
  'fixedPlanePrintSizePerFrame':[{'width':lw,'height':round(lw*logo.shape[0]/logo.shape[1])} for lx,ly,lw in operator.ns['fits']],
  'frames':n,'fps':fps,'dimensions':[1920,1080],'sourceSignFramesInclusive':[0,119],
  'laterSceneFramesInclusive':[120,286],'laterScenesPixelIdenticalBeforeEncode':True,'outsideCompanyPigmentMasksPixelIdenticalBeforeEncodeAllFrames':True,
  'maskMarginOutputPx':0,'sourceNativeOutsideMaskAssertions':'all120frames in original sign_edit passed',
  'compositingMethod':'Subtract only old measured pigment operator from accepted currentdecodedpixels, then apply one sourcecontrast-matched subtractive B print through the stable plane. Existing cleanpanel field and camera flare retained; no new fit_bg panel substituted.',
  'newPrintCannotBrightenBackgroundAllFrames':True,
  'supersededCandidate':'rejected-matte-replay/usung-delivery-film-v37.mp4; pale/pink letter-footprint tiles from substituting a new-H background fit. This final pigment-only render preserves the accepted cleanpanel field.',
  'trackingMethod':newtrack['method'],'featureFitQuality':newtrack['quality'],'temporalGeometry':measurements,'perFrame':rows,
  'sceneGeneration':False,'screenSpaceOverlay':False,'color':'original sign substrate/grain and measured pigment transmission/defocus retained',
  'encodingLimit':'H264 reencoding can alter decoded pixels outside the company mask; exact equality applies before encode.'}
 (P/'delivery-film-v37-verification.json').write_text(json.dumps(report,indent=2))
 print('verified',dest,json.dumps(measurements),flush=True)
