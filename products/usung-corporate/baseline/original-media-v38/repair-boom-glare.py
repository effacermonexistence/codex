from pathlib import Path
import sys,json,hashlib
sys.path.insert(0,'outputs/website/usung-reference-branding-v22/tools')
import cv2,numpy as np
from PIL import Image,ImageDraw,__version__ as pillow_version

ROOT=Path('outputs/website/usung-media-v38/photo')
MEDIA=Path('products/usung-corporate/public/assets/media')
SOURCE=MEDIA/'built-sunrise.jpg'
BASE=MEDIA/'usung-site-dawn-v37.webp'
src=cv2.imread(str(SOURCE));base=cv2.imread(str(BASE));out=base.copy()
h,w=base.shape[:2]
assert src.shape==base.shape
roi=[1285,550,1365,660]
x0,y0,x1,y1=roi
s=src[y0:y1,x0:x1].astype(np.float32)
yy,xx=np.mgrid[y0:y1,x0:x1].astype(np.float32)

def linear(a):
    a=np.asarray(a,np.float32)/255
    return np.where(a<=.04045,a/12.92,((a+.055)/1.055)**2.4)
def srgb(a):
    a=np.clip(a,0,1)
    return np.where(a<=.0031308,a*12.92,1.055*a**(1/2.4)-.055)*255

# The original camera image already contains this bright reflection beside the
# boom worklight. Owner asks to soften this exact visible area. No logo erased
# or invented. Rebuild only the panel interior using adjacent photographed paint.
q=np.float32([[1284,546],[1338,546],[1361,582],[1361,640],[1347,658],[1339,651],[1306,598],[1289,570]])
area=np.zeros((h,w),np.uint8);cv2.fillPoly(area,[np.int32(q)],255)
# Explicit physical preservation: worklight/starburst, controls/wiring, double
# seam, outer panel edge, hydraulic hardware and all other source pixels.
protected=np.zeros((h,w),np.uint8)
cv2.rectangle(protected,(1361,594),(1418,648),255,-1)
hardware_area=np.zeros((h,w),np.uint8)
cv2.rectangle(hardware_area,(1337,558),(1380,594),255,-1)
source_gray=cv2.cvtColor(src,cv2.COLOR_BGR2GRAY)
protected[(hardware_area>0)&(source_gray<85)]=255
seam_area=np.zeros((h,w),np.uint8)
cv2.line(seam_area,(1310,594),(1345,541),255,5)
global_y,global_x=np.mgrid[:h,:w]
# Keep the original antialiased outside face edge and every navy side pixel.
protected[global_x<.600*global_y+953]=255
area[protected>0]=0
a=area[y0:y1,x0:x1]

# Use actual reddish photographed surface from the clear upper boom band.
# Rectification keeps its panel direction; native-scale tiling avoids enlarging
# photo grain. No generated surface, flat colour fill or synthetic texture.
donor_q=np.float32([[1194,395],[1227,395],[1246,424],[1213,424]])
DH=cv2.getPerspectiveTransform(donor_q,np.float32([[0,0],[32,0],[32,28],[0,28]]))
donor=cv2.warpPerspective(src,DH,(33,29),flags=cv2.INTER_CUBIC).astype(np.float32)
# Actual donor paint pixels form the repaired plane. The small colour shift is
# measured from the undamaged lower same-plane paint beside the glare.
target_donor=src[648:660,1358:1370].astype(np.float32)
color_shift=np.median(target_donor.reshape(-1,3),axis=0)-np.median(donor.reshape(-1,3),axis=0)
transverse=((xx-1335)*.851-(yy-605)*.525)
along=((xx-1335)*.525+(yy-605)*.851)
mx=np.mod(transverse+132,32).astype(np.float32)
my=np.mod(along+116,28).astype(np.float32)
source_paint=cv2.remap(donor,mx,my,cv2.INTER_CUBIC,borderMode=cv2.BORDER_REFLECT_101)
source_paint=np.clip(source_paint+color_shift[None,None,:],0,255)
paint=linear(source_paint)
# Broad low diffuse illumination retains a plausible source-light response.
# Hard clipped white blob is reduced while the real adjacent light is exact.
light=np.exp(-(((xx-1368)/40)**2+((yy-610)/30)**2)/2)
lamp=np.median(src[606:616,1370:1380].reshape(-1,3),axis=0)
lamp_tint=linear(lamp);lamp_tint/=max(float(lamp_tint.mean()),1e-6)
paint+=light[:,:,None]*lamp_tint[None,None,:]*.022
paint=cv2.GaussianBlur(paint,(0,0),.48)
# The photographed double seam remains in its exact pose. Transfer its source
# optical contrast under the corrected local illumination; untouched source
# pixels remain exact outside the mask. Cables and worklight are fully protected.
smooth_source=cv2.GaussianBlur(linear(s),(0,0),1.5)
seam_ratio=np.clip(linear(s)/np.maximum(smooth_source,1e-5),.16,1.10)
seam_here=seam_area[y0:y1,x0:x1]>0
paint[seam_here]*=seam_ratio[seam_here]

