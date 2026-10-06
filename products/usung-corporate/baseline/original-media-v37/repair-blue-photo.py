from pathlib import Path
import sys, json, hashlib
sys.path.insert(0, 'outputs/website/usung-reference-branding-v22/tools')
import cv2, numpy as np
from PIL import Image, ImageDraw

ROOT = Path('products/usung-corporate/baseline/original-media-v37')
MEDIA = Path('products/usung-corporate/public/assets/media')
SOURCE = MEDIA/'built-sunrise.jpg'
BASE = MEDIA/'usung-site-dawn-v34.webp'
NATIVE = Path('products/usung-corporate/baseline/original-media-v36/canonical-transparent-wordmark.png')
src = cv2.imread(str(SOURCE)); base = cv2.imread(str(BASE)); out = base.copy()
allowed = np.zeros(base.shape[:2], np.uint8)
word = cv2.imread(str(NATIVE), cv2.IMREAD_UNCHANGED)
wy, wx = np.where(word[:,:,3] > 0)
word = word[wy.min():wy.max()+1, wx.min():wx.max()+1].copy()
# The canonical paths remain unchanged. White paint replaces the dark pigment
# used for the helmet decal; the native first-U pink pixels remain #FF0F6F.
pink = (word[:,:,2] > 100) & (word[:,:,2] > word[:,:,0]*1.5)
word[:,:,:3][~pink] = 255
cv2.imwrite(str(ROOT/'canonical-white-wordmark.png'),word)

def linear(x):
    x=np.asarray(x,np.float32)/255
    return np.where(x<=.04045,x/12.92,((x+.055)/1.055)**2.4)
def srgb(x):
    x=np.clip(x,0,1)
    return np.where(x<=.0031308,x*12.92,1.055*x**(1/2.4)-.055)*255
def mask(q):
    m=np.zeros(base.shape[:2],np.uint8)
    cv2.fillPoly(m,[np.round(q).astype(np.int32)],255)
    return m
def warp_to_rect(im,q,shape):
    w,h=shape
    H=cv2.getPerspectiveTransform(np.float32(q),np.float32([[0,0],[w-1,0],[w-1,h-1],[0,h-1]]))
    return cv2.warpPerspective(im,H,(w,h),flags=cv2.INTER_CUBIC),H

# Worn metal and reflected blue light are present in the official source, not
# caused by the v34 edit. Repair only this complained lower rack-plate face.
# The donor is the adjacent upper face of the same grooved blue metal panel.
# Uprights, seams, basket slots and all other photograph pixels stay unchanged.
rack_q=np.float32([[1028.0,1068.5],[1098.8,1080.1],[1097.6,1095.0],[1026.8,1083.3]])
donor_q=np.float32([[1030.0,1050.0],[1100.5,1061.5],[1099.3,1075.8],[1028.7,1064.3]])
rack, H=warp_to_rect(base,rack_q,(213,45))
donor, DH=warp_to_rect(src,donor_q,(213,45))
# Retain the photographed donor's horizontal grooves and grain. The broad light
# response follows measured same-metal blue samples; no synthetic/random grain.
donor_f=donor.astype(np.float32)
low=cv2.GaussianBlur(donor_f,(0,0),5)
detail=donor_f-low
yy,xx=np.mgrid[:45,:213].astype(np.float32)
u=xx/212;v=yy/44
X=np.stack([np.ones_like(u),u,v,u*v,u*u,v*v],-1)
coef=np.linalg.lstsq(X.reshape(-1,6),low.reshape(-1,3),rcond=None)[0]
illum=X@coef
# The lower face's unscuffed rim constrains its lower overall brightness.
clean_rack=np.clip(illum*.93+detail*.72,0,255)
# Avoid an abrupt replacement boundary; a narrow physical face margin remains
# original and the interior takes the same photographed metal donor treatment.
d=np.minimum.reduce([xx,212-xx,yy,44-yy])
feather=np.clip(d/4,0,1)
clean_rack=rack*(1-feather[:,:,None])+clean_rack*feather[:,:,None]
delta=cv2.warpPerspective((clean_rack-rack).astype(np.float32),np.linalg.inv(H),(base.shape[1],base.shape[0]),flags=cv2.INTER_CUBIC)
rack_mask=mask(rack_q)
out[rack_mask>0]=np.rint(base[rack_mask>0].astype(np.float32)+delta[rack_mask>0]).clip(0,255).astype(np.uint8)
allowed|=rack_mask
cv2.imwrite(str(ROOT/'rack-surface-retouch-mask.png'),rack_mask)

