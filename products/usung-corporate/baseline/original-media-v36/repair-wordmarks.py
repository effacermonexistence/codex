from pathlib import Path
import sys, json, hashlib
sys.path.insert(0,'outputs/website/usung-reference-branding-v22/tools')
import cv2, numpy as np
from PIL import Image, ImageDraw

P=Path('products/usung-corporate/public/assets/media')
R=Path('products/usung-corporate/baseline/original-media-v36');A=R/'audit';D=R/'edited'
A.mkdir(parents=True,exist_ok=True);D.mkdir(parents=True,exist_ok=True)
src=cv2.imread(str(P/'suffolk-naples.jpg'));base=cv2.imread(str(P/'usung-field-team-v33.webp'))
accepted=cv2.imread(str(P/'usung-field-team-v35.webp'))
out=accepted.copy();allowed=np.zeros(base.shape[:2],np.uint8)
wordmark=cv2.imread('products/usung-corporate/baseline/original-media-v36/canonical-transparent-wordmark.png',-1)
gy,gx=np.where(wordmark[:,:,3]>0);wordmark=wordmark[gy.min():gy.max()+1,gx.min():gx.max()+1]
wordmark_aspect=314.526/65.272
logo=cv2.imread('products/usung-corporate/baseline/original-media-v33/canonical-transparent-u.png',-1)
native_aspect=53.874/63.55
jobs=[
 dict(name='man',box=[746,204,949,356],old=[[771,216],[829,230],[870,251],[902,282],[939,349],[919,334],[885,304],[788,271]],top=[[774,218],[797,223],[820,230],[843,239],[865,251]],bottom=[[784,254],[807,259],[830,266],[853,274],[875,285]],donor=[696,236,748,292],center=.53,wordCenter=.58,wordSpan=1.20,sigma=1.12,verticalBow=.8,surfaceAspect=2.9),
 dict(name='woman',box=[1424,174,1592,274],old=[[1438,187],[1490,187],[1520,201],[1549,223],[1580,269],[1553,255],[1524,244],[1458,231]],top=[[1439,189],[1456,189],[1478,191],[1500,195],[1515,202]],bottom=[[1458,225],[1476,225],[1495,225],[1513,229],[1527,234]],donor=[1350,198,1416,252],center=.59,wordCenter=.62,wordSpan=1.25,sigma=1.05,verticalBow=.6,surfaceAspect=2.7)
]

def lin(s):
 s=np.asarray(s,np.float32)/255
 return np.where(s<=.04045,s/12.92,((s+.055)/1.055)**2.4)
def srgb(l):
 l=np.clip(l,0,1)
 return np.where(l<=.0031308,l*12.92,1.055*np.power(l,1/2.4)-.055)*255

