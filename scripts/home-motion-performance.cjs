'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parseRange}=require('./motion-static.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function homeMotionPerformance(root){
 const delivery=JSON.parse(fs.readFileSync(path.join(root,'content/home-motion-performance/delivery.json')));
 const hero=fs.readFileSync(path.join(root,'content/home-hero/hero-background.js'));
 const field=fs.readFileSync(path.join(root,'content/home-fullfield/runtime.js'));
 const heroAsset='/s/hero-playback-'+sha(hero).slice(0,16)+'.js',fieldAsset='/s/fullfield-playback-'+sha(field).slice(0,16)+'.js';
 const files=new Map();
 for(const p of [...Object.values(delivery.profiles),...(delivery.previousProfiles||[])]){
  if(!/^\/s\/hero-playback-[a-z]+-[a-f0-9]{16}\.mp4$/.test(p.url))throw Error('Hero delivery scope');
  const file=path.join(root,'site',p.url),b=fs.readFileSync(file);if(b.length!==p.bytes||sha(b)!==p.sha256)throw Error('Hero delivery identity');files.set(p.url,{...p,file});
 }
 const poster=delivery.poster;
 if(poster){if(!/^\/s\/hero-playback-poster-[a-f0-9]{16}\.png$/.test(poster.url))throw Error('Hero poster path');const b=fs.readFileSync(path.join(root,'site',poster.url));if(b.length!==poster.bytes||sha(b)!==poster.sha256)throw Error('Hero poster bytes');}
 const authored=JSON.parse(fs.readFileSync(path.join(root,'content/home-hero/hero.json')));
 const oldPoster='/s/hero-soft-'+authored.posterSha256.slice(0,12)+'.jpg';
 if(delivery.version===2){for(const p of Object.values(delivery.profiles)){if(p.sha256!==authored.videoSha256||p.bytes!==authored.videoBytes||p.width!==authored.videoWidth||p.height!==authored.videoHeight||p.fps!==authored.videoFps||p.duration!==authored.videoDuration)throw Error('Original-quality hero floor');}if(!poster||poster.width!==authored.videoWidth||poster.height!==authored.videoHeight)throw Error('Original-quality poster dimensions');}
 const old='https://raw.githubusercontent.com/effacermonexistence/codex/0477cb93c14979e2316113d1c47a0308653a757b/media/hero-recursive-soft-no11.mp4';
 const boot='<script data-hero-source-selection>(function(s){if(matchMedia("(prefers-reduced-motion:reduce)").matches)return;var v=s.previousElementSibling,p=v.querySelector("source");p.src=matchMedia("(max-width:767px)").matches?p.dataset.heroMobile:p.dataset.heroDesktop;v.load();})(document.currentScript);</script>';
 return{delivery,assets:[{asset:heroAsset,bytes:hero},{asset:fieldAsset,bytes:field}],render(html,route){
  if(!['/','/exist','/exist-fr'].includes(route))return html;
  if(poster){if(html.split(oldPoster).length!==3)throw Error('Hero poster replacement boundary');html=html.replaceAll(oldPoster,poster.url);}
  const source='<source src="'+old+'" type="video/mp4">';
  if(html.split(source).length!==2)throw Error('Hero performance source boundary');
  html=html.replace(source,'<source data-hero-source data-hero-mobile="'+delivery.profiles.mobile.url+'" data-hero-desktop="'+delivery.profiles.desktop.url+'" type="video/mp4">');
  const anchor=/<video\b[^>]*>[\s\S]*?data-hero-source[\s\S]*?<\/video>/g;
  if([...html.matchAll(anchor)].length!==1)throw Error('Hero performance video boundary');
  html=html.replace(anchor,m=>m+boot);
  for(const[id,url]of[['effacer-home-hero-runtime',heroAsset],['effacer-fullfield-runtime',fieldAsset]]){
   const rx=new RegExp('(<script id="'+id+'" src=")[^"]+(" defer><\\/script>)','g');
   if([...html.matchAll(rx)].length!==1)throw Error('Hero performance runtime boundary '+id);html=html.replace(rx,'$1'+url+'$2');
  }
  return html;
 },serve(req,res,pathname){
  const p=files.get(pathname);if(!p)return false;
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return true;}
  const headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'public, max-age=31536000, immutable','ETag':'"sha256-'+p.sha256+'"','X-Content-Type-Options':'nosniff'};
  let range;if(req.headers.range&&(!req.headers['if-range']||req.headers['if-range']===headers.ETag)){range=parseRange(req.headers.range,p.bytes);if(!range){res.writeHead(416,{...headers,'Content-Range':'bytes */'+p.bytes,'Content-Length':0}).end();return true;}}
  if(!range&&req.headers['if-none-match']===headers.ETag){res.writeHead(304,headers).end();return true;}
  const start=range?.start??0,end=range?.end??p.bytes-1;headers['Content-Length']=end-start+1;if(range)headers['Content-Range']=`bytes ${start}-${end}/${p.bytes}`;res.writeHead(range?206:200,headers);if(req.method==='HEAD'){res.end();return true;}
  const stream=fs.createReadStream(p.file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);return true;
 }};
}
module.exports={homeMotionPerformance};
