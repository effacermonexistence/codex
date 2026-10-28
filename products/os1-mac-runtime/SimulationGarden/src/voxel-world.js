import * as THREE from 'three';
import {BASE,MINERALS,hashID} from './mining-state.js';
import {tokenState} from './field-state.js';

export const toVoxel=(x,y)=>new THREE.Vector3((x-440)/10,0,(y-175)/10);
// Preserve the semantic endpoints: positive is never empty, partial never full.
export function oreChunkCount(ratio,total=12){if(ratio===null||!Number.isFinite(ratio))return Math.min(4,total);if(ratio===0)return 0;if(ratio===1)return total;return Math.min(total-1,Math.max(1,Math.floor(total*ratio)));}
export function quotaPercentLabel(value){if(value>0&&value<.1)return '<0.1';if(value<100&&value>99.9)return '>99.9';return value.toLocaleString('en-US',{maximumFractionDigits:1});}
const BOX=new THREE.BoxGeometry(1,1,1),DUMMY=new THREE.Object3D();
const colors={grass:0x4f853a,dirt:0x8d6243,stone:0x81918c,wood:0x9b6d42,roof:0x5a7776,leaves:0x3c7b3b};
const noise=(x,y,seed=1)=>((Math.imul(x+17,73856093)^Math.imul(y+43,19349663)^seed)>>>0);
function pixelTexture(base,seed=1){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const c=canvas.getContext('2d'),color=new THREE.Color(base);
 for(let y=0;y<16;y+=2)for(let x=0;x<16;x+=2){const shade=.82+(noise(x,y,seed)%35)/100;c.fillStyle='#'+color.clone().multiplyScalar(shade).getHexString();c.fillRect(x,y,2,2);}
 const t=new THREE.CanvasTexture(canvas);t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestMipmapNearestFilter;t.colorSpace=THREE.SRGBColorSpace;return t;
}
function blockMaterial(color,seed){return new THREE.MeshStandardMaterial({map:pixelTexture(color,seed),roughness:.94,metalness:0,flatShading:true});}
function meshBox(parent,material,x,y,z,sx=1,sy=1,sz=1){const m=new THREE.Mesh(BOX,material);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function batch(parent,material,items,{shadow=true}={}){const m=new THREE.InstancedMesh(BOX,material,Math.max(items.length,1));m.count=items.length;m.castShadow=shadow;m.receiveShadow=true;for(let i=0;i<items.length;i++){const a=items[i];DUMMY.position.set(a[0],a[1],a[2]);DUMMY.rotation.set(0,a[6]||0,0);DUMMY.scale.set(a[3]??1,a[4]??1,a[5]??1);DUMMY.updateMatrix();m.setMatrixAt(i,DUMMY.matrix);if(a[7])m.setColorAt(i,new THREE.Color(a[7]));}m.instanceMatrix.needsUpdate=true;parent.add(m);return m;}
export function textBillboard(text,color='#eaf3e7',width=8){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;const c=canvas.getContext('2d');
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;
 const material=new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,sizeAttenuation:true});const sprite=new THREE.Sprite(material);sprite.scale.set(width,width/6.4,1);sprite.renderOrder=12;
 const update=(value,tint=color)=>{if(sprite.userData.text===value&&sprite.userData.tint===tint)return;sprite.userData.text=value;sprite.userData.tint=tint;c.clearRect(0,0,512,80);c.fillStyle='rgba(19,35,37,.77)';c.fillRect(1,5,510,68);c.fillStyle=tint;c.font='600 25px -apple-system, system-ui, sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(String(value),256,40,488);texture.needsUpdate=true;};update(text);return{sprite,update,dispose(){texture.dispose();material.dispose();}};
}
export function createVoxelWorld(accent='#EDB3CC'){
 const group=new THREE.Group();group.name='OS1 voxel island';const materials={grass:blockMaterial(colors.grass,1),dirt:blockMaterial(colors.dirt,2),stone:blockMaterial(colors.stone,3),wood:blockMaterial(colors.wood,4),planks:blockMaterial(0xb8915d,5),roof:blockMaterial(colors.roof,6),leaves:blockMaterial(colors.leaves,7),bark:blockMaterial(0x61482f,8),sand:blockMaterial(0xc8bd87,9),accent:new THREE.MeshStandardMaterial({color:accent,roughness:.7}),dark:new THREE.MeshStandardMaterial({color:0x33413b,roughness:.9}),window:new THREE.MeshStandardMaterial({color:0xffdf93,emissive:0xf2b957,emissiveIntensity:.7,roughness:.4})};
 const grass=[],dirt=[],stone=[],water=[],shore=[],paths=[],leaves=[],logs=[];let blockCount=0;
 function river(x,z){return Math.abs(x-(-18+Math.sin(z*.19)*1.6))<1.5;}
 function elevation(x,z){if(river(x,z)||x>-6&&x<19&&z>-15&&z<16)return 0;return Math.max(0,3-Math.floor(Math.hypot(x+15,z+16)/2.5),2-Math.floor(Math.hypot(x-19,z+18)/2.7),2-Math.floor(Math.hypot(x+22,z-12)/2.5));}
 for(let x=-25;x<=25;x++)for(let z=-23;z<=23;z++){
  const shape=(x/26)**6+(z/24)**6;if(shape>1.12||Math.abs(x)>23&&Math.abs(z)>20)continue;const edge=Math.max(Math.abs(x)/25,Math.abs(z)/23),depth=edge>.94?1.6:edge>.86?2.6:3.6,height=elevation(x,z);
  stone.push([x,-depth-.55,z,1,.8,1]);dirt.push([x,(height-depth)/2-.12,z,1,depth+height,1]);
  if(river(x,z)){water.push([x,-.22,z,1,.18,1]);shore.push([x,-.6,z,1,.52,1]);}else{grass.push([x,height-.18,z,1,.36,1]);}
 }
 // Terrain is genuine 3D block geometry. No screenshot plane or sky image.
 batch(group,materials.stone,stone);batch(group,materials.dirt,dirt);batch(group,materials.grass,grass);batch(group,materials.sand,shore);
 const waterMaterial=new THREE.MeshStandardMaterial({color:0x327f9b,transparent:true,opacity:.91,roughness:.31,metalness:.12});batch(group,waterMaterial,water,{shadow:false});
 // The work route remains unobstructed; prop scenery stays outside that corridor.
 for(let x=-7;x<6;x++)for(let z=1;z<5;z++)if(noise(x,z,2)%4!==0)paths.push([x,.045,z,.94,.09,.94]);batch(group,materials.planks,paths);
 const bridge=[];for(let x=-22;x<=-13;x++)for(let z=1;z<=3;z++)bridge.push([x,.14,z,.98,.24,.95]);batch(group,materials.wood,bridge);
 for(const x of[-22,-19,-16,-13])for(const z of[.5,3.5])meshBox(group,materials.bark,x,.65,z,.2,1.2,.2);
 for(const z of[.5,3.5])meshBox(group,materials.wood,-17.5,1.08,z,9.5,.15,.15);
 const trees=[[-22,-16],[-17,-20],[-12,-19],[-6,-19],[2,-20],[10,-21],[20,-18],[23,-9],[24,2],[23,15],[17,20],[7,21],[-5,21],[-15,19],[-23,13],[-23,5],[-23,-5],[-11,14]];
 for(let i=0;i<trees.length;i++){const[x,z]=trees[i],height=2.3+(i%3)*.45,ground=elevation(x,z);logs.push([x,ground+height/2,z,.65,height,.65]);for(let level=0;level<3;level++){const radius=level===2?1:2;for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++){if(Math.abs(dx)+Math.abs(dz)>radius*1.8||level<2&&noise(dx+i,dz,7)%13===0)continue;leaves.push([x+dx*.77,ground+height+level*.7,z+dz*.77,.92,.92,.92,0,i%3===0?0xa1bc74:i%3===1?0x75a65e:0x8cb675]);}}}
 batch(group,materials.bark,logs);batch(group,materials.leaves,leaves);
 // A block-built mining lodge with layered stair roof, lit windows and chest apron.
 const base=toVoxel(BASE.x,BASE.y),lodge=new THREE.Group();lodge.position.set(base.x,0,base.z);group.add(lodge);
 meshBox(lodge,materials.stone,0,.16,0,6.8,.32,5.8);meshBox(lodge,materials.planks,0,.4,0,6.3,.24,5.3);
 const wall=[];for(let x=-3;x<=3;x++)for(let y=0;y<3;y++){if(!(x===0&&y<2))wall.push([x,.85+y*.83,2.5,1,.82,.22]);wall.push([x,.85+y*.83,-2.5,1,.82,.22]);}
 for(let z=-2;z<=2;z++)for(let y=0;y<3;y++){wall.push([-3,.85+y*.83,z,.22,.82,1]);if(!(z===0&&y<2))wall.push([3,.85+y*.83,z,.22,.82,1]);}batch(lodge,materials.planks,wall);
 for(const x of[-3.12,3.12])for(const z of[-2.6,2.6])meshBox(lodge,materials.bark,x,1.75,z,.36,3.2,.36);
 for(let step=0;step<5;step++)for(const side of[-1,1])meshBox(lodge,materials.roof,0,3.25+step*.36,side*(2.85-step*.54),7.8,.46,.78);
 meshBox(lodge,materials.accent,0,4.95,0,8.1,.18,.48);for(const x of[-1.9,1.9]){meshBox(lodge,materials.dark,x,1.9,2.65,1.35,1.1,.12);meshBox(lodge,materials.window,x,1.9,2.73,1.12,.85,.08);meshBox(lodge,materials.wood,x,1.9,2.79,.07,.9,.06);}
 meshBox(lodge,materials.stone,-2,4.75,-.7,.95,3.1,.95);meshBox(lodge,materials.dark,-2,6.35,-.7,1.14,.18,1.14);
 meshBox(lodge,materials.dark,3.5,1.65,0,.1,3.2,.1);meshBox(lodge,materials.accent,4.15,2.55,0,1.3,.72,.08);
 for(const z of[-1.9,1.9]){const x=base.x+4.65;meshBox(group,materials.wood,x,.42,base.z+z,1.3,.75,.9);meshBox(group,materials.dark,x,.8,base.z+z,1.37,.12,.96);meshBox(group,materials.accent,x,.51,base.z+z+.465,.19,.28,.06);}
 const sunLamp=new THREE.PointLight(0xffd69b,10,9,2);sunLamp.position.set(base.x+3.8,2,base.z+1);group.add(sunLamp);
 const rocks=[];for(const[x,z]of[[-9,-12],[-15,12],[20,15],[21,-17],[-23,-9]]){for(let i=0;i<4;i++)rocks.push([x+(i%2)*.75,elevation(x,z)+.25+i*.11,z+Math.floor(i/2)*.7,.85,.55+i*.2,.85]);}batch(group,materials.stone,rocks);
 const tufts=[],flowers=[];
 for(let x=-23;x<=23;x++)for(let z=-21;z<=21;z++){if(river(x,z)||x>-7&&x<20&&z>-15&&z<16||Math.abs(x)>21&&Math.abs(z)>19)continue;const n=noise(x,z,31),ground=elevation(x,z);if(n%9===0){tufts.push([x+.17,ground+.19,z,.12,.38,.48]);tufts.push([x,ground+.14,z+.12,.48,.28,.12]);}if(n%47===0){flowers.push([x,ground+.2,z,.1,.4,.1,0,0x487b32]);flowers.push([x,ground+.45,z,.34,.17,.34,0,n%3===0?0xe6b1cb:n%3===1?0xffdd7c:0xf4eee0]);}}
 batch(group,materials.grass,tufts,{shadow:false});const flowerMaterial=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9});batch(group,flowerMaterial,flowers,{shadow:false});
 const oreBanks=[],labels=[];
 for(let i=0;i<MINERALS.length;i++){
  const p=toVoxel(...MINERALS[i]),g=new THREE.Group();g.position.copy(p);group.add(g);const bed=[];for(let n=0;n<7;n++)bed.push([(n%3-1)*.62,.25+(n%2)*.1,(Math.floor(n/3)-1)*.55,.8,.5+(n%3)*.2,.8]);batch(g,materials.stone,bed);
  const material=new THREE.MeshStandardMaterial({color:0x919b94,roughness:.6,metalness:.05,emissive:0x293a33,emissiveIntensity:.04});const chunks=[];for(let n=0;n<12;n++)chunks.push([((n*7)%5-2)*.38,.48+Math.floor(n/4)*.38,((n*3)%5-2)*.36,.45,.55+(n%3)*.18,.45,(n%2)*.35]);const mesh=batch(g,material,chunks);oreBanks.push({mesh,material,chunks,provider:i<4?'codex':'claude',ratio:null});
 }
 for(const[provider,x,z]of[['codex',12,-10],['claude',16,12]]){const label=textBillboard(`${provider.toUpperCase()} · ? 미측정`,'#d6dcd5',8.4);label.sprite.position.set(x,3.25,z);group.add(label.sprite);labels.push({provider,...label});}
 const floorMaterial=new THREE.MeshStandardMaterial({color:0xc5d4d7,roughness:1});const floor=new THREE.Mesh(new THREE.PlaneGeometry(220,220),floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.y=-5.2;floor.receiveShadow=true;group.add(floor);
 let poolState=tokenState(null),poolStates=null;
 function stateFor(provider){return poolStates?tokenState(poolStates[provider]):poolState;}
 function updateBudget(pool,pools){poolState=tokenState(pool);poolStates=pools??null;for(const bank of oreBanks){const state=stateFor(bank.provider),r=state.ratio??(state.remainingPercent===null?null:state.remainingPercent/100);bank.ratio=r;bank.material.color.set(r===null?0x7e8e83:bank.provider==='codex'?0x62d3db:0xc69ee9);bank.material.emissive.set(r===null?0x17281e:bank.provider==='codex'?0x2e969f:0x8655a6);bank.material.emissiveIntensity=r===null?.025:.48;bank.mesh.count=oreChunkCount(r,bank.chunks.length);}
  for(const label of labels){const s=stateFor(label.provider),known=s.ratio??(s.remainingPercent===null?null:s.remainingPercent/100),value=known===null?'? 미측정':s.remainingPercent!==null?`공급자 한도 ${quotaPercentLabel(s.remainingPercent)}%`:s.remaining!==null?`${s.remaining.toLocaleString('en-US')} 토큰`:'? 미측정';label.update(`${label.provider.toUpperCase()} · ${value}`,known===null?'#cad2cb':'#ddf4ee');}
 }
 updateBudget(null,null);blockCount=grass.length+dirt.length+stone.length+water.length+leaves.length+logs.length+paths.length+bridge.length+rocks.length+tufts.length+flowers.length;
 return{group,materials,oreBanks,labels,blockCount,heightAt:()=>0,updateAccent(hex){materials.accent.color.set(hex);},updateBudget,diagnostics:()=>({staticBlocks:blockCount,oreBanks:oreBanks.map(b=>({provider:b.provider,ratio:b.ratio,visibleChunks:b.mesh.count,unknown:b.ratio===null})),tokenPool:poolState,tokenPools:poolStates}),dispose(){group.traverse(o=>{if(o.geometry&&o.geometry!==BOX)o.geometry.dispose();});for(const m of Object.values(materials)){m.map?.dispose();m.dispose();}for(const b of oreBanks)b.material.dispose();labels.forEach(l=>l.dispose());waterMaterial.dispose();floorMaterial.dispose();flowerMaterial.dispose();}};
}

