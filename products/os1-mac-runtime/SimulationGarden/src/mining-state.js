// Animation is an output of native execution state, NOT a token meter.
// No wall clock, quota estimation, provider call, or hidden-task simulation here.
export const W=640,H=480,VIEW_H=316;
export const MAP={width:1024,height:650};
export const BASE={x:350,y:205};
export const MINERALS=[[509,47],[550,89],[574,132],[596,178],[601,216],[582,253],[549,285],[507,299]];
export const hashID=id=>{let h=2166136261;for(const c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;};
export function createWorker(id,slot=0){
 const seed=hashID(id),lane=slot%MINERALS.length,spread=Math.floor(slot/MINERALS.length);
 const angle=(lane/7-.5)*1.7;
 return{id,lane,seed,phase:0,x:BASE.x+Math.cos(angle)*(71+Math.min(spread,10)*2),y:BASE.y+Math.sin(angle)*(45+Math.min(spread,10)*2),cargo:false,moving:false,mining:false,facing:1,heading:Math.PI/2,travelTime:0,mode:'outbound',dwell:0,cycles:0,distance:0};
}
function home(u){const a=(u.lane/7-.5)*1.7;return[BASE.x+Math.cos(a)*70,BASE.y+Math.sin(a)*45];}
function mineral(u){const p=MINERALS[u.lane],n=(u.seed%5)-2;return[p[0]-12+(u.seed%3)*2,p[1]+n*3];}
export function advanceWorker(u,dt,active,neighbours=[]){
 if(!active){u.moving=false;u.mining=false;return u;}
 dt=Math.max(0,Math.min(dt,.1));u.phase+=dt;u.travelTime+=dt;
 if(u.mode==='mining'||u.mode==='deposit'){
  u.moving=false;u.mining=u.mode==='mining';u.dwell-=dt;
  if(u.dwell<=0){if(u.mode==='mining'){u.mode='return';u.cargo=true;u.mining=false;}else{u.mode='outbound';u.cargo=false;u.cycles++;}}return u;
 }
 const target=u.mode==='return'?home(u):mineral(u),dx=target[0]-u.x,dy=target[1]-u.y,dist=Math.hypot(dx,dy);
 if(dist<3){u.x=target[0];u.y=target[1];u.mode=u.mode==='return'?'deposit':'mining';u.dwell=u.mode==='mining'?.62+(u.seed%31)/100:.2;u.moving=false;u.mining=u.mode==='mining';if(u.mode==='deposit')u.cargo=false;return u;}
 let vx=dx/dist,vy=dy/dist;
 // A light two-way lane bias and local separation avoid overlapping glide stacks.
 const side=u.mode==='return'?-1:1,bias=Math.min(dist/35,1)*.09;vx+=-dy/dist*bias*side;vy+=dx/dist*bias*side;
 for(const other of neighbours){if(other.id===u.id||!other.moving)continue;const ax=u.x-other.x,ay=u.y-other.y,d=Math.hypot(ax,ay);if(d>0&&d<14){const f=(14-d)/14*.42;vx+=ax/d*f;vy+=ay/d*f;}}
 const len=Math.hypot(vx,vy),speed=53+(u.seed%15),step=Math.min(speed*dt,dist),mx=vx/len*step,my=vy/len*step;
 u.x+=mx;u.y+=my;u.distance+=Math.hypot(mx,my);u.heading=Math.atan2(mx,-my);u.facing=mx>=0?1:-1;u.moving=true;u.mining=false;return u;
}
export function advanceColony(workers,dt,activeIDs){
 const grid=new Map(),size=24;
 for(const u of workers){const key=`${Math.floor(u.x/size)},${Math.floor(u.y/size)}`;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(u);}
 for(const u of workers){const cx=Math.floor(u.x/size),cy=Math.floor(u.y/size),near=[];for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)near.push(...(grid.get(`${cx+x},${cy+y}`)||[]));advanceWorker(u,dt,activeIDs.has(u.id),near);}
 return workers;
}
export function spriteFrame(u){const angle=u.heading,mirror=angle<0,direction=Math.min(16,Math.round(Math.abs(angle)/Math.PI*16)),pose=u.moving?Math.floor(u.travelTime*10)%3:u.mining?Math.floor(u.travelTime*14)%3:0;return{frame:pose*17+direction,pose,direction,mirror};}
