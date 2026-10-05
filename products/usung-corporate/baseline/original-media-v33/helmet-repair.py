from pathlib import Path
import sys, re, json, hashlib
sys.path.insert(0, 'outputs/website/usung-reference-branding-v22/tools')
import cv2, numpy as np
from PIL import Image, ImageDraw

P=Path('products/usung-corporate/public/assets/media')
R=Path('outputs/website/usung-surface-branding-v33'); A=R/'audit'; D=R/'edited'
A.mkdir(parents=True, exist_ok=True); D.mkdir(parents=True, exist_ok=True)
src=cv2.imread(str(P/'suffolk-naples.jpg'))
base=cv2.imread(str(P/'usung-field-team-v26.webp')); out=base.copy()

# Sample the approved vector, including its clipped pink corner. No icon tile.
brand=Path('products/usung-corporate/src/brand.mjs').read_text()
path=re.search(r'const firstU = "([^"]+)"',brand).group(1)
t=re.findall(r'[MLHVQZ]|-?\d+(?:\.\d+)?',path); pts=[]; i=0; cur=np.zeros(2)
while i<len(t):
 cmd=t[i]; i+=1
 if cmd in ('M','L'):
  cur=np.array([float(t[i]),float(t[i+1])]); i+=2; pts.append(cur.copy())
 elif cmd in ('H','V'):
  cur[0 if cmd=='H' else 1]=float(t[i]); i+=1; pts.append(cur.copy())
 elif cmd=='Q':
  ctrl=np.array([float(t[i]),float(t[i+1])]); end=np.array([float(t[i+2]),float(t[i+3])]); i+=4
  for f in np.linspace(0,1,50)[1:]: pts.append((1-f)**2*cur+2*(1-f)*f*ctrl+f*f*end)
  cur=end
 elif cmd=='Z': break
pts=np.array(pts); origin=np.array([34.478,23.172]); extent=np.array([53.874,63.55]); scale=10
w,h=np.ceil(extent*scale).astype(int); glyph=np.zeros((h,w),np.uint8)
cv2.fillPoly(glyph,[np.rint((pts-origin)*scale).astype(np.int32)],255)
logo=np.zeros((h,w,4),np.uint8); logo[:,:,:3]=[22,22,21]; logo[:,:,3]=glyph
yy,xx=np.mgrid[:h,:w]; px=xx/scale+origin[0]; py=yy/scale+origin[1]
pink=(px>=72.362)&(px<88.452)&(py>=23.072)&(py<39.059)&(glyph>0)
logo[pink,:3]=[111,15,255]
cv2.imwrite(str(A/'canonical-transparent-u.png'),logo)

# Patch coordinates are estimated from the original photographed decal and helmet
# rim directions, not a claim of camera calibration. The small curved mapping is
# confined to the two printed surfaces; faces and helmet hardware stay unchanged.
jobs=[
 dict(name='man',box=[746,204,949,356],old=[[771,216],[829,230],[870,251],[902,282],[939,349],[919,334],[885,304],[788,271]],quad=[[801,226],[840,235],[854,282],[814,273]],sigma=1.05,bow=1.0,donor=[696,236,748,292]),
 dict(name='woman',box=[1424,174,1592,274],old=[[1438,187],[1490,187],[1520,201],[1549,223],[1580,269],[1553,255],[1524,244],[1458,231]],quad=[[1461,190],[1494,194],[1509,231],[1476,227]],sigma=1.0,bow=.8,donor=[1350,198,1416,252])]