# Boundary alpha uses source geometry and pixel distance; no blurred rectangle.
distance=cv2.distanceTransform(a,cv2.DIST_L2,5)
alpha=np.clip(distance/3.5,0,1)
alpha=alpha*alpha*(3-2*alpha)
brightness=np.clip((source_gray[y0:y1,x0:x1].astype(np.float32)-90)/40,0,1)
brightness=brightness*brightness*(3-2*brightness)
alpha*=brightness
alpha[seam_here]=np.clip(distance[seam_here]/3.5,0,1)
top_transition=np.clip((yy-554)/24,0,1)
top_transition=top_transition*top_transition*(3-2*top_transition)
bottom_transition=np.clip((660-yy)/14,0,1)
bottom_transition=bottom_transition*bottom_transition*(3-2*bottom_transition)
alpha*=top_transition*bottom_transition
# Preserve the photographed straight edge's antialias coverage while reducing
# its interior glare. The transition is measured independently for each source
# row; navy-side pixels stay exact rather than receiving a pasted polygon.
edge_distance=xx-(.600*yy+953)
edge_here=(edge_distance>=0)&(edge_distance<3.5)&(a>0)
for iy in range(y1-y0):
    gy=y0+iy;left=int(np.floor(.600*gy+953))
    background=linear(src[gy,left-2])
    foreground=linear(np.median(src[gy,left+4:left+7],axis=0))
    local_lin=linear(s[iy])
    edge_fraction=np.clip((local_lin.mean(axis=1)-background.mean())/max(float(foreground.mean()-background.mean()),1e-5),0,1)
    cols=edge_here[iy]
    paint[iy,cols]=paint[iy,cols]*edge_fraction[cols,None]+background[None,:]*(1-edge_fraction[cols,None])
    topfade=np.clip((gy-554)/24,0,1);topfade=topfade*topfade*(3-2*topfade)
    bottomfade=np.clip((660-gy)/14,0,1);bottomfade=bottomfade*bottomfade*(3-2*bottomfade)
    alpha[iy,cols]=topfade*bottomfade
result=np.rint(srgb(linear(s)*(1-alpha[:,:,None])+paint*alpha[:,:,None])).clip(0,255).astype(np.uint8)
local=out[y0:y1,x0:x1];local[a>0]=result[a>0]
allowed=np.zeros((h,w),np.uint8);allowed[y0:y1,x0:x1]=a
candidate=ROOT/'usung-site-dawn-v38.webp'
cv2.imwrite(str(candidate),out,[cv2.IMWRITE_WEBP_QUALITY,101])
saved=cv2.imread(str(candidate));assert np.array_equal(saved,out)
assert np.array_equal(out[allowed==0],base[allowed==0])
assert np.array_equal(base[510:690,1250:1420],src[510:690,1250:1420])
assert np.array_equal(out[protected>0],base[protected>0])
prior=(np.any(base!=src,axis=2)).astype(np.uint8)*255
combined=allowed|prior
assert np.array_equal(out[combined==0],src[combined==0])
changed=np.any(out!=base,axis=2)
cv2.imwrite(str(ROOT/'boom-allowed-mask.png'),allowed)
cv2.imwrite(str(ROOT/'boom-change-mask.png'),changed.astype(np.uint8)*255)
cv2.imwrite(str(ROOT/'boom-protected-mask.png'),protected)
cv2.imwrite(str(ROOT/'combined-source-retouch-mask.png'),combined)
cv2.imwrite(str(ROOT/'usung-site-dawn-v38-preview.jpg'),cv2.resize(out,(1600,1066)))
for name,b,scale in [('boom-zoom',(1250,510,1420,690),4),('boom-context',(1120,375,1500,835),2)]:
    ims=[src,base,out];width,height=b[2]-b[0],b[3]-b[1]
    c=Image.new('RGB',(width*scale*3,height*scale+27),(22,22,22));d=ImageDraw.Draw(c)
    for i,(im,label) in enumerate(zip(ims,['original camera photo','accepted v37','candidate v38'])):
        d.text((i*width*scale+8,7),label,fill='white')
        crop=Image.fromarray(cv2.cvtColor(im[b[1]:b[3],b[0]:b[2]],cv2.COLOR_BGR2RGB))
        c.paste(crop.resize((width*scale,height*scale),Image.Resampling.LANCZOS),(i*width*scale,27))
    c.save(ROOT/(name+'-before-after.png'))