records=[]
for j in jobs:
 x0,y0,x1,y1=j['box'];s=base[y0:y1,x0:x1].copy();source=src[y0:y1,x0:x1];h,w=s.shape[:2]
 area=np.zeros((h,w),np.uint8);cv2.fillPoly(area,[np.int32(j['old'])-[x0,y0]],255)
 gray=cv2.cvtColor(s,cv2.COLOR_BGR2GRAY);sat=cv2.cvtColor(s,cv2.COLOR_BGR2HSV)[:,:,1]
 ink=cv2.dilate(((area>0)&((gray<175)|(sat>38))).astype(np.uint8)*255,np.ones((7,7),np.uint8))&area
 # Only the two former front-print footprints can be edited. Fit photographed
 # white plastic around them; exclude original contractor pigment and hardware.
 yy,xx=np.mgrid[:h,:w].astype(np.float32);nx=(xx-w*.5)/w;ny=(yy-h*.5)/h
 X=np.stack([np.ones_like(nx),nx,ny,nx*nx,nx*ny,ny*ny],-1)
 sg=cv2.cvtColor(source,cv2.COLOR_BGR2GRAY);ss=cv2.cvtColor(source,cv2.COLOR_BGR2HSV)[:,:,1]
 expanded=cv2.dilate(area,np.ones((17,17),np.uint8))
 valid=(expanded==0)&(sg>185)&(ss<35)
 if valid.sum()<100:raise ValueError('Not enough actual helmet surface samples')
 weights=np.ones(valid.sum());samples=source[valid].astype(np.float64);design=X[valid].astype(np.float64)
 for _ in range(4):
  coef=np.linalg.lstsq(design*weights[:,None],samples*weights[:,None],rcond=None)[0]
  residual=np.linalg.norm(design@coef-samples,axis=1)
  weights=np.minimum(1,5/np.maximum(residual,1e-6))
 fitted=np.clip(X@coef,185,255).astype(np.float32)
 clean=cv2.inpaint(s,ink,6,cv2.INPAINT_NS).astype(np.float32)
 # Recover the surface under the old sharp U using boundary-constrained smooth
 # illumination. The cleaned white helmet outside that pigment remains intact.
 donor=src[j['donor'][1]:j['donor'][3],j['donor'][0]:j['donor'][2]].astype(np.float32)
 detail=donor-cv2.GaussianBlur(donor,(0,0),1.35)
 grain=cv2.resize(detail,(w,h),interpolation=cv2.INTER_CUBIC)
 restored=fitted+grain*.35
 # Preserve the already cleaned dome and original red-tail region in v33.
 # Restore only the old glyph neighborhood, fitting its surrounding clean
 # photographed plastic rather than filling the full former sticker polygon.
 blank=(cv2.dilate(area,np.ones((9,9),np.uint8))>0)&(ink==0)&(gray>190)&(sat<35)
 blankcoef=np.linalg.lstsq(X[blank],s[blank].astype(np.float64),rcond=None)[0]
 under=np.clip(X@blankcoef,185,255)+grain*.18
 distance=cv2.distanceTransform(255-ink,cv2.DIST_L2,5)
 restoreAlpha=np.exp(-distance*distance/(2*1.3**2))
 clean=s*(1-restoreAlpha[:,:,None])+under*restoreAlpha[:,:,None]

 # The two observed original sticker edge traces constrain a nonlinear surface
 # map. Quadratic traces curve around the dome; their differing slopes/spacing
 # naturally compress the far/right side. No four-corner parallelogram warp.
 knots=np.linspace(0,1,5);top=np.polyfit(knots,np.float64(j['top'])-[x0,y0],2)
 bottom=np.polyfit(knots,np.float64(j['bottom'])-[x0,y0],2)
 def surface(u,v):
  T=np.stack([np.polyval(top[:,k],u) for k in range(2)],-1)
  B=np.stack([np.polyval(bottom[:,k],u) for k in range(2)],-1)
  F=T*(1-v[...,None])+B*v[...,None]
  F[...,0]+=j['verticalBow']*4*v*(1-v)
  return F
 u=np.clip((xx-(j['top'][0][0]-x0))/(j['top'][-1][0]-j['top'][0][0]),-.3,1.4)
 v=np.clip((yy-(j['top'][0][1]-y0))/36,-.5,2)
 for _ in range(9):
  F=surface(u,v);du=(surface(u+.0005,v)-F)/.0005;dv=(surface(u,v+.0005)-F)/.0005
  ex=F[...,0]-xx;ey=F[...,1]-yy;det=du[...,0]*dv[...,1]-du[...,1]*dv[...,0]
  safe=np.where(abs(det)>1e-5,det,1)
  u-=np.clip((ex*dv[...,1]-ey*dv[...,0])/safe,-.25,.25)
  v-=np.clip((du[...,0]*ey-du[...,1]*ex)/safe,-.5,.5)
 # Intrinsic native U aspect remains fixed. The plate's geodesic aspect is an
 # estimate from photographed label proportions, not a camera calibration.
 vstart,vend=.04,.96;surface_aspect=j['surfaceAspect']
 span=native_aspect*(vend-vstart)/surface_aspect;ustart=j['center']-span*.5
 U=(u-ustart)/span;V=(v-vstart)/(vend-vstart)
 mx=(U*(logo.shape[1]-1)).astype(np.float32);my=(V*(logo.shape[0]-1)).astype(np.float32)
 alpha=logo[:,:,3].astype(np.float32)/255
 pigment=lin(logo[:,:,:3])
 pa=cv2.remap(alpha,mx,my,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
 pc=cv2.remap(pigment*alpha[:,:,None],mx,my,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
 pa=np.clip(pa,0,1);pc=np.clip(pc,0,1)
 native_color=pc/np.maximum(pa[:,:,None],1e-6)
 white=lin(fitted)
 # Shared diffuse light and a spatial outdoor clear-coat reflection for BOTH
 # approved pigments. Work in linear RGB, preserving the blue sky/warm plastic
 # tint of the actual photograph. Reflection varies with source light and dome
 # tangent; no separate flat hot-pink patch or random synthetic noise.
 luminance=white.mean(axis=2)
 light=np.clip(luminance/.84,.70,1.08)
 tangent=surface(u+.001,v)-surface(u-.001,v)
 angle=np.arctan2(tangent[...,1],tangent[...,0])
 # Use the source's navy plate to measure a broad photographed reflection
 # gradient; reject its white lettering and edge pixels. Its absolute navy
 # pigment is not copied into the new black brand.
 shsv=cv2.cvtColor(source,cv2.COLOR_BGR2HSV)
 navy=(u>.03)&(u<.98)&(v>.12)&(v<.88)&(shsv[:,:,0]>92)&(shsv[:,:,0]<123)&(shsv[:,:,1]>32)&(sg<160)
 nxplate=u-.5;nyplate=v-.5
 LX=np.stack([np.ones_like(u),nxplate,nyplate,nxplate*nxplate,nxplate*nyplate,nyplate*nyplate],-1)
 if navy.sum()<40:raise ValueError('Not enough original plate pixels')
 lc=np.linalg.lstsq(LX[navy],lin(source)[navy],rcond=None)[0]
 reflected_source=np.clip(LX@lc,0,.5)
 source_light=reflected_source.mean(axis=2)
 source_median=np.median(source_light[navy])
 source_low=np.percentile(source_light[navy],15)
 local_glare=np.clip(source_light-source_low,0,.15)
 reflection=.014+.045*np.clip((luminance-.65)/.3,0,1)+local_glare*.45+.008*np.sin(angle)**2
 sky_tint=np.array([1.12,1.025,.94],np.float32)
 tint=white/np.maximum(white.mean(axis=2)[:,:,None],1e-5)
 paint=native_color*light[:,:,None]*(1-reflection[:,:,None])+reflection[:,:,None]*sky_tint*tint
 # Lens blur filters premultiplied radiance and coverage together once. Donor
 # texture is the original white helmet's photographed high-frequency detail.
 paint+=grain*.06/255
 premul=cv2.GaussianBlur(paint*pa[:,:,None],(0,0),j['sigma'])
 coverage=cv2.GaussianBlur(pa,(0,0),j['sigma'])
 linear=lin(clean)*(1-coverage[:,:,None])+premul
 resultOld=np.rint(srgb(linear)).clip(0,255).astype(np.uint8)
 oldSupport=((restoreAlpha>1e-4)|(coverage>1e-5))&(area>0)
 oldExact=np.array_equal(resultOld[oldSupport],accepted[y0:y1,x0:x1][oldSupport])
 if not oldExact:raise ValueError('Preserved v35 print model no longer reconstructs the current baseline photograph')
 oldCoverage=coverage.copy()
 # Full canonical USUNG. Width is selected in the observed surface coordinates;
 # height follows the native wordmark aspect, never independently stretched.
 span=j['wordSpan'];ustart=j['wordCenter']-span*.5
 vheight=span*j['surfaceAspect']/wordmark_aspect
 vstart=.50-vheight*.5;vend=.50+vheight*.5
 U=(u-ustart)/span;V=(v-vstart)/(vend-vstart)
 mx=(U*(wordmark.shape[1]-1)).astype(np.float32);my=(V*(wordmark.shape[0]-1)).astype(np.float32)
 alpha=wordmark[:,:,3].astype(np.float32)/255;pigment=lin(wordmark[:,:,:3])
 pa=cv2.remap(alpha,mx,my,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
 pc=cv2.remap(pigment*alpha[:,:,None],mx,my,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
 pa=np.clip(pa,0,1);pc=np.clip(pc,0,1);native_color=pc/np.maximum(pa[:,:,None],1e-6)
 paint=native_color*light[:,:,None]*(1-reflection[:,:,None])+reflection[:,:,None]*sky_tint*tint
 paint+=grain*.06/255
 premul=cv2.GaussianBlur(paint*pa[:,:,None],(0,0),j['sigma'])
 coverage=cv2.GaussianBlur(pa,(0,0),j['sigma'])
 resultNew=np.rint(srgb(lin(clean)*(1-coverage[:,:,None])+premul)).clip(0,255).astype(np.uint8)
 # Delta-only substitution against exact reconstructed v35 preserves every
 # preserved scene and secondary mark outside the two printed glyphs.
 delta=resultNew.astype(np.int16)-resultOld.astype(np.int16)
 support=((oldCoverage>1e-5)|(coverage>1e-5))&(area>0)
 result=np.clip(accepted[y0:y1,x0:x1].astype(np.int16)+delta,0,255).astype(np.uint8)
 out[y0:y1,x0:x1][support]=result[support];allowed[y0:y1,x0:x1][support]=255
 cv2.imwrite(str(A/f'{j["name"]}-front-mask.png'),support.astype(np.uint8)*255)
 corners=surface(np.array([ustart,ustart+span,ustart+span,ustart]),np.array([vstart,vstart,vend,vend]))+np.array([x0,y0])
 center_pixels=(pa>.9)&(native_color[:,:,2]<.04)
 residual=np.linalg.norm(surface(u,v)-np.stack([xx,yy],-1),axis=2)
 records.append(dict(name=j['name'],observedTopTrace=j['top'],observedBaselineTrace=j['bottom'],surfaceFit='quadratic source-edge traces plus estimated vertical dome bow',nativeAspect=wordmark_aspect,v35ModelReconstructsAccepted=oldExact,wordSpan=span,wordVHeight=vheight,estimatedSurfaceAspect=surface_aspect,projectedCorners=corners.tolist(),lensSigmaPx=j['sigma'],whiteSurfaceSamples=int(valid.sum()),blackPrintedMedianBGR=np.median(result[center_pixels],axis=0).tolist(),linearReflectionRange=[float(reflection[pa>.5].min()),float(reflection[pa>.5].max())],inverseMapMaxResidualPx=float(residual[pa>.1].max()),changedPixels=int(np.any(result[support]!=accepted[y0:y1,x0:x1][support],axis=1).sum())))

target=D/'usung-field-team-v36.webp';cv2.imwrite(str(target),out,[cv2.IMWRITE_WEBP_QUALITY,101])
assert np.array_equal(cv2.imread(str(target)),out)
change=np.any(out!=accepted,axis=2);assert not change[allowed==0].any()
protected={}
for name,(a,b,c,d) in {'vest':(860,1220,960,1330),'side-sticker':(1148,233,1216,282),'man-hardware':(840,135,913,220),'faces':(600,415,1570,730)}.items():
 protected[name]=bool(np.array_equal(out[b:d,a:c],accepted[b:d,a:c]));assert protected[name]
cv2.imwrite(str(A/'helmet-front-change-mask.png'),allowed)
sourceMask=np.any(accepted!=src,axis=2)|(allowed>0)
assert np.array_equal(out[~sourceMask],src[~sourceMask])
cv2.imwrite(str(A/'combined-original-brand-mask.png'),sourceMask.astype(np.uint8)*255)
for name,box in [('man',(730,185,965,405)),('woman',(1410,160,1630,315))]:
 a,b,c,d=box;ww,hh=c-a,d-b;comp=Image.new('RGB',(ww*3,hh+22),'white');draw=ImageDraw.Draw(comp)
 for i,(im,label) in enumerate([(src,'ORIGINAL PHOTO'),(accepted,'V35 U'),(out,'V36 FULL USUNG')]):
  comp.paste(Image.fromarray(cv2.cvtColor(im[b:d,a:c],cv2.COLOR_BGR2RGB)),(i*ww,22));draw.text((i*ww+4,4),label,fill='black')
 comp.resize((comp.width*3,comp.height*3),Image.Resampling.BICUBIC).save(A/f'{name}-comparison.png')
Image.fromarray(cv2.cvtColor(out,cv2.COLOR_BGR2RGB)).resize((1100,733),Image.Resampling.LANCZOS).save(A/'helmet-full-review.jpg')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
report=dict(source=str(P/'suffolk-naples.jpg'),sourceSha256=sha(P/'suffolk-naples.jpg'),baseline=str(P/'usung-field-team-v35.webp'),baselineSha256=sha(P/'usung-field-team-v35.webp'),output=str(target),outputSha256=sha(target),dimensions=[2200,1466],variant='B',nativePink='#FF0F6F',nativeCornerRect=[72.362,23.072,16.090,15.987],canonicalVector='products/usung-corporate/src/brand.mjs',canonicalRaster='products/usung-corporate/baseline/original-media-v36/canonical-transparent-wordmark.png',canonicalRasterSha256=sha(Path('products/usung-corporate/baseline/original-media-v36/canonical-transparent-wordmark.png')),sourcePage='https://suffolk.com/',sourceAsset='https://suffolk.com/wp-content/uploads/2025/07/NAPLES_BEACH_CLUB-12.png',outsideCombinedOriginalBrandMaskEqualsSource=True,noGeneration=True,method='Full canonical B USUNG wordmark, native intrinsic aspect; exact model-forward delta against current v35 scene baseline. Nonlinear source-plate-curve mapping; linear-RGB diffuse/specular response from photographed helmet surface; single premultiplied lens focus; original-photo grain. Estimated surface fit, no camera calibration or new scene generation.',changedPixels=int(change.sum()),outsideTwoFrontMasksEqualsV35=True,lossless=True,protected=protected,repairs=records)
(A/'wordmark-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