records=[]
jobs=[
    dict(name='rack',q=[[1033.7,1071.0],[1092.0,1080.5],[1091.7,1092.6],[1033.4,1083.1]],sigma=.62,white=[184,145,88],mask=rack_mask),
    dict(name='cab-strip',q=[[1375.5,1095.7],[1414.2,1095.5],[1414.2,1103.6],[1375.5,1103.8]],sigma=.54,white=[151,124,76],erase=[[1375,1093],[1418,1093],[1418,1106],[1375,1106]])
]
for j in jobs:
    before=out.copy()
    q=np.float32(j['q'])
    if 'erase' in j:
        area=mask(j['erase'])
        # Exact original ARTEMIS print footprint. Inpaint only its pigment,
        # retaining the plate, screws and photographed shade outside lettering.
        roi=(slice(1088,1110),slice(1368,1426))
        p=out[roi].copy();a=area[roi]
        b,g,r=cv2.split(p.astype(np.float32))
        ink=((a>0)&(g>85)&(r>43)).astype(np.uint8)*255
        ink=cv2.dilate(ink,np.ones((3,3),np.uint8))&a
        p=cv2.inpaint(p,ink,2.2,cv2.INPAINT_NS)
        out[roi]=p
        pigmentmask=np.zeros_like(allowed);pigmentmask[roi]=ink
    else:
        area=j['mask'];pigmentmask=np.zeros_like(allowed)
    h,w=word.shape[:2]
    W=cv2.getPerspectiveTransform(np.float32([[0,0],[w-1,0],[w-1,h-1],[0,h-1]]),q)
    alpha=word[:,:,3].astype(np.float32)/255
    pigment=linear(word[:,:,:3])
    pa=cv2.warpPerspective(alpha,W,(base.shape[1],base.shape[0]),flags=cv2.INTER_CUBIC)
    pc=cv2.warpPerspective(pigment*alpha[:,:,None],W,(base.shape[1],base.shape[0]),flags=cv2.INTER_CUBIC)
    pa=np.clip(pa,0,1);pc=np.clip(pc,0,1)
    native=pc/np.maximum(pa[:,:,None],1e-6)
    # Shared source-derived blue LED/twilight illumination affects both native
    # pigments. Surface white is measured from actual source print/reflection.
    white=linear(np.float32(j['white']))
    local=cv2.GaussianBlur(out.astype(np.float32),(0,0),2.0)
    local_luma=linear(local).mean(axis=2)
    ys,xs=np.where(area>0)
    center=np.median(local_luma[area>0])
    light=np.clip(local_luma/max(center,1e-5),.86,1.14)
    radiance=native*white[None,None,:]*light[:,:,None]
    # Small measured blue clear-coat reflection is shared by pink/white. This
    # prevents a flat screen-pink block floating over the twilight photograph.
    radiance+=np.array([.005,.0015,.0005],np.float32)[None,None,:]
    grain=out.astype(np.float32)-cv2.GaussianBlur(out.astype(np.float32),(0,0),.65)
    radiance+=grain*.10/255
    premul=cv2.GaussianBlur(radiance*pa[:,:,None],(0,0),j['sigma'])
    coverage=cv2.GaussianBlur(pa,(0,0),j['sigma'])
    printmask=(coverage>1e-4).astype(np.uint8)*255
    printmask&=area
    combined=printmask|pigmentmask
    result=np.rint(srgb(linear(out)*(1-coverage[:,:,None])+premul)).clip(0,255).astype(np.uint8)
    out[printmask>0]=result[printmask>0]
    allowed|=combined
    cv2.imwrite(str(ROOT/(j['name']+'-print-mask.png')),printmask)
    cv2.imwrite(str(ROOT/(j['name']+'-old-pigment-mask.png')),pigmentmask)
    records.append(dict(name=j['name'],projectedCorners=j['q'],lensSigmaPx=j['sigma'],whiteSourceBGR=j['white'],printPixels=int((printmask>0).sum()),oldPigmentPixels=int((pigmentmask>0).sum())))