// Parts share geometry/material and are instanced across the entire workforce.
// Instanced body and contact-shadow batches per engine keep 12 or 300 workers from becoming 300 draw-call rigs.
function coloredGeometry(specs){const pos=[],normal=[],color=[];for(const s of specs){const g=new THREE.BoxGeometry(s.s[0],s.s[1],s.s[2]).toNonIndexed();if(s.r)g.applyMatrix4(new THREE.Matrix4().makeRotationZ(s.r));g.translate(...s.p);const p=g.getAttribute('position'),n=g.getAttribute('normal'),c=new THREE.Color(s.c);for(let i=0;i<p.count;i++){pos.push(p.getX(i),p.getY(i),p.getZ(i));normal.push(n.getX(i),n.getY(i),n.getZ(i));color.push(c.r,c.g,c.b);}g.dispose();}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));g.setAttribute('color',new THREE.Float32BufferAttribute(color,3));return g;}
const box=(p,s,c,r)=>({p,s,c,r});
function rigGeometries(style){const codex=style==='codex',claude=style==='claude',coat=codex?0x477a8e:claude?0xb58a61:0x809084,pants=codex?0x344b5d:claude?0x605d51:0x53625b,skin=0xe2b18c,hair=codex?0x4c3830:0x553d2a,boot=0x383933;return{
 torso:coloredGeometry([box([0,1.55,0],[.85,1.02,.48],coat),box([0,1.14,.01],[.89,.17,.53],boot),box([0,1.7,.255],[.08,.5,.035],0xd8d4bd),box([.22,1.58,.26],[.17,.2,.04],0xe1c18d)]),
 head:coloredGeometry([box([0,2.43,0],[.73,.73,.7],skin),box([0,2.75,-.03],[.77,.18,.73],hair),box([0,2.45,-.34],[.76,.61,.1],hair),box([-.16,2.46,.355],[.075,.08,.025],0x27373a),box([.16,2.46,.355],[.075,.08,.025],0x27373a),box([0,2.27,.365],[.17,.04,.03],0x9f6c52)]),
 marker:coloredGeometry([box([0,3.35,0],[.16,.45,.16],0xffdc8e),box([0,3.02,0],[.16,.13,.16],0xffdc8e)]),
 shadow:new THREE.PlaneGeometry(1.45,1.2).rotateX(-Math.PI/2).translate(0,.018,0),
 hat:coloredGeometry([box([0,2.89,0],[.85,.18,.8],0xffffff),box([0,2.81,.23],[.97,.1,.56],0xffffff)]),
 legL:coloredGeometry([box([0,-.45,0],[.34,.9,.38],pants),box([0,-.9,.08],[.4,.25,.54],boot)]),legR:coloredGeometry([box([0,-.45,0],[.34,.9,.38],pants),box([0,-.9,.08],[.4,.25,.54],boot)]),
 armL:coloredGeometry([box([0,-.3,0],[.3,.62,.35],coat),box([0,-.74,.01],[.28,.3,.32],skin)]),
 armR:coloredGeometry([box([0,-.3,0],[.3,.62,.35],coat),box([0,-.74,.01],[.28,.3,.32],skin),box([0,-.9,.48],[.11,.11,1.05],0x795b35),box([0,-.9,.96],[.78,.17,.18],0xb8cfd0),box([.33,-.98,.96],[.16,.25,.19],0x8caaaa)]),
 cargo:coloredGeometry([box([0,1.45,-.48],[.62,.68,.4],0x8a6244),box([0,1.7,-.7],[.42,.4,.4],codex?0x71dbe2:claude?0xcdb6f4:0x96aaa0)])
};}
export class VoxelWorkforce{
 constructor(parent,accent){this.parent=parent;this.accent=accent;this.material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.83,flatShading:true});this.hatMaterial=new THREE.MeshStandardMaterial({color:accent,roughness:.7});const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=32;const sc=shadowCanvas.getContext('2d'),gradient=sc.createRadialGradient?.(16,16,2,16,16,16);if(gradient){gradient.addColorStop(0,'rgba(25,41,30,.5)');gradient.addColorStop(1,'rgba(25,41,30,0)');}sc.fillStyle=gradient||'rgba(25,41,30,.25)';sc.fillRect(0,0,32,32);this.shadowTexture=new THREE.CanvasTexture(shadowCanvas);this.shadowMaterial=new THREE.MeshBasicMaterial({map:this.shadowTexture,transparent:true,opacity:.43,depthWrite:false});this.groups=new Map();this.rigs=new Map();this.raycastMeshes=[];this.capacity=0;this.selection=new THREE.Mesh(new THREE.RingGeometry(.61,.68,4),new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:.95,side:THREE.DoubleSide,depthWrite:false}));this.selection.rotation.x=-Math.PI/2;this.selection.rotation.z=Math.PI/4;this.selection.position.y=.035;parent.add(this.selection);this.selection.visible=false;this.nameLabel=textBillboard('',accent,8.2);parent.add(this.nameLabel.sprite);this.nameLabel.sprite.visible=false;}
 style(session){const e=String(session?.engine||'').toLowerCase();return/claude|anthropic/.test(e)?'claude':/codex|clodex/.test(e)?'codex':'neutral';}
 createRig(id){const root=new THREE.Object3D(),parts={};for(const part of['torso','head','hat','legL','legR','armL','armR','cargo','marker','shadow']){parts[part]=new THREE.Object3D();root.add(parts[part]);}parts.legL.position.set(-.23,1.02,0);parts.legR.position.set(.23,1.02,0);parts.armL.position.set(-.59,1.99,0);parts.armR.position.set(.59,1.99,0);return{id,root,parts,initialized:false,pose:{yaw:0,walk:0,arm:0,bob:0,cargo:false},style:'neutral'};}
 ensure(style,count){let g=this.groups.get(style);if(g&&g.capacity>=count)return g;if(g){for(const m of Object.values(g.meshes)){this.parent.remove(m);m.dispose?.();}for(const geo of Object.values(g.geometries))geo.dispose();}const geometries=rigGeometries(style),capacity=2**Math.ceil(Math.log2(Math.max(16,count))),meshes={};for(const[part,geo]of Object.entries(geometries)){const mesh=new THREE.InstancedMesh(geo,part==='hat'?this.hatMaterial:part==='shadow'?this.shadowMaterial:this.material,capacity);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.castShadow=part!=='shadow'&&part!=='marker';mesh.receiveShadow=part!=='shadow';mesh.frustumCulled=false;mesh.userData.workerIDs=[];meshes[part]=mesh;this.parent.add(mesh);}g={capacity,meshes,geometries};this.groups.set(style,g);this.raycastMeshes=[...this.groups.values()].flatMap(v=>[v.meshes.torso,v.meshes.head]);return g;}
 update(units,selected,dt,advancePose=true){const cohorts={codex:[],claude:[],neutral:[]};for(const u of units){let rig=this.rigs.get(u.id);if(!rig){rig=this.createRig(u.id);this.rigs.set(u.id,rig);}rig.style=this.style(u.session);cohorts[rig.style].push({u,rig});const active=u.session?.status==='working';
   if(!rig.initialized){rig.pose.yaw=Math.PI-u.heading;rig.pose.cargo=u.cargo;rig.initialized=true;}
   if(active&&advancePose){const target=Math.PI-u.heading,delta=Math.atan2(Math.sin(target-rig.pose.yaw),Math.cos(target-rig.pose.yaw));rig.pose.yaw+=delta*(1-Math.exp(-12*dt));rig.pose.walk=u.moving?Math.sin(u.travelTime*11)*.72:0;rig.pose.arm=u.mining?-1.05+Math.sin(u.travelTime*15)*.62:u.moving?-rig.pose.walk*.75:-.12;rig.pose.bob=u.moving?Math.abs(Math.sin(u.travelTime*11))*.055:0;rig.pose.cargo=u.cargo;}
   const p=toVoxel(u.x,u.y);rig.root.position.set(p.x,rig.pose.bob,p.z);rig.root.rotation.y=rig.pose.yaw;rig.parts.legL.rotation.x=rig.pose.walk;rig.parts.legR.rotation.x=-rig.pose.walk;rig.parts.armL.rotation.x=-rig.pose.arm*.65;rig.parts.armR.rotation.x=rig.pose.arm;rig.parts.cargo.scale.setScalar(rig.pose.cargo?1:0);rig.parts.shadow.position.y=-rig.pose.bob;rig.parts.marker.scale.setScalar(u.session?.resultPending===true&&u.session?.reviewed!==true&&u.session?.status!=='working'&&u.session?.status!=='queued'?1:0);rig.root.updateMatrixWorld(true);
  }
  for(const[style,entries]of Object.entries(cohorts)){if(!entries.length){const g=this.groups.get(style);if(g)for(const m of Object.values(g.meshes))m.count=0;continue;}const g=this.ensure(style,entries.length);for(const[part,m]of Object.entries(g.meshes)){m.count=entries.length;m.castShadow=part!=='shadow'&&part!=='marker'&&units.length<=80;m.userData.workerIDs=entries.map(e=>e.u.id);for(let i=0;i<entries.length;i++)m.setMatrixAt(i,entries[i].rig.parts[part].matrixWorld);m.instanceMatrix.needsUpdate=true;m.boundingSphere=null;m.boundingBox=null;}}
  const selectedUnit=units.find(u=>u.id===selected);this.selection.visible=!!selectedUnit;this.nameLabel.sprite.visible=!!selectedUnit;if(selectedUnit){const p=toVoxel(selectedUnit.x,selectedUnit.y);this.selection.position.set(p.x,.035,p.z);this.nameLabel.sprite.position.set(p.x,3.65,p.z);const s=selectedUnit.session;this.nameLabel.update(s.name.length>34?s.name.slice(0,34)+'…':s.name,this.accent);}
 }
 setAccent(hex){this.accent=hex;this.hatMaterial.color.set(hex);this.selection.material.color.set(hex);}
 clear(){for(const g of this.groups.values())for(const m of Object.values(g.meshes))m.count=0;this.selection.visible=false;this.nameLabel.sprite.visible=false;}
 pose(id){const r=this.rigs.get(id);return r?{...r.pose}:null;}
 dispose(){for(const g of this.groups.values()){for(const m of Object.values(g.meshes)){this.parent.remove(m);m.dispose?.();}for(const geometry of Object.values(g.geometries))geometry.dispose();}this.material.dispose();this.hatMaterial.dispose();this.shadowMaterial.dispose();this.shadowTexture.dispose();this.selection.geometry.dispose();this.selection.material.dispose();this.nameLabel.dispose();}
}
