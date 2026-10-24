import { W,H,createWorker,advanceWorker } from './mining-state.js';
import {PINK,normalizeAccent,hue} from './theme.js';
const ORIGINAL='./classic-reference.png';
// Small source-space regions containing original screenshot workers, not terrain/HUD redesign.
const HOLES=[[418,178,40,45],[518,176,38,47],[481,218,38,49],[520,217,38,49],[281,238,46,60]];
const BODY=[290,244,29,28],SILHOUETTE=[[8,2],[18,1],[26,5],[26,12],[22,19],[23,25],[15,27],[8,22],[3,20],[2,12]];
const load=url=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Missing bundled classic reference'));im.src=url;});
const canvas=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
export class TerranScene{
 constructor(container,select){
  this.container=container;this.onSelect=select;this.units=new Map();this.sessions=[];this.selected=null;this.enabled=false;this.loaded=false;this.accent=PINK;this.last=performance.now();
  this.canvas=canvas(W,H);this.canvas.setAttribute('aria-label','스타1 클래식 테란 · SCV 네 기 · 실행 중 채광 왕복, 중단 시 현 위치 정지');container.appendChild(this.canvas);this.ctx=this.canvas.getContext('2d',{alpha:false});
  this.canvas.addEventListener('click',e=>{const r=this.canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*W,y=(e.clientY-r.top)/r.height*H;let best,d=24;for(const u of this.units.values()){if(!this.sessions.some(s=>s.id===u.id))continue;const n=Math.hypot(u.x-x,u.y-13-y);if(n<d){d=n;best=u.id;}}if(best)this.onSelect(best);});
  this.ready=load(ORIGINAL).then(im=>{this.original=im;this.prepare();this.loaded=true;this.paint();});this.ready.catch(e=>container.setAttribute('data-error',e.message));this.animate=this.animate.bind(this);requestAnimationFrame(this.animate);
 }
 prepare(){
  this.plate=canvas(W,H);const c=this.plate.getContext('2d');c.imageSmoothingEnabled=false;c.drawImage(this.original,0,0);
  for(const[x,y,w,h]of HOLES){
   // Clone *source* terrain into only worker masks. Feather the seam without
   // using a generative full-frame replacement or changing the classic chrome.
   const p=canvas(w,h),q=p.getContext('2d');q.imageSmoothingEnabled=false;q.drawImage(this.original,220,244,w,h,0,0,w,h);q.globalCompositeOperation='destination-in';
   for(const [a,b,d] of [[0,0,w],[0,h,w],[1,0,h],[1,w,h]]){const g=a?q.createLinearGradient(b,0,b,h):q.createLinearGradient(0,b,w,b);g.addColorStop(0,'#fff0');g.addColorStop(4/d,'#fff');g.addColorStop(1-4/d,'#fff');g.addColorStop(1,'#fff0');q.fillStyle=g;q.fillRect(0,0,w,h);}c.drawImage(p,x,y);
  }
  const rois=[[0,316,140,31],[0,350,5,125],[141,370,258,12],[487,334,150,12]],ref=canvas(W,H);ref.getContext('2d').drawImage(this.original,0,0);let compared=0,differing=0;
  try{for(const[x,y,w,h]of rois){const a=c.getImageData(x,y,w,h).data,b=ref.getContext('2d').getImageData(x,y,w,h).data;for(let i=0;i<a.length;i+=4){compared++;if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])differing++;}}this.pixelReceipt={width:W,height:H,staticHudPixels:compared,differingPixels:differing,wholeFrameIdentical:false,scope:'untinted source chrome only; themed regions intentionally differ'};}catch(e){this.pixelReceipt={width:W,height:H,unavailable:true,reason:e.name,wholeFrameIdentical:false};}
 }
 setAccent(hex){const next=normalizeAccent(hex);if(next!==this.accent){this.accent=next;if(this.loaded)this.paint();}}
 sync(sessions,selected,visible){this.sessions=sessions;this.selected=selected;this.enabled=visible;for(let i=0;i<sessions.length;i++){const s=sessions[i];if(!this.units.has(s.id))this.units.set(s.id,createWorker(s.id,i));this.units.get(s.id).session=s;}if(!visible)for(const u of this.units.values()){u.moving=false;u.mining=false;}if(this.loaded)this.paint();}
 animate(now){requestAnimationFrame(this.animate);const dt=Math.min((now-this.last)/1000,.05);this.last=now;if(!this.enabled||!this.loaded)return;for(const s of this.sessions){const u=this.units.get(s.id);advanceWorker(u,dt,s.status==='working');}this.paint();}
 drawSCV(c,u){
  c.save();c.translate(Math.round(u.x),Math.round(u.y));c.fillStyle='#0009';c.beginPath();c.ellipse(0,0,10,4,0,0,Math.PI*2);c.fill();if(u.id===this.selected){c.strokeStyle=this.accent;c.lineWidth=1;c.beginPath();c.ellipse(0,0,11,5,0,0,Math.PI*2);c.stroke();}
  c.save();if(u.facing<0)c.scale(-1,1);c.translate(-14,-27+(u.moving?Math.round(Math.sin(u.travelTime*22)*.5):0));c.beginPath();SILHOUETTE.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.clip();c.filter=`hue-rotate(${hue(this.accent)-230}deg)`;c.drawImage(this.original,...BODY,0,0,29,28);c.restore();
  if(u.cargo){c.fillStyle='#73b6ff';c.strokeStyle='#b6e0ff';c.lineWidth=1;c.beginPath();c.moveTo(5,-20);c.lineTo(11,-25);c.lineTo(16,-20);c.lineTo(11,-17);c.closePath();c.fill();c.stroke();}
  if(u.mining){c.strokeStyle='#fff7bd';c.lineWidth=1;const d=Math.round((Math.sin(u.travelTime*18)+1)*3);c.beginPath();c.moveTo(9,-17);c.lineTo(17+d,-23);c.lineTo(18,-17);c.stroke();}
  if(u.id===this.selected){c.font='7px -apple-system,sans-serif';c.textAlign='center';c.strokeStyle='#000';c.lineWidth=2;c.fillStyle=this.accent;const name=u.session.name.length>28?u.session.name.slice(0,28)+'…':u.session.name;c.strokeText(name,0,-33);c.fillText(name,0,-33);}
  c.restore();
 }
 paint(){if(!this.loaded)return;const c=this.ctx;c.imageSmoothingEnabled=false;c.drawImage(this.plate,0,0);
  // Faction paint only: preserve the original steel/terrain geometry.
  c.save();c.beginPath();[[288,190],[306,165],[359,154],[390,172],[407,198],[405,227],[377,249],[318,248],[287,222]].forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.clip();c.filter=`hue-rotate(${hue(this.accent)}deg)`;c.drawImage(this.original,0,0);c.restore();
  // Actual classic wireframe, tinted to the chosen UI accent.
  c.save();c.beginPath();c.rect(166,387,63,76);c.clip();c.filter=`hue-rotate(${hue(this.accent)-120}deg)`;c.drawImage(this.original,0,0);c.restore();
  const all=this.sessions.map(s=>this.units.get(s.id)).filter(Boolean).sort((a,b)=>a.y-b.y);for(const u of all)this.drawSCV(c,u);
  // Original minimap field retained, old screenshot markers covered.
  c.fillStyle='#000';c.fillRect(7,351,126,124);for(const u of all){c.fillStyle=u.id===this.selected?this.accent:'#ddd';c.fillRect(40+Math.round(u.x*.13),370+Math.round(u.y*.2),2,2);}
  this.canvas.dataset.movingUnits=String(all.filter(u=>u.moving).length);this.canvas.dataset.visibleUnits=String(all.length);this.canvas.dataset.accent=this.accent;this.canvas.dataset.workerStates=JSON.stringify(this.states());
 }
 states(){return this.sessions.map(s=>{const u=this.units.get(s.id);return{id:s.id,name:s.name,status:s.status,x:+u.x.toFixed(2),y:+u.y.toFixed(2),phase:+u.phase.toFixed(3),moving:u.moving,mining:u.mining};});}
}