candidate=ROOT/'usung-site-dawn-v37.webp'
cv2.imwrite(str(candidate),out,[cv2.IMWRITE_WEBP_QUALITY,101])
saved=cv2.imread(str(candidate));assert np.array_equal(saved,out)
assert np.array_equal(out[allowed==0],base[allowed==0])
prior=(np.any(src!=base,axis=2)).astype(np.uint8)*255
combined=allowed|prior
assert np.array_equal(out[combined==0],src[combined==0])
cv2.imwrite(str(ROOT/'photo-change-mask.png'),np.any(out!=base,axis=2).astype(np.uint8)*255)
cv2.imwrite(str(ROOT/'photo-allowed-mask.png'),allowed)
cv2.imwrite(str(ROOT/'combined-source-retouch-mask.png'),combined)
cv2.imwrite(str(ROOT/'usung-site-dawn-v37-preview.jpg'),cv2.resize(out,(1600,1066)))
for name,b in [('rack',(1008,1042,1120,1113)),('cab-strip',(1340,1083,1445,1120)),('context',(900,990,1470,1140))]:
    crops=[Image.fromarray(cv2.cvtColor(im[b[1]:b[3],b[0]:b[2]],cv2.COLOR_BGR2RGB)) for im in [src,base,out]]
    scale=4 if name!='context' else 2
    width,height=crops[0].size
    canvas=Image.new('RGB',(width*scale*3,height*scale+27),(22,22,22));draw=ImageDraw.Draw(canvas)
    for i,(label,crop) in enumerate(zip(['original camera source','current v34','candidate v37'],crops)):
        draw.text((i*width*scale+8,7),label,fill='white')
        canvas.paste(crop.resize((width*scale,height*scale),Image.Resampling.LANCZOS),(i*width*scale,27))
    canvas.save(ROOT/(name+'-before-after.png'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
remote=ROOT/'official-sunrise-original-0261.jpg'
report=dict(source=str(SOURCE),sourceSha256=sha(SOURCE),baseline=str(BASE),baselineSha256=sha(BASE),candidate=str(candidate),candidateSha256=sha(candidate),dimensions=[out.shape[1],out.shape[0]],canonicalVector='products/usung-corporate/src/brand.mjs',canonicalRaster=str(NATIVE),canonicalRasterSha256=sha(NATIVE),nativePink='#FF0F6F',variant='B',wordmark='USUNG',noGeneration=True,lossless=True,changedPixels=int(np.any(base!=out,axis=2).sum()),outsideAllowedEqualsBaseline=True,outsideCombinedMaskEqualsSource=True,existingEdgeClippedUUnchanged=True,method='Local source-photo retouch of complained rack-face reflection/wear, using adjacent same-metal donor grooves/grain; full native B USUNG wordmark with planar projection, shared measured source twilight/LED illumination and lens focus; original ARTEMIS cab-strip print removed in its measured pigment footprint and replaced by full native B USUNG.',claimBoundary='Rear pale streak is a photographed worn/reflected metal surface, not an established former brand or prior edit; local rack retouch is disclosed. No scene generation. Plane and illumination estimates are not calibrated camera geometry.',sourceOfficialUrl='https://assets.builtrobotics.com/production/public/download/2024_01_26_BUILT_0261.jpg',officialSourceRetrieved='2026-10-05',officialOriginalDimensions=list(Image.open(remote).size),officialOriginalSha256=sha(remote),repairs=records)
(ROOT/'photo-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['candidate','candidateSha256','changedPixels','outsideAllowedEqualsBaseline','outsideCombinedMaskEqualsSource']},indent=2))