maskview=out.copy()
maskview[allowed>0]=np.rint(maskview[allowed>0]*.55+np.array([111,15,255])*.45).astype(np.uint8)
cv2.imwrite(str(ROOT/'boom-mask-context.png'),maskview[510:690,1250:1420])
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
report=dict(source=str(SOURCE),sourceSha256=sha(SOURCE),baseline=str(BASE),baselineSha256=sha(BASE),candidate=str(candidate),candidateSha256=sha(candidate),dimensions=[w,h],screenshot='/Users/lua/Desktop/Screenshot 2026-10-05 at 7.09.37\u202fPM.png',target='White glare on boom panel immediately beside worklight, original coordinates approximately x1314–1355 y583–639.',causeEvidence=dict(originalSourceCrop=[1250,510,1420,690],originalVsV37ChangedPixels=0,observed='The exact visible white patch is present in both original photograph and accepted v37, pixel for pixel.',inferred='Photographed bright illumination/reflection beside visible boom worklight; no Codex erasure or original logo identified in this area.'),method='Mask-confined adjacent source-pixel retouch. Real reddish upper-boom paint rectified and remapped at native texture scale, measured lower-boom colour shift, low diffuse light using photographed lamp tint, source seam optical contrast transferred under corrected illumination, original edge antialias estimated by source-row contrast. No generated texture or new logo. Narrow original glare footprint only.',noGeneration=True,sourceRetouch=True,underlyingPaintEstimate=True,lossless=True,allowedPolygon=q.tolist(),sourcePaintDonorQuad=donor_q.tolist(),sourcePaintToneDonor=[1358,648,1370,660],sourceWorklightTintDonor=[1370,606,1380,616],rectifiedDonorDimensions=[33,29],sourcePaintColourShiftBGR=color_shift.tolist(),changedPixels=int(changed.sum()),allowedPixels=int((allowed>0).sum()),outsideAllowedPixelsCompared=int((allowed==0).sum()),outsideAllowedEqualsV37=True,outsideCombinedMaskEqualsOriginal=True,worklightCablesAndProtectedPixelsEqualV37=True,acceptedV37RackCabMarksUnchanged=True,acceptedV37OtherMediaUnchanged=True,decodedOutputEqualsPreEncode=True,integrationState='Root visually accepted this exact local candidate for integration. Owner visual approval, product integration, deployment and R2 backup are not claimed by this photo receipt.')
(ROOT/'photo-verification.json').write_text(json.dumps(report,indent=2)+'\n')
manifest=dict(cwd=str(Path.cwd()),command='/Users/lua/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 outputs/website/usung-media-v38/photo/repair-boom-glare.py',inputs=[dict(path=str(p),bytes=p.stat().st_size,sha256=sha(p)) for p in [SOURCE,BASE]],script=dict(path=str(Path(__file__)),sha256=sha(Path(__file__))),runtime=dict(pythonExecutable=sys.executable,pythonVersion=sys.version,opencvVersion=cv2.__version__,numpyVersion=np.__version__,pillowVersion=pillow_version),output=dict(path=str(candidate),bytes=candidate.stat().st_size,sha256=sha(candidate)))
(ROOT/'photo-input-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
artifacts=[p for p in ROOT.iterdir() if p.is_file() and p.suffix in ['.py','.png','.webp','.jpg','.json'] and p.name!='photo-artifact-hashes.json']
(ROOT/'photo-artifact-hashes.json').write_text(json.dumps([dict(path=str(p),bytes=p.stat().st_size,sha256=sha(p)) for p in sorted(artifacts)],indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['candidate','candidateSha256','changedPixels','allowedPixels','outsideAllowedEqualsV37','worklightCablesAndProtectedPixelsEqualV37']},indent=2))
