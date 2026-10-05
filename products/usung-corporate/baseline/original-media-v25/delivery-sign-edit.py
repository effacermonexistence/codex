import sys,json
from pathlib import Path
sys.path.insert(0,'outputs/website/usung-reference-branding-v22/tools')
import cv2,numpy as np
P=Path('outputs/website/usung-rework-v25/source-candidates');D=Path('outputs/website/usung-rework-v25/video-diagnosis/candidate');Hlist=json.loads((D/'sign-H-refined.json').read_text())['matrices']
logo=cv2.imread('outputs/website/usung-reference-branding-v22/audit/approved-usung-wordmark.png',-1);yy,xx=np.where(logo[:,:,3]>0);logo=logo[yy.min():yy.max()+1,xx.min():xx.max()+1]
W=1600;HE=920;yy,xx=np.mgrid[:HE,:W];nx=xx/W;ny=yy/HE;X=np.stack([np.ones_like(nx),nx,ny,nx*ny,nx*nx,ny*ny],-1)
upper=np.zeros((HE,W),bool);upper[75:432,245:1460]=True
lower=np.zeros((HE,W),bool);lower[670:819,69:636]=True
areas=[upper,lower]
fits=[(270,152,1110),(98,687,502)]
whiterings=[]
for k,area in enumerate(areas):
 ring=cv2.dilate(area.astype(np.uint8),np.ones((61,61),np.uint8))>0;ring &= ~area
 if k==0:ring[450:]=False;ring[:55]=False;ring[:,:30]=False;ring[:,1570:]=False
 else:ring[:658]=False;ring[850:]=False;ring[:,642:]=False;ring[:,:30]=False
 whiterings.append(ring)

def fit_bg(im,valid,k):
 m=whiterings[k]&valid
 # Robust smooth illumination fit from the adjacent unprinted substrate.
 for _ in range(3):
  coeff=np.linalg.lstsq(X[m],im[m].astype(float),rcond=None)[0];bg=np.clip(X@coeff,0,255)
  residual=np.mean(im.astype(float)-bg,2);m=whiterings[k]&valid&(residual>-5)&(residual<5)
  if m.sum()<500:break
 return bg

def sign_edit(src,i):
 H=np.asarray(Hlist[i]);plane=cv2.warpPerspective(src,H,(W,HE));valid=cv2.warpPerspective(np.ones(src.shape[:2],np.uint8)*255,H,(W,HE))>250;edited=plane.astype(float).copy();total=np.zeros((HE,W),float);stats=[]
 for k,area in enumerate(areas):
  if (area&valid).sum()<150:continue
  bg=fit_bg(plane,valid,k);delta=bg-plane;contrast=np.mean(delta,2)
  old=(contrast>5)&area&valid;inkalpha=cv2.GaussianBlur(cv2.dilate(old.astype(np.float32),np.ones((5,5),np.uint8)),(0,0),.75);inkalpha*=area&valid
  core=(contrast>15)&area&valid
  if core.sum()>100:inkdelta=np.median(delta[core],axis=0)
  else:inkdelta=np.array([30,30,30])
  inkdelta=np.clip(inkdelta,10,85)
  # Preserve local real grain while replacing old letter pigment only.
  grain=plane.astype(float)-cv2.GaussianBlur(plane,(0,0),1.2).astype(float)
  cleaned=plane*(1-inkalpha[:,:,None])+(bg+np.roll(grain,18,axis=1)*.2)*inkalpha[:,:,None]
  lx,ly,lw=fits[k];lh=round(lw*logo.shape[0]/logo.shape[1]);glyph=cv2.resize(logo,(lw,lh),interpolation=cv2.INTER_AREA);insert=np.zeros((HE,W,4),np.uint8);insert[ly:ly+lh,lx:lx+lw]=glyph
  # Photographic lens defocus carried into printed glyph; no fresh vector edges.
  a=cv2.GaussianBlur(insert[:,:,3].astype(float)/255,(0,0),1.9 if k==0 else 1.25);a*=valid
  dye=bg-inkdelta[None,None,:]
  pink=(insert[:,:,2]>insert[:,:,0]*1.5)&(insert[:,:,2]>60);pink=cv2.GaussianBlur(pink.astype(float),(0,0),1.5)
  transmission=float(np.mean(inkdelta)/215);pinkdye=bg-transmission*(255-np.array([111,15,255]))
  dye=dye*(1-pink[:,:,None])+pinkdye*pink[:,:,None]
  dye+=grain*.18
  result=cleaned*(1-a[:,:,None])+dye*a[:,:,None]
  # Exact zero outside old company pigment and replacement pigment.
  support=(inkalpha>.001)|(a>.001);edited[support]=result[support];total[support]=1
  stats.append({'part':k,'sourceInkContrastBGR':inkdelta.tolist(),'transmission':transmission,'reconstructedPixels':int(old.sum())})
 correction=(edited-plane).astype(np.float32);back=cv2.warpPerspective(correction,np.linalg.inv(H),(src.shape[1],src.shape[0]),flags=cv2.INTER_LINEAR);mask=cv2.warpPerspective(total,np.linalg.inv(H),(src.shape[1],src.shape[0]),flags=cv2.INTER_LINEAR)>0
 out=src.copy();out[mask]=np.clip(src[mask].astype(float)+back[mask],0,255).astype(np.uint8)
 assert np.array_equal(src[~mask],out[~mask])
 return out,stats
if __name__=='__main__':
 c=cv2.VideoCapture(str(P/'turner-jobsite-01.mp4'))
 for i in [0,24,48,72,96,119]:
  c.set(1,i);ok,f=c.read();o,st=sign_edit(f,i);cv2.imwrite(str(D/f'sign-edit-{i}.jpg'),cv2.resize(o,(1920,1080)),[cv2.IMWRITE_JPEG_QUALITY,96]);cv2.imwrite(str(D/f'sign-edited-plane-{i}.jpg'),cv2.warpPerspective(o,np.asarray(Hlist[i]),(W,HE)),[cv2.IMWRITE_JPEG_QUALITY,97]);print(i,st,flush=True)
 c.release()
