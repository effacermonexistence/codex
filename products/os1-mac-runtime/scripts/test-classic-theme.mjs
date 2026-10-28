#!/usr/bin/env node
import fs from 'node:fs';import assert from 'node:assert/strict';import {normalizeAccent,accentRGB,PINK} from '../SimulationGarden/src/theme.js';
const base=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,base),'utf8');let checks=0;const check=(v,m)=>{assert(v,m);checks++};
check(PINK==='#EDB3CC','existing OS1 pink');check(normalizeAccent('#72b7ff')==='#72B7FF','valid hex normalized');
for(const bad of [undefined,null,'pink','#fff','url(https://bad)','#EDB3CC;bad'])check(normalizeAccent(bad)===PINK,'invalid theme rejected');
check(JSON.stringify(accentRGB(PINK))==='[237,179,204]','exact default RGB');
const js=read('SimulationGarden/src/main.js'),view=read('Sources/OS1App/SimulationGardenView.swift'),app=read('Sources/OS1App/OS1App.swift');
check(js.includes('d.accentHex'),'snapshot dedup includes appearance');check(js.includes('scene?.setAccent(accent)'),'renderer uses same theme');
check(js.includes('if(e.metaKey||e.ctrlKey||e.altKey)return'),'game keys never steal native command shortcuts');
check(view.includes('let accentHex: String'),'native palette on same state channel');
// Parse the existing exact command allowlist, not the position of its final
// member. Inspection/review may legitimately follow settings in that gate.
const gates=[...view.matchAll(/\[((?:\s*"[^"]+"\s*,?)+)\]\.contains\(action\)/g)]
 .map(match=>[...match[1].matchAll(/"([^"]+)"/g)].map(value=>value[1]));
const allowed=gates.find(values=>values.includes('ready'));
const expected=['ready','select','open','new','close','order','stop','settings','inspect','review'];
check(allowed&&allowed.length===new Set(allowed).size&&JSON.stringify([...allowed].sort())===JSON.stringify([...expected].sort()),'settings belongs to the exact intended native command gate');
check(view.includes('message.frameInfo.isMainFrame'),'native command gate requires main frame');
check(view.includes('webView?.url?.standardizedFileURL == entry')&&view.includes('url.isFileURL'),'native command gate preserves exact bundled file origin');
check(view.includes('.nonPersistent()'),'native appearance does not share website credentials');
check(app.includes('accentHex: store.appSettings.resolvedAccentColor'),'settings is sole theme authority');
check(app.includes('if action == "settings" { profileNavigation.sheet = .settings; return }'),'theme opens actual OS1 Settings');
check(app.includes('OS1AppearanceSettingsRow(accent: store.appSettings.resolvedAccentColor)'),'native palette chooser');
// Keep this historical script name for release callers; its active visual
// contract is now the explicitly user-authorized procedural voxel replacement.
const scene=read('SimulationGarden/src/voxel-scene.js'),world=read('SimulationGarden/src/voxel-world.js');
check(scene.includes('normalizeAccent(value)')&&scene.includes('this.world?.updateAccent(next)')&&scene.includes('this.workforce?.setAccent(next)'),'same validated native accent reaches world and worker materials');
check(world.includes('materials.accent.color.set(hex)')&&world.includes('this.hatMaterial.color.set(hex)')&&world.includes('this.selection.material.color.set(hex)'),'voxel architecture, hats and selection use the shared accent');
check(scene.includes('container.clientWidth')&&scene.includes('container.clientHeight')&&scene.includes('this.renderer.setSize(w,h,false)'),'voxel viewport resizes to native available space, not fixed screenshot dimensions');
check(!/classic-reference\.png|classic-terrain\.png|scv-body\.png/.test(scene),'historical artwork is not an active visual fallback');
check(JSON.parse(read('SimulationGarden/package.json')).dependencies.three==='0.180.0','3D renderer is pinned locally, not a floating CDN dependency');
console.log(JSON.stringify({status:'PASS',checks,scope:'native accent normalization/origin gate and active voxel material/viewport source contracts; no provider calls or GPU pixel claim'}));