allowed=np.zeros(base.shape[:2],np.uint8); records=[]
for j in jobs:
 x0,y0,x1,y1=j['box']; s=base[y0:y1,x0:x1].copy(); ph,pw=s.shape[:2]
 area=np.zeros((ph,pw),np.uint8); cv2.fillPoly(area,[np.int32(j['old'])-[x0,y0]],255)
 g=cv2.cvtColor(s,cv2.COLOR_BGR2GRAY); hsv=cv2.cvtColor(s,cv2.COLOR_BGR2HSV)
 ink=((area>0)&((g<171)|(hsv[:,:,1]>43))).astype(np.uint8)*255
 ink=cv2.dilate(ink,np.ones((7,7),np.uint8))&area
 clean=cv2.inpaint(s,ink,5,cv2.INPAINT_NS)
 # Preserve the current photographed illumination instead of painting a white tile.
 q=np.float32(np.float32(j['quad'])-[x0,y0])
 H=cv2.getPerspectiveTransform(np.float32([[0,0],[w-1,0],[w-1,h-1],[0,h-1]]),q)
 iy,ix=np.mgrid[:ph,:pw].astype(np.float32)
 inv=np.linalg.inv(H); coord=inv@np.stack([ix.ravel(),iy.ravel(),np.ones(ph*pw)],0)
 u=(coord[0]/coord[2]).reshape(ph,pw); v=(coord[1]/coord[2]).reshape(ph,pw)
 un=u/(w-1)
 # A subpixel projected helmet bow. It deforms color and alpha together.
 v-=j['bow']*h/np.linalg.norm(q[3]-q[0])*np.clip(4*un*(1-un),0,1)
 alpha=logo[:,:,3].astype(np.float32)/255
 premul=logo[:,:,:3].astype(np.float32)*alpha[:,:,None]
 wa=cv2.remap(alpha,u.astype(np.float32),v.astype(np.float32),cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
 wc=cv2.remap(premul,u.astype(np.float32),v.astype(np.float32),cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT)
 wa=cv2.GaussianBlur(np.clip(wa,0,1),(0,0),j['sigma'])
 wc=cv2.GaussianBlur(wc,(0,0),j['sigma'])
 color=wc/np.maximum(wa[:,:,None],1e-6)
 surface=cv2.GaussianBlur(cv2.cvtColor(clean,cv2.COLOR_BGR2GRAY).astype(np.float32),(0,0),2)
 # Both ink colors receive the same local light and the same photographed grain.
 light=np.clip(surface/245,.88,1.04)
 dx0,dy0,dx1,dy1=j['donor']; donor=src[dy0:dy1,dx0:dx1].astype(np.float32)
 grain=cv2.resize(donor-cv2.GaussianBlur(donor,(0,0),1.2),(pw,ph),interpolation=cv2.INTER_CUBIC)
 paint=np.clip(color*light[:,:,None]*.92+clean.astype(np.float32)*.08+grain*.13,0,255)
 new=np.rint(clean*(1-wa[:,:,None])+paint*wa[:,:,None]).clip(0,255).astype(np.uint8)
 support=((ink>0)|(wa>1/65535))&(area>0)
 out[y0:y1,x0:x1][support]=new[support]; allowed[y0:y1,x0:x1][support]=255
 records.append(dict(name=j['name'],quad=j['quad'],focusSigma=j['sigma'],projectedCurveBowPx=j['bow'],changedPixels=int(np.any(new[support]!=s[support],axis=1).sum())))
# The two tiny secondary prints keep their existing material, pose and dimensions.
# Correct just the approved pink corner, using that print's existing focus and light.
secondary=[dict(name='vest-corner',quad=[[894,1256],[908,1263],[918,1286],[904,1279]],kind='u',sigma=1.2,ink=176.),dict(name='sticker-corner',quad=[[1160,264],[1206,244],[1206,253],[1160,273]],kind='wordmark',sigma=.8,ink=204.)]
for j in secondary:
 q=np.float32(j['quad']); x0=max(0,int(q[:,0].min())-8);x1=int(q[:,0].max())+9;y0=int(q[:,1].min())-8;y1=int(q[:,1].max())+9
 ph,pw=y1-y0,x1-x0; local=q-np.float32([x0,y0])
 # Full wordmark bounding box includes the S/U/N/G, though only first-U pixels edit.
 o=origin if j['kind']=='u' else np.array([34.478,21.45]); e=extent if j['kind']=='u' else np.array([314.526,65.272])
 sw,sh=np.ceil(e*10).astype(int); mask=np.zeros((sh,sw),np.uint8)
 shifted=(pts-o)*10;cv2.fillPoly(mask,[np.rint(shifted).astype(np.int32)],255)
 sy,sx=np.mgrid[:sh,:sw]; gx=sx/10+o[0];gy=sy/10+o[1]
 mask[((gx<72.362)|(gx>=88.452)|(gy<23.072)|(gy>=39.059))]=0
 HH=cv2.getPerspectiveTransform(np.float32([[0,0],[sw-1,0],[sw-1,sh-1],[0,sh-1]]),local)
 p=cv2.warpPerspective(mask.astype(np.float32)/255,HH,(pw,ph),flags=cv2.INTER_CUBIC)
 p=cv2.GaussianBlur(np.clip(p,0,1),(0,0),j['sigma'])
 s=out[y0:y1,x0:x1].copy();support=p>1/65535
 # The small printed color shares the original illumination. No separate pink mask blur.
 reflected=j['ink']*np.array([111/255,15/255,1.0],np.float32)
 value=np.rint(s*(1-p[:,:,None])+reflected[None,None,:]*p[:,:,None]).clip(0,255).astype(np.uint8)
 out[y0:y1,x0:x1][support]=value[support];allowed[y0:y1,x0:x1][support]=255
 records.append(dict(name=j['name'],quad=j['quad'],variant='B',focusSigma=j['sigma'],cornerOnly=True,changedPixels=int(np.any(value[support]!=s[support],axis=1).sum())))
cv2.imwrite(str(A/'helmet-change-mask.png'),allowed)
target=D/'usung-field-team-v33.webp'; cv2.imwrite(str(target),out,[cv2.IMWRITE_WEBP_QUALITY,101])
decoded=cv2.imread(str(target)); assert np.array_equal(decoded,out)
change=np.any(out!=base,axis=2); assert not change[allowed==0].any()
for name,box in [('man',(730,185,965,405)),('woman',(1410,160,1630,315))]:
 a,b,c,d=box; ww,hh=c-a,d-b
 comp=Image.new('RGB',(ww*3,hh+24),'white'); draw=ImageDraw.Draw(comp)
 for i,(im,label) in enumerate([(src,'ORIGINAL'),(base,'PREVIOUS'),(out,'CORRECTED')]):
  comp.paste(Image.fromarray(cv2.cvtColor(im[b:d,a:c],cv2.COLOR_BGR2RGB)),(i*ww,24)); draw.text((i*ww+5,5),label,fill='black')
 comp.resize((comp.width*3,comp.height*3),Image.Resampling.BICUBIC).save(A/f'{name}-comparison.png')
Image.fromarray(cv2.cvtColor(out,cv2.COLOR_BGR2RGB)).resize((1100,733),Image.Resampling.LANCZOS).save(A/'helmet-full-review.jpg')
protected={}
for name,(a,b,c,d) in {'sticker-lower-fields':(1148,276,1216,282),'hardware':(840,135,913,220),'faces':(600,415,1570,730)}.items():
 protected[name]=bool(np.array_equal(out[b:d,a:c],base[b:d,a:c])); assert protected[name]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
report=dict(source=str(P/'suffolk-naples.jpg'),sourceSha256=sha(P/'suffolk-naples.jpg'),baseline=str(P/'usung-field-team-v26.webp'),baselineSha256=sha(P/'usung-field-team-v26.webp'),output=str(target),outputSha256=sha(target),dimensions=[2200,1466],nativeVector='products/usung-corporate/src/brand.mjs:firstU',nativeAspect=float(extent[0]/extent[1]),nativePink='#FF0F6F',repair='Canonical vector alpha and color projected together onto estimated local helmet surfaces, one focus filter, shared illumination and original-photo grain. Deterministic interpolation only in former print regions.',noSceneGeneration=True,changedPixels=int(change.sum()),outsideRepairMaskEqualsBaseline=True,protected=protected,repairs=records)
(A/'helmet-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
