import sys,json
from pathlib import Path
sys.path.insert(0,'outputs/website/usung-reference-branding-v22/tools')
import cv2,numpy as np
P=Path(__file__).resolve().parent
source=Path('products/usung-corporate/baseline/original-media-v25/turner-jobsite-01.mp4')
raw=json.loads((P/'dependencies/sign-track.json').read_text())
c=cv2.VideoCapture(str(source));gray=[]
for i in range(120):
 ok,f=c.read();assert ok
 gray.append(cv2.cvtColor(cv2.resize(f,(1920,1080),interpolation=cv2.INTER_AREA),cv2.COLOR_BGR2GRAY))
c.release()
refq=np.float32(raw['quads']['119'])*.5
ref_to_plane=cv2.getPerspectiveTransform(refq,np.float32([[0,0],[1600,0],[1600,480],[0,480]]))
plane_to_ref=np.linalg.inv(ref_to_plane)
# Features exclusively in the original printed sign substrate. The fence and
# its independent texture are excluded. A fixed feature set persists throughout.
maskplane=np.zeros((920,1600),np.uint8);maskplane[16:450,20:1580]=255
mask=cv2.warpPerspective(maskplane,plane_to_ref,(1920,1080),flags=cv2.INTER_NEAREST)
pts=cv2.goodFeaturesToTrack(gray[119],1200,.003,3,mask=mask)
reference=pts.copy();tracked=pts.copy();active=np.ones(len(pts),bool)
tracks={119:tracked.copy()};valid={119:active.copy()};quality=[]
for i in range(118,-1,-1):
 ids=np.where(active)[0]
 pred,st,e=cv2.calcOpticalFlowPyrLK(gray[i+1],gray[i],tracked[ids],None,winSize=(31,31),maxLevel=4,
     criteria=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,40,.001))
 back,bst,_=cv2.calcOpticalFlowPyrLK(gray[i],gray[i+1],pred,None,winSize=(31,31),maxLevel=4,
     criteria=(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_COUNT,40,.001))
 good=(st[:,0]>0)&(bst[:,0]>0)&(np.linalg.norm(back-tracked[ids],axis=2)[:,0]<.35)
 good&=(pred[:,0,0]>=0)&(pred[:,0,0]<1920)&(pred[:,0,1]>=0)&(pred[:,0,1]<1080)
 active[ids[~good]]=False;tracked[ids[good]]=pred[good]
 tracks[i]=tracked.copy();valid[i]=active.copy()
print('Fixed physicalsign features',len(pts),'surviveframe0',int(active.sum()),flush=True)
common=np.where(active)[0]
assert len(common)>=30
print('Shared sourcepoint spread',np.ptp(reference[common,0,:],axis=0).tolist(),flush=True)
quads=[];metrics=[];transforms=[]
for i in range(120):
 ids=common
 A,inliers=cv2.estimateAffine2D(reference[ids],tracks[i][ids],method=cv2.RANSAC,ransacReprojThreshold=.75,
     maxIters=2000,confidence=.999,refineIters=30)
 assert A is not None
 H=np.eye(3);H[:2]=A
 transforms.append(H)
 q=cv2.perspectiveTransform(refq[None],H)[0];quads.append(q)
 projected=cv2.perspectiveTransform(reference[ids][None,:,0,:],H)[0]
 residual=np.linalg.norm(projected-tracks[i][ids,0,:],axis=1)
 metrics.append({'frame':i,'trackedPoints':len(ids),'inlierPoints':int(inliers.sum()),
  'medianResidualPx':float(np.median(residual[inliers[:,0]>0])),'maxInlierResidualPx':float(residual[inliers[:,0]>0].max())})
quads=np.array(quads)
# Rigid plane shape changes smoothly with camera movement. Fit its coupled
# 2x2 camera transport continuously, then solve each frame's translation from
# the observed print features. This retains physical camera motion at the
# tracked centroid while rejecting noisy anisotropic shape estimates from
# early frames where the lower part of the sign is outside the camera frame.
coupled=np.array(transforms)[:,:2,:2].reshape(120,4).astype(np.float32)
coupled=cv2.GaussianBlur(coupled,(1,25),4.0,borderType=cv2.BORDER_REPLICATE).reshape(120,2,2)
stable=[]
for i,A in enumerate(coupled):
 trans=np.median(tracks[i][common,0,:]-reference[common,0,:]@A.T,axis=0)
 H=np.eye(3);H[:2,:2]=A;H[:2,2]=trans
 stable.append(cv2.perspectiveTransform(refq[None],H)[0])
smooth=np.array(stable,dtype=np.float32)
Hs=[]
for i,q in enumerate(smooth):
 H=cv2.getPerspectiveTransform(q*2,np.float32([[0,0],[1600,0],[1600,480],[0,480]]));Hs.append(H.tolist())
 ids=common
 toframe=cv2.getPerspectiveTransform(refq,q)
 projected=cv2.perspectiveTransform(reference[ids][None,:,0,:],toframe)[0]
 residual=np.linalg.norm(projected-tracks[i][ids,0,:],axis=1)
 metrics[i]['smoothedMedianResidualPx']=float(np.median(residual))
quadword=np.float32([[270,152],[1380,152],[1380,383.4],[270,383.4]])
geometry=[]
for i,H in enumerate(Hs):
 q=cv2.perspectiveTransform(quadword[None],np.linalg.inv(np.array(H)))[0]*.5
 w=(np.linalg.norm(q[1]-q[0])+np.linalg.norm(q[2]-q[3]))/2;h=(np.linalg.norm(q[3]-q[0])+np.linalg.norm(q[2]-q[1]))/2
 geometry.append([i,float(w),float(h),float(w/h),q.tolist()])
a=np.array([r[1:4] for r in geometry]);print('New projected ranges',np.column_stack([a.min(0),a.max(0)]).tolist(),'maxsteps',abs(np.diff(a,axis=0)).max(0).tolist(),'max2nddiff',abs(np.diff(a,2,axis=0)).max(0).tolist(),flush=True)
print('Fit medianres max',max(m['medianResidualPx'] for m in metrics),'smoothed max',max(m['smoothedMedianResidualPx'] for m in metrics),flush=True)
(P/'stable-sign-plane.json').write_text(json.dumps({'matrices':Hs,'quadsHalfNative':smooth.tolist(),'unsmoothedQuadsHalfNative':quads.tolist(),'quality':metrics,'geometry':geometry,'fixedPhysicalFeatureCount':len(pts),'allFramesCommonFeatureCount':len(common),'method':'The same82originalsign features throughout; robust direct anchor-to-frame camera transport composed with the full projective reference-plane mapping. Coupled 2x2 shape transport has a25frame sigma4continuous temporal fit; instantaneous translation is re-solved from observed print features each frame. Source-feature residuals validate approximation; no map acceptance switches or screen-space sizing.'},indent=2))
for i in [0,12,24,29,30,36,48,60,72,96,119]:
 f=cv2.cvtColor(gray[i],cv2.COLOR_GRAY2BGR);cv2.polylines(f,[np.int32(smooth[i])],True,(0,255,0),2)
 ids=np.where(valid[i])[0]
 for x,y in tracks[i][ids,0,:]:cv2.circle(f,(int(x),int(y)),1,(0,255,255),-1)
 cv2.imwrite(str(P/f'plane-track-{i:03}.jpg'),f)
