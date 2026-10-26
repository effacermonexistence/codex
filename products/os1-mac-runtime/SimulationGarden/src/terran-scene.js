import {W,H,VIEW_H,MAP,BASE,MINERALS,createWorker,advanceColony,spriteFrame} from './mining-state.js';
import {PINK,normalizeAccent,hue} from './theme.js';
import {tokenState,isAwaitingReview,workerRace} from './field-state.js';
const load=url=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Missing bundled classic asset: '+url));im.src=url;});
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const poly=(c,points)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();};
const BASE_OUTLINE=[[288,190],[306,165],[359,154],[390,172],[407,198],[405,227],[377,249],[318,248],[287,222]];
export class TerranScene{
 constructor(container,select){
  this.container=container;this.onSelect=select;this.units=new Map();this.sessions=[];this.selected=null;this.enabled=false;this.loaded=false;this.accent=PINK;this.last=performance.now();this.paintCount=0;this.lastDiagnostics=0;this.departures=new Map();this.pool=tokenState(null);this.camera={x:0,y:0,zoom:1};this.pan=null;this.mode='native';
  this.canvas=canvas(W,H);this.canvas.setAttribute('aria-label','실제 OS1 세션 전장 · SCV 한 기는 세션 하나 · 실행 중 왕복 채광, 종료 시 정지');container.appendChild(this.canvas);this.ctx=this.canvas.getContext('2d',{alpha:false});
  this.factionLayer=this.overlay();this.wireframeLayer=this.overlay();this.spriteLayer=this.overlay();this.foregroundLayer=this.overlay();this.spriteCtx=this.spriteLayer.getContext('2d');this.foregroundCtx=this.foregroundLayer.getContext('2d');
  this.bindPointer();this.applyLayerAccent();
  this.ready=Promise.all(['classic-reference.png','scv-body.png','scv-team.png','scv-spark.png','mineral-1.png','mineral-2.png','mineral-3.png','probe-body.png','probe-team.png','classic-terrain.png'].map(p=>load('./'+p))).then(([original,body,team,spark,mineral1,mineral2,mineral3,probeBody,probeTeam,terrain])=>{Object.assign(this,{original,body,team,spark,minerals:[mineral1,mineral2,mineral3],probeBody,probeTeam,terrain});this.prepare();this.loaded=true;if(this.enabled)this.paint();});this.ready.catch(e=>container.setAttribute('data-error',e.message));this.animate=this.animate.bind(this);requestAnimationFrame(this.animate);
 }
 overlay(){const layer=canvas(W,H);layer.setAttribute('aria-hidden','true');layer.style.pointerEvents='none';this.container.appendChild(layer);return layer;}
 applyLayerAccent(){for(const[layer,sourceHue]of[[this.factionLayer,0],[this.wireframeLayer,120]]){const filter=`hue-rotate(${hue(this.accent)-sourceHue}deg)`;layer.style.filter=filter;layer.style.webkitFilter=filter;}}
 prepare(){
  this.ground=canvas(MAP.width+128,MAP.height+128);const ground=this.ground.getContext('2d');ground.imageSmoothingEnabled=false;for(let y=0;y<this.ground.height;y+=32)for(let x=0;x<this.ground.width;x+=32){const index=((Math.imul(x/32+17,73856093)^Math.imul(y/32+43,19349663))>>>0)%23;ground.drawImage(this.terrain,index%8*32,Math.floor(index/8)*32,32,32,x,y,32,32);}
  this.building=canvas(W,H);const b=this.building.getContext('2d');b.save();poly(b,BASE_OUTLINE);b.clip();b.drawImage(this.original,0,0);b.restore();
  const w=this.wireframeLayer.getContext('2d');w.imageSmoothingEnabled=false;w.save();w.beginPath();w.rect(166,387,63,76);w.clip();w.drawImage(this.original,0,0);w.restore();
  this.tintSprites();
  this.referenceCanvas=canvas(W,H);this.referenceCanvas.getContext('2d').drawImage(this.original,0,0);
 }
 measureHud(){
  const rois=[[0,316,140,31],[0,350,5,125],[141,370,258,12],[487,334,150,12]];let compared=0,differing=0;
  try{for(const[x,y,width,height]of rois){const a=this.ctx.getImageData(x,y,width,height).data,b=this.referenceCanvas.getContext('2d').getImageData(x,y,width,height).data;for(let i=0;i<a.length;i+=4){compared++;if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])differing++;}}this.pixelReceipt={width:W,height:H,staticHudPixels:compared,differingPixels:differing,wholeFrameIdentical:false,scope:'rendered base canvas HUD chrome; not transformed battlefield, tint layers or labels'};}catch(e){this.pixelReceipt={width:W,height:H,unavailable:true,reason:e.name,wholeFrameIdentical:false};}
 }
 tintSprites(){if(!this.team)return;const tint=im=>{const result=canvas(im.width,im.height),c=result.getContext('2d');c.drawImage(im,0,0);c.globalCompositeOperation='multiply';c.fillStyle=this.accent;c.fillRect(0,0,im.width,im.height);c.globalCompositeOperation='destination-in';c.drawImage(im,0,0);c.globalCompositeOperation='source-over';return result;};this.tintedTeam=tint(this.team);this.tintedProbeTeam=tint(this.probeTeam);}
 setAccent(hex){const next=normalizeAccent(hex);if(next!==this.accent){this.accent=next;this.applyLayerAccent();this.tintSprites();if(this.loaded&&this.enabled)this.paint();}}
 setMode(mode){if(mode!==this.mode){/* Cohort switches are not worker retirements: never fade synthetic workers into the native field (or vice versa). Preserve UUID state only for a later same-mode resume. */this.departures.clear();this.sessions=[];this.selected=null;this.enabled=false;}this.mode=mode;this.container.dataset.mode=mode;this.canvas.setAttribute('aria-label',mode==='preview'?'모델 호출 없는 동작 미리보기 · 실제 작업/토큰 아님':'실제 OS1 세션 전장 · 일꾼 하나는 세션 하나');}
 sync(sessions,selected,visible,tokenPool,tokenPools){
  const incoming=new Set(sessions.map(s=>s.id));
  for(const s of this.sessions){if(!incoming.has(s.id)&&!this.departures.has(s.id)){const u=this.units.get(s.id);if(u)this.departures.set(s.id,{u,time:0});}}
  this.sessions=sessions;this.selected=selected;this.enabled=visible;this.pool=tokenState(tokenPool);this.pools=tokenPools??null;
  for(let i=0;i<sessions.length;i++){const s=sessions[i];if(!this.units.has(s.id))this.units.set(s.id,createWorker(s.id,this.units.size));const u=this.units.get(s.id);u.session=s;if(u.phase===0){const race=workerRace(s);u.lane=race==='protoss'?4+i%4:race==='terran'?i%4:u.lane;}this.departures.delete(s.id);}
  if(!visible)for(const u of this.units.values()){u.moving=false;u.mining=false;}
  if(this.loaded&&visible)this.paint();
 }
 animate(now){requestAnimationFrame(this.animate);const dt=Math.min(Math.max((now-this.last)/1000,0),.05);this.last=now;if(!this.enabled||!this.loaded||document.visibilityState==='hidden')return;
  const all=this.sessions.map(s=>this.units.get(s.id)),active=new Set(this.sessions.filter(s=>s.status==='working').map(s=>s.id));advanceColony(all,dt,active);
  for(const[id,d]of this.departures){d.time+=dt;if(d.time>.45)this.departures.delete(id);}this.paint(now);
 }
 bindPointer(){
  const position=e=>{const r=this.canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H};};
  this.canvas.addEventListener('pointerdown',e=>{const p=position(e);if(e.button===1||e.button===2){e.preventDefault();this.pan={...p,cx:this.camera.x,cy:this.camera.y};this.canvas.setPointerCapture(e.pointerId);return;}if(p.x>=7&&p.x<=133&&p.y>=351&&p.y<=475){this.camera.x=(p.x-7)/126*MAP.width-W/(2*this.camera.zoom);this.camera.y=(p.y-351)/124*MAP.height-VIEW_H/(2*this.camera.zoom);this.clampCamera();if(this.enabled)this.paint();return;}
   if(p.y>=VIEW_H)return;const x=p.x/this.camera.zoom+this.camera.x,y=p.y/this.camera.zoom+this.camera.y;let best,d=25/this.camera.zoom;for(const s of this.sessions){const u=this.units.get(s.id),n=Math.hypot(u.x-x,u.y-12-y);if(n<d){d=n;best=s.id;}}if(best)this.onSelect(best);
  });
  this.canvas.addEventListener('pointermove',e=>{if(!this.pan)return;const p=position(e);this.camera.x=this.pan.cx-(p.x-this.pan.x)/this.camera.zoom;this.camera.y=this.pan.cy-(p.y-this.pan.y)/this.camera.zoom;this.clampCamera();if(this.enabled)this.paint();});
  this.canvas.addEventListener('pointerup',()=>this.pan=null);this.canvas.addEventListener('pointercancel',()=>this.pan=null);this.canvas.addEventListener('contextmenu',e=>e.preventDefault());
  this.canvas.addEventListener('wheel',e=>{const p=position(e);if(p.y>=VIEW_H)return;e.preventDefault();const x=p.x/this.camera.zoom+this.camera.x,y=p.y/this.camera.zoom+this.camera.y;this.camera.zoom=Math.max(.64,Math.min(1.7,this.camera.zoom*(e.deltaY<0?1.1:1/1.1)));this.camera.x=x-p.x/this.camera.zoom;this.camera.y=y-p.y/this.camera.zoom;this.clampCamera();if(this.enabled)this.paint();},{passive:false});
 }
 clampCamera(){this.camera.x=Math.max(-50,Math.min(MAP.width-W/this.camera.zoom+50,this.camera.x));this.camera.y=Math.max(-35,Math.min(MAP.height-VIEW_H/this.camera.zoom+35,this.camera.y));}
 focus(id){const u=this.units.get(id);if(!u)return;this.camera.x=u.x-W/(2*this.camera.zoom);this.camera.y=u.y-VIEW_H/(2*this.camera.zoom);this.clampCamera();if(this.enabled)this.paint();}
 fit(){this.camera={x:60,y:0,zoom:.9};this.clampCamera();if(this.enabled)this.paint();}
 transform(c){c.translate(-this.camera.x*this.camera.zoom,-this.camera.y*this.camera.zoom);c.scale(this.camera.zoom,this.camera.zoom);}
 drawUnit(c,u,alpha=1){
  c.save();c.globalAlpha=alpha;c.translate(Math.round(u.x),Math.round(u.y));c.fillStyle='#0007';c.beginPath();c.ellipse(0,1,12,5,0,0,Math.PI*2);c.fill();
  if(u.id===this.selected||isAwaitingReview(u.session)){c.strokeStyle=u.session?.status==='failed'?'#eb8d84':this.accent;c.lineWidth=1;c.beginPath();c.ellipse(0,1,14,6,0,0,Math.PI*2);c.stroke();}
  const f=spriteFrame(u),race=workerRace(u.session);c.save();if(f.mirror)c.scale(-1,1);if(race==='protoss'){for(const im of[this.probeBody,this.tintedProbeTeam])c.drawImage(im,f.direction*32,0,32,32,-16,-30+(u.moving?Math.sin(u.travelTime*10):0),32,32);}else{for(const im of[this.body,this.tintedTeam])c.drawImage(im,(f.frame%17)*72,Math.floor(f.frame/17)*72,72,72,-36,-46,72,72);}c.restore();
  if(u.cargo){const m=this.minerals[0];c.drawImage(m,18,35,25,20,7,-23,16,13);}
  if(u.mining){if(race==='protoss'){c.strokeStyle='#a4cfff';c.lineWidth=1.5;c.beginPath();c.moveTo(8,-19);c.lineTo(23,-24);c.stroke();}else{const frame=Math.floor(u.travelTime*17)%10;c.drawImage(this.spark,frame*48,0,48,48,1,-37,38,38);}}
  const foreground=this.foregroundCtx;foreground.save();this.transform(foreground);foreground.globalAlpha=alpha;foreground.translate(Math.round(u.x),Math.round(u.y));
  if(isAwaitingReview(u.session)){foreground.fillStyle=u.session.status==='failed'?'#eb8d84':this.accent;foreground.font='bold 11px monospace';foreground.textAlign='center';foreground.strokeStyle='#000';foreground.lineWidth=3;foreground.strokeText('!',0,-37);foreground.fillText('!',0,-37);}
  if(u.id===this.selected){const text=u.session.name.length>32?u.session.name.slice(0,32)+'…':u.session.name;foreground.font='8px -apple-system,sans-serif';foreground.textAlign='center';foreground.strokeStyle='#000';foreground.lineWidth=3;foreground.fillStyle=this.accent;foreground.strokeText(text,0,-47);foreground.fillText(text,0,-47);foreground.fillStyle='#0009';foreground.fillRect(-14,8,28,3);foreground.fillStyle=this.accent;foreground.fillRect(-13,9,26,1);}
  foreground.restore();c.restore();
 }
 paint(now=performance.now()){
  if(!this.loaded||!this.enabled||document.visibilityState==='hidden')return;this.paintCount++;const c=this.ctx;c.imageSmoothingEnabled=false;c.drawImage(this.original,0,0);
  c.save();c.beginPath();c.rect(0,0,W,VIEW_H);c.clip();this.transform(c);c.fillStyle=c.createPattern(this.ground,'repeat');c.fillRect(-100,-100,MAP.width+200,MAP.height+200);
  // Neutral mineral banks express only an actually supplied remaining ratio.
  // Unknown budget has no invented depletion. A provider percentage stays a percentage.
  const ratio=this.pool.ratio??(this.pool.remainingPercent!==null?this.pool.remainingPercent/100:null);
  for(let i=0;i<MINERALS.length;i++){const p=MINERALS[i],im=this.minerals[i%3],bank=this.resourceBank(i),r=bank.ratio,frame=r===null?0:r<=0?3:r<.2?2:r<.55?1:0;c.save();if(r===null)c.globalAlpha=.24;c.drawImage(im,frame*64,0,64,96,p[0]-24,p[1]-58,48,72);c.restore();}
  // An unmeasured balance must not look like a full blue bank. Dim source art
  // is a location marker, not an estimate; the question mark is explicit.
  c.font='7px -apple-system,sans-serif';c.textAlign='right';c.strokeStyle='#10160c';c.lineWidth=3;
  const labels=this.pools?[[0,'CODEX',635,112],[4,'CLAUDE',635,276]]:[[0,'',632,190]];
  for(const[index,provider,x,y]of labels){const bank=this.resourceBank(index),text=[provider,bank.label].filter(Boolean).join(' · ');c.fillStyle=bank.ratio===null?'#a2a99d':'#a5bbce';c.strokeText(text,x,y);c.fillText(text,x,y);}
  c.drawImage(this.building,0,0);c.restore();
  const fc=this.factionLayer.getContext('2d');fc.clearRect(0,0,W,H);fc.save();fc.beginPath();fc.rect(0,0,W,VIEW_H);fc.clip();this.transform(fc);fc.drawImage(this.building,0,0);fc.restore();
  this.spriteCtx.clearRect(0,0,W,H);this.spriteCtx.imageSmoothingEnabled=false;this.foregroundCtx.clearRect(0,0,W,H);this.spriteCtx.save();this.spriteCtx.beginPath();this.spriteCtx.rect(0,0,W,VIEW_H);this.spriteCtx.clip();this.transform(this.spriteCtx);this.foregroundCtx.save();this.foregroundCtx.beginPath();this.foregroundCtx.rect(0,0,W,VIEW_H);this.foregroundCtx.clip();
  const all=this.sessions.map(s=>this.units.get(s.id)).filter(Boolean).sort((a,b)=>a.y-b.y);for(const u of all)this.drawUnit(this.spriteCtx,u);for(const d of this.departures.values())this.drawUnit(this.spriteCtx,d.u,1-d.time/.45);this.spriteCtx.restore();this.foregroundCtx.restore();
  this.minimap(c,all,ratio);if(!this.pixelReceipt)this.measureHud();
  if(now-this.lastDiagnostics>180){this.lastDiagnostics=now;this.canvas.dataset.movingUnits=String(all.filter(u=>u.moving).length);this.canvas.dataset.miningUnits=String(all.filter(u=>u.mining).length);this.canvas.dataset.visibleUnits=String(all.length);this.canvas.dataset.accent=this.accent;this.canvas.dataset.workerStates=JSON.stringify(this.states());this.canvas.dataset.paintCount=String(this.paintCount);this.canvas.dataset.tokenBudgetKnown=String(ratio!==null);this.canvas.dataset.renderMode=this.mode;}
 }
 resourceBank(index){const bank=this.pools?tokenState(this.pools[index<4?'codex':'claude']):this.pool,ratio=bank.ratio??(bank.remainingPercent!==null?bank.remainingPercent/100:null);return{ratio,label:ratio===null?'? 미측정':bank.remainingPercent!==null?`${bank.remainingPercent}% 한도`:bank.remaining!==null?`${bank.remaining.toLocaleString('en-US')} 토큰`:'? 미측정'};}
 minimap(c,all){c.fillStyle='#10180d';c.fillRect(7,351,126,124);c.strokeStyle='#273322';for(let x=7;x<133;x+=14){c.beginPath();c.moveTo(x,351);c.lineTo(x,475);c.stroke();}c.fillStyle=this.accent;c.fillRect(7+BASE.x/MAP.width*126-3,351+BASE.y/MAP.height*124-3,6,6);for(let i=0;i<MINERALS.length;i++){const p=MINERALS[i],r=this.resourceBank(i).ratio;if(r===0)continue;c.fillStyle=r===null?'#505e55':'#84b5ed';c.fillRect(7+p[0]/MAP.width*126,351+p[1]/MAP.height*124,2,3);}for(const u of all){c.fillStyle=u.id===this.selected?'#fff':u.session.status==='working'?this.accent:isAwaitingReview(u.session)?'#f5d884':'#8c878d';c.fillRect(7+u.x/MAP.width*126,351+u.y/MAP.height*124,2,2);}c.strokeStyle='#e7dfdf';c.lineWidth=.7;c.strokeRect(7+this.camera.x/MAP.width*126,351+this.camera.y/MAP.height*124,W/this.camera.zoom/MAP.width*126,VIEW_H/this.camera.zoom/MAP.height*124);}

 states(){return this.sessions.map(s=>{const u=this.units.get(s.id),frame=spriteFrame(u);return{id:s.id,name:s.name,status:s.status,x:+u.x.toFixed(3),y:+u.y.toFixed(3),phase:+u.phase.toFixed(3),moving:u.moving,mining:u.mining,cargo:u.cargo,mode:u.mode,cycles:u.cycles,spriteFrame:frame.frame,race:workerRace(s),awaitingReview:isAwaitingReview(s)};});}
 diagnostics(){return{mode:this.mode,visible:this.enabled,workers:this.states(),moving:this.states().filter(s=>s.moving).length,mining:this.states().filter(s=>s.mining).length,paintCount:this.paintCount,tokenPool:this.pool,tokenPools:this.pools,sourceSprites:'51 source frames / 17 directions / 3 poses',camera:{...this.camera},pixelReference:this.pixelReceipt};}
}
