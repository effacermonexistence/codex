"""Move pigment on the accepted photographed substrate, without repainting it."""
import sys,json
from pathlib import Path
sys.path.insert(0,'outputs/website/usung-reference-branding-v22/tools')
import cv2,numpy as np
P=Path(__file__).resolve().parent
RECIPE=P/'dependencies/delivery-sign-edit-v25.py'
text=RECIPE.read_text().split("if __name__=='__main__':")[0]
text=text.replace("(D/'sign-H-refined.json')","(Path(__REFINED__))")
text=text.replace("cv2.imread('outputs/website/usung-reference-branding-v22/audit/approved-usung-wordmark.png',-1)","cv2.imread(__LOGO_A__,-1)")
text=text.replace('total=np.zeros((HE,W),float);stats=[]','total=np.zeros((HE,W),float);stats=[];paint_delta=np.zeros((HE,W,3),float)')
text=text.replace('result=cleaned*(1-a[:,:,None])+dye*a[:,:,None]',
  'result=cleaned*(1-a[:,:,None])+dye*a[:,:,None]\n  paint_delta += (dye-cleaned)*a[:,:,None]*(a>.001)[:,:,None]')
text=text.replace('return out,stats',
  'paint_back=cv2.warpPerspective(paint_delta.astype(np.float32),np.linalg.inv(H),(src.shape[1],src.shape[0]),flags=cv2.INTER_LINEAR)\n return paint_back,stats')
ns={'__name__':'old_pigment_operator','__REFINED__':str(P/'dependencies/sign-H-refined.json'),'__LOGO_A__':str(P/'dependencies/approved-usung-wordmark-A.png')};exec(text,ns)
logo=cv2.imread(str(P/'dependencies/canonical-transparent-wordmark-B.png'),-1)
yy,xx=np.where(logo[:,:,3]>0);logo=logo[yy.min():yy.max()+1,xx.min():xx.max()+1];ns['logo']=logo
track=json.loads((P/'stable-sign-plane.json').read_text())
fields=[]
for k,(lx,ly,lw) in enumerate(ns['fits']):
 lh=round(lw*logo.shape[0]/logo.shape[1]);glyph=cv2.resize(logo,(lw,lh),interpolation=cv2.INTER_AREA)
 ins=np.zeros((ns['HE'],ns['W'],4),np.uint8);ins[ly:ly+lh,lx:lx+lw]=glyph
 a=cv2.GaussianBlur(ins[:,:,3].astype(float)/255,(0,0),1.9 if k==0 else 1.25)
 pink=cv2.GaussianBlur(((ins[:,:,2]>ins[:,:,0]*1.5)&(ins[:,:,2]>60)).astype(float),(0,0),1.5)
 fields.append((a,pink))

def correct(src,current,i):
 oldnative,stats=ns['sign_edit'](src,i)
 oldprint=cv2.resize(oldnative,(1920,1080),interpolation=cv2.INTER_AREA)
 # Recover the current sign substrate by subtracting only the previous ink's
 # source-measured print operation. This retains the accepted cleanup/light.
 clean=current.astype(np.float32)-oldprint
 H=np.array(track['matrices'][i])@np.diag([2.,2.,1.])
 valid=cv2.warpPerspective(np.ones((1080,1920),np.uint8)*255,H,(ns['W'],ns['HE']))>250
 newplane=np.zeros((ns['HE'],ns['W'],3),np.float32)
 for st in stats:
  k=st['part'];ink=np.array(st['sourceInkContrastBGR']);a,pink=fields[k]
  pigment=-ink[None,None,:]*(1-pink[:,:,None])-st['transmission']*(255-np.array([111,15,255]))[None,None,:]*pink[:,:,None]
  newplane+=(pigment*a[:,:,None]*((a>.001)&valid)[:,:,None]).astype(np.float32)
 # Subtractive paint cannot create a bright tile or an exterior white outline.
 assert float(newplane.max())<=1e-6
 newprint=cv2.warpPerspective(newplane,np.linalg.inv(H),(1920,1080),flags=cv2.INTER_LINEAR)
 mask=(np.any(abs(oldprint)>.001,axis=2)|np.any(abs(newprint)>.001,axis=2))
 out=current.copy();out[mask]=np.clip(np.rint(clean[mask]+newprint[mask]),0,255).astype(np.uint8)
 assert np.array_equal(out[~mask],current[~mask])
 return out,mask,stats,oldprint,newprint

if __name__=='__main__':
 source=cv2.VideoCapture('products/usung-corporate/baseline/original-media-v25/turner-jobsite-01.mp4')
 current=cv2.VideoCapture(str(P/'dependencies/accepted-delivery-v33.mp4'))
 rows=[]
 for i in [0,24,30,84,96,119]:
  source.set(1,i);ok,src=source.read();current.set(1,i);ok2,cur=current.read();assert ok and ok2
  out,mask,stats,oldprint,newprint=correct(src,cur,i)
  cv2.imwrite(str(P/f'corrected-pigment-{i:03d}.png'),out)
  ys,xs=np.where(mask);x0=max(0,xs.min()-20);x1=min(1920,xs.max()+21);y0=max(0,ys.min()-20);y1=min(1080,ys.max()+21)
  pair=np.hstack([cur[y0:y1,x0:x1],out[y0:y1,x0:x1]])
  cv2.imwrite(str(P/f'corrected-pigment-crop-{i:03d}.png'),pair)
  row=np.hstack([cv2.resize(cur,(640,360)),cv2.resize(out,(640,360))]);cv2.putText(row,f'CURRENT / FIXEDTRACK AND PIGMENT ONLY #{i}',(8,25),0,.65,(0,0,255),2);rows.append(row)
 cv2.imwrite(str(P/'corrected-pigment-preview-contact.jpg'),np.vstack(rows))
 source.release();current.release()
