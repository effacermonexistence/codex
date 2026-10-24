import { W, H, createWorker, advanceWorker, MINERALS } from './mining-state.js';
const ORIGINAL = './terran-reference.jpg', CLEAN = './terran-cleanplate.png';
const HOLES = [[831,287,86,73],[701,360,70,81],[743,442,87,81],[779,495,89,82],[879,549,88,85]];
// Source-pixel masks: worker body is a clipped original SCV, not a new icon/model.
const BODY = [[839,296,55,61], [[10,20],[15,9],[25,3],[39,10],[42,18],[48,23],[49,38],[40,43],[35,57],[22,60],[13,49],[7,43],[4,30]]];
function load(url) { return new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(Error(`Missing local game reference: ${url}`)); im.src = url; }); }
const canvas = (w,h) => { const c = document.createElement('canvas'); c.width=w; c.height=h; return c; };
export class TerranScene {
  constructor(container, select) {
    this.container=container;this.onSelect=select;this.units=new Map();this.sessions=[];this.selected=null;this.enabled=false;this.loaded=false;this.frameTime=performance.now();this.last=performance.now();
    this.canvas=canvas(W,H);this.canvas.setAttribute('aria-label','테란 기지 · SCV 네 기 · 실행 중 채광 왕복, 중단 시 현 위치 정지');container.appendChild(this.canvas);this.ctx=this.canvas.getContext('2d',{alpha:false});
    this.canvas.addEventListener('click',e=>{const r=this.canvas.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*W,y=(e.clientY-r.top)/r.height*H;let best,d=64;for(const u of this.units.values()){if(!this.sessions.some(s=>s.id===u.id))continue;const n=Math.hypot(u.x-x,u.y-25-y);if(n<d){d=n;best=u.id;}}if(best)this.onSelect(best);});
    this.ready=Promise.all([load(ORIGINAL),load(CLEAN)]).then(([im,clean])=>{this.original=im;this.clean=clean;this.prepare();this.loaded=true;this.paint();});
    this.ready.catch(e=>{container.setAttribute('data-error',e.message);});
    this.animate=this.animate.bind(this);requestAnimationFrame(this.animate);
  }
  prepare(){
    this.plate=canvas(W,H);const c=this.plate.getContext('2d',{willReadFrequently:true});c.drawImage(this.original,0,0,W,H);
    for(const [x,y,w,h]of HOLES){
      const patch=canvas(w,h),p=patch.getContext('2d');p.drawImage(this.clean,x/W*this.clean.width,y/H*this.clean.height,w/W*this.clean.width,h/H*this.clean.height,0,0,w,h);
      // Only the five rejected worker regions are replaced. HUD/buildings outside
      // these masks are the untouched original image, not generated pixels.
      c.drawImage(patch,x,y);
    }
    this.reference=canvas(W,H);this.reference.getContext('2d').drawImage(this.original,0,0,W,H);
    // Direct source-space verification of the *unchanged HUD chrome*, not a
    // claim of full-frame equality after dynamic text/workers are overlaid.
    const rois=[[96,764,338,35],[95,1047,348,25],[450,864,820,15],[1274,864,150,16],[1442,818,366,25],[1428,1058,375,12]];
    let compared=0,differing=0;
    try {
      for(const[x,y,w,h]of rois){const a=c.getImageData(x,y,w,h).data,b=this.reference.getContext('2d',{willReadFrequently:true}).getImageData(x,y,w,h).data;for(let i=0;i<a.length;i+=4){compared++;if(a[i]!==b[i]||a[i+1]!==b[i+1]||a[i+2]!==b[i+2])differing++;}}
      this.pixelReceipt={width:W,height:H,staticHudPixels:compared,differingPixels:differing,wholeFrameIdentical:false,method:'Unchanged source HUD regions; dynamic session fields and worker masks excluded'};
      this.canvas.dataset.staticHudDifferingPixels=String(differing);
    } catch(error) {
      this.pixelReceipt={width:W,height:H,unavailable:true,reason:error.name,wholeFrameIdentical:false};
      this.canvas.dataset.staticHudDifferingPixels='UNAVAILABLE';
    }
  }
  sync(sessions,selected,visible){this.sessions=sessions;this.selected=selected;this.enabled=visible;for(let i=0;i<sessions.length;i++){const s=sessions[i];if(!this.units.has(s.id))this.units.set(s.id,createWorker(s.id,i));this.units.get(s.id).session=s;}if(!visible)for(const u of this.units.values()){u.moving=false;u.mining=false;}if(this.loaded)this.paint();}
  animate(now){requestAnimationFrame(this.animate);const dt=Math.min((now-this.last)/1000,.05);this.last=now;if(!this.enabled||!this.loaded)return;for(const s of this.sessions){const u=this.units.get(s.id);advanceWorker(u,dt,s.status==='working');}this.frameTime=now;this.paint();}
  drawSCV(c,u){
    const moving=u.moving, bob=moving?Math.sin(u.travelTime*22)*1.2:0;
    c.save();c.translate(u.x,u.y+bob);
    c.fillStyle='#0008';c.beginPath();c.ellipse(0,0,23,7,0,0,Math.PI*2);c.fill();
    if(u.id===this.selected){c.strokeStyle='#3fff63';c.lineWidth=2;c.beginPath();c.ellipse(0,0,29,12,0,0,Math.PI*2);c.stroke();}
    c.save();if(u.facing>0)c.scale(-1,1);c.translate(-27,-59);
    c.beginPath();BODY[1].forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.clip();c.drawImage(this.original,...BODY[0],0,0,55,61);c.restore();
    if(u.cargo){c.save();c.translate(u.facing>0?-20:19,-27);c.beginPath();c.moveTo(-8,-6);c.lineTo(1,-13);c.lineTo(14,-7);c.lineTo(7,5);c.lineTo(-8,3);c.closePath();c.clip();c.drawImage(this.original,878,298,27,27,-10,-16,27,27);c.restore();}
    if(u.mining){c.strokeStyle='#a7eaff';c.lineWidth=1.5;for(let j=0;j<4;j++){const a=u.travelTime*19+j*2.3,d=(Math.sin(a)+1)*7;c.beginPath();c.moveTo(-12,-24);c.lineTo(-22-d,Math.sin(a)*11-26);c.stroke();}}
    if(u.id===this.selected){c.font='14px -apple-system,sans-serif';c.textAlign='center';c.lineWidth=3;c.strokeStyle='#000';c.fillStyle='#b6ffbd';const name=u.session.name.length>34?u.session.name.slice(0,34)+'…':u.session.name;c.strokeText(name,0,-70);c.fillText(name,0,-70);}
    c.restore();
  }
  paint(){if(!this.loaded)return;const c=this.ctx;c.drawImage(this.plate,0,0);const all=this.sessions.map(s=>this.units.get(s.id)).filter(Boolean).sort((a,b)=>a.y-b.y);for(const u of all)this.drawSCV(c,u);
    // Native worker dots over the real source minimap terrain.
    for(const u of all){c.fillStyle=u.id===this.selected?'#70ff51':'#ecffee';const x=188+(u.x-650)*.16,y=971+(u.y-400)*.11;c.fillRect(x,y,4,4);}
    this.canvas.dataset.movingUnits=String(all.filter(u=>u.moving).length);this.canvas.dataset.visibleUnits=String(all.length);this.canvas.dataset.workerStates=JSON.stringify(this.states());
  }
  states(){return this.sessions.map(s=>{const u=this.units.get(s.id);return{id:s.id,name:s.name,status:s.status,x:+u.x.toFixed(2),y:+u.y.toFixed(2),phase:+u.phase.toFixed(3),moving:u.moving,mining:u.mining};});}
}
