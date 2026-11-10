'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parse}=require('./body-wordmarks.cjs'),{parseRange,fileIdentity,noSymlink}=require('./motion-static.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const cls=(n,c)=>(n.attrs.class||'').split(/\s+/).includes(c);
function tattooLegibility(root){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'content/tattoo-legibility/delivery.json')));
 const prior=JSON.parse(fs.readFileSync(path.join(root,'content/tattoo-motion/manifest.json')));
 if(manifest.version!=='tattoo-legibility-v1'||manifest.works.length!==12)throw Error('Tattoo legibility scope');
 const works=new Map(),movies=new Map();
 for(let i=0;i<12;i++){
  const w=manifest.works[i],old=prior.works[i];if(w.id!==old.id||w.sourceSha256!==old.sourceSha256)throw Error('Tattoo source identity');
  for(const format of ['desktop','mobile']){
   const a=w[format];if(a.file!==`tattoo-visible-${w.id}-${format}-${a.sha256.slice(0,16)}.mp4`||a.url!=='/s/'+a.file||a.posterUrl!=='/s/'+a.posterFile||a.ambientUrl!=='/s/'+a.ambientFile||a.width!==old[format].width||a.height!==old[format].height||a.fps!==24||a.duration!==18||!Number.isSafeInteger(a.bytes)||a.bytes<=0||a.bytes>15000000)throw Error('Tattoo profile identity');
   for(const[file,bytes,hash]of [[a.file,a.bytes,a.sha256],[a.posterFile,a.posterBytes,a.posterSha256],[a.ambientFile,a.ambientBytes,a.ambientSha256]]){
    if(path.basename(file)!==file||!file.startsWith('tattoo-visible-'+w.id+'-'+format+'-'))throw Error('Tattoo profile path');const filename=path.join(root,'site/s',file);noSymlink(root,filename);const id=fileIdentity(filename);if(id.bytes!==bytes||id.sha256!==hash)throw Error('Tattoo profile bytes');if(file===a.file)movies.set(a.url,{...a,filename});
   }
  }
  works.set(w.id,w);
 }
 // Existing open pages may still request the previous immutable film URLs.
 // Preserve their exact MP4/range contract without adopting them into new scenes.
 for(const a of manifest.previousMovies||[]){
  const match=/^tattoo-visible-(cr-\d{3})-(desktop|mobile)-([a-f0-9]{16})\.mp4$/.exec(a.file||'');
  if(!match||!works.has(match[1])||a.url!=='/s/'+a.file||!a.sha256.startsWith(match[3]))throw Error('Previous tattoo profile identity');
  const filename=path.join(root,'site/s',a.file);noSymlink(root,filename);const id=fileIdentity(filename);
  if(id.bytes!==a.bytes||id.sha256!==a.sha256)throw Error('Previous tattoo profile bytes');
  if(movies.has(a.url)&&movies.get(a.url).sha256!==a.sha256)throw Error('Tattoo URL collision');
  movies.set(a.url,{...a,filename});
 }
 const css=fs.readFileSync(path.join(root,'content/tattoo-legibility/style.css'));
 const originalRuntime=fs.readFileSync(path.join(root,'content/tattoo-motion/runtime.js'),'utf8'),seams=fs.readFileSync(path.join(root,'content/tattoo-legibility/seams.js'),'utf8'),anchor='const seams=createTattooSeams(states,info,cfg.seams);';if(originalRuntime.split(anchor).length!==2)throw Error('Tattoo runtime composition');
 const updateAnchor='seams?.update(motion);info.ready=true';if(originalRuntime.split(updateAnchor).length!==2)throw Error('Tattoo frame geometry anchor');
 const js=Buffer.from(originalRuntime.replace(anchor,seams+'\n'+anchor).replace(updateAnchor,'seams?.update(motion);updateTattooFrameBoxes(states);info.ready=true'));const assets=[{asset:'/s/tattoo-legibility-'+sha(css).slice(0,16)+'.css',bytes:css},{asset:'/s/tattoo-legibility-'+sha(js).slice(0,16)+'.js',bytes:js}];
 const markup='<link id="tattoo-legibility-policy" rel="stylesheet" href="'+assets[0].asset+'">';
 function transform(html,route){
  if(route!=='/continuous-render'&&!/^\/continuous-render-\d{3}$/.test(route))return{html,scenes:0};
  if(html.includes('id="tattoo-legibility-policy"'))throw Error('Tattoo legibility duplicate');
  const nodes=parse(html),scenes=nodes.filter(n=>works.has(n.attrs['data-cr-motion-work'])),edits=[];
  if(scenes.length!==(route==='/continuous-render'?12:1))throw Error('Tattoo legibility scene boundary');
  for(const scene of scenes){
   const w=works.get(scene.attrs['data-cr-motion-work']),media=nodes.find(n=>cls(n,'cr-motion-media')&&n.start>scene.start&&n.end<scene.end),picture=nodes.find(n=>n.tag==='picture'&&n.start>media.start&&n.end<media.end);if(!media||!picture)throw Error('Tattoo picture boundary');
   edits.push({start:scene.start,end:scene.openEnd,text:html.slice(scene.start,scene.openEnd-1)+' data-cr-legible="1">'});
   const ambient='<picture class="cr-visible-ambient"><source media="(max-width:767px)" srcset="'+w.mobile.ambientUrl+'"><img src="'+w.desktop.ambientUrl+'" alt="" decoding="async" loading="lazy"></picture>';
   edits.push({start:picture.end,end:picture.end,text:ambient});
  }
  let next=html;for(const e of edits.sort((a,b)=>b.start-a.start))next=next.slice(0,e.start)+e.text+next.slice(e.end);
  const rx=/(<script id="tattoo-motion-config"[^>]*>)window\.CR_MOTION=([\s\S]*?);<\/script>/g,hits=[...next.matchAll(rx)];if(hits.length!==1)throw Error('Tattoo config boundary');const cfg=JSON.parse(hits[0][2]);cfg.version=manifest.version;
  for(const[id,w]of works)if(cfg.works[id])cfg.works[id]={desktop:w.desktop,mobile:w.mobile};
  next=next.replace(rx,(_,open)=>open+'window.CR_MOTION='+JSON.stringify(cfg).replace(/</g,'\\u003c')+';</script>');
  for(const w of prior.works){const replacement=works.get(w.id);for(const format of ['desktop','mobile'])next=next.replaceAll(w[format].posterUrl,replacement[format].posterUrl);}
  const script=/(<script id="tattoo-motion-runtime" src=")[^"]+(" defer><\/script>)/g;if([...next.matchAll(script)].length!==1)throw Error('Tattoo runtime boundary');next=next.replace(script,'$1'+assets[1].asset+'$2');next=next.replace('</head>',markup+'</head>');return{html:next,scenes:scenes.length};
 }
 function serve(req,res,pathname){
  const a=movies.get(pathname);if(!a)return false;
  const headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'public, max-age=31536000, immutable','ETag':'"sha256-'+a.sha256+'"','X-Content-Type-Options':'nosniff'};
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return true;}
  let range;if(req.headers.range&&(!req.headers['if-range']||req.headers['if-range']===headers.ETag)){range=parseRange(req.headers.range,a.bytes);if(!range){res.writeHead(416,{...headers,'Content-Range':'bytes */'+a.bytes,'Content-Length':0}).end();return true;}}
  if(!range&&req.headers['if-none-match']===headers.ETag){res.writeHead(304,headers).end();return true;}
  const start=range?.start??0,end=range?.end??a.bytes-1;headers['Content-Length']=end-start+1;if(range)headers['Content-Range']=`bytes ${start}-${end}/${a.bytes}`;res.writeHead(range?206:200,headers);if(req.method==='HEAD'){res.end();return true;}
  const stream=fs.createReadStream(a.filename,{start,end,flags:fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return true;
 }
 return{manifest,assets,markup,transform,render:(html,route)=>transform(html,route).html,serve};
}
module.exports={tattooLegibility};
