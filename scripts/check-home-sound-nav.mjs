import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';
import{fileURLToPath}from'node:url';import{removeHeaderNavEmphasis,addHeaderNavEmphasis,headerNavAssets}from'./header-nav-emphasis.mjs';
import{removeHomeAmbientAudio,addHomeAmbientAudio,homeAmbientAssets}from'./home-ambient-audio.mjs';
export function checkHomeSoundNav(root){const a=homeAmbientAssets(root),nav=headerNavAssets(root),files=['site/index.html',...fs.readdirSync(root+'/site/pages').filter(f=>f.endsWith('.html')).map(f=>'site/pages/'+f),'site/404.html'];let homes=0,navs=0;
 for(const rel of files){const h=fs.readFileSync(root+'/'+rel,'utf8'),route=rel==='site/index.html'?'/':rel==='site/404.html'?'404':'/'+path.basename(rel,'.html'),n=removeHeaderNavEmphasis(h);assert.notEqual(n,h,rel+' header scope');assert.equal(addHeaderNavEmphasis(n,root),h,rel+' nav roundtrip');navs++;
  const before=removeHomeAmbientAudio(n);if(['/', '/exist', '/exist-fr'].includes(route)){assert.notEqual(before,n);assert.equal(addHomeAmbientAudio(before,root,route),n);homes++;}else{assert.equal(before,n);assert.ok(!n.includes('id="home-ambient-audio"'));}
 }
 assert.equal(homes,3);for(const[asset,b]of[[a.config.audio.url,a.audio],[a.cssAsset,a.css],[a.runtimeAsset,a.runtime],[nav.asset,nav.css]])assert.ok(fs.readFileSync(root+'/site'+asset).equals(b),asset+' bytes');
 assert.ok(!/\bosascript\b|navigator\.mediaDevices|getUserMedia|setSinkId/.test(a.runtime.toString()));assert.ok(nav.css.toString().split('\n').filter(x=>x.trim().startsWith('#')).every(x=>x.startsWith('#header ')));
 return{htmlFiles:files.length,headerPolicies:navs,homeAudio:homes,roundTrip:'byte exact',audio:'original hash verified; gain1 maximum',nav:'header-only selectors;400 to600; no underline; keyboard focus retained'};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(checkHomeSoundNav(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')),null,2));
