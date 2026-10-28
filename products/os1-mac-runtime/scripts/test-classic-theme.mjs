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
check(world.includes('materials.accent.color.set(hex)')&&world.includes('this.teamMaterial.color.set(hex)')&&world.includes('this.selection.material.color.set(hex)'),'industrial Command Center, mechanical team panels and selection use the shared accent');
check(scene.includes('this.renderer.setSize(640,316,false)')&&scene.includes('canvas(640,480)'),'original640x480HUD stage and640x3163Dground viewport remain locked');
check(scene.includes("from './voxel-hud.js'")&&scene.includes('new VoxelHUD(this.hudCanvas)')&&!/classic-reference\.png|classic-terrain\.png|scv-body\.png|new\s+Image/.test(scene),'complete active HUD is procedural voxel art, with zero classic bitmap loading');
check(JSON.parse(read('SimulationGarden/package.json')).dependencies.three==='0.180.0','3D renderer is pinned locally, not a floating CDN dependency');
const css=read('SimulationGarden/src/style.css').replace(/\/\*[\s\S]*?\*\//g,'');
const start=js.indexOf("$('#app').innerHTML=`")+"$('#app').innerHTML=`".length,end=js.indexOf('`;',start),html=js.slice(start,end);
const tags=[...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].map(m=>({tag:m[1].toLowerCase(),attrs:Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]]))}));
const nodes=new Map(tags.filter(t=>t.attrs.id).map(t=>[t.attrs.id,t]));
const classes=t=>new Set((t?.attrs.class||'').split(/\s+/));
const panelIDs=['fleet','selected-info','order-panel','transmission','menu-panel','help-panel','preview-banner','resource-bar','field-summary','field-empty'];
check(classes(nodes.get('game')).has('mc-interface'),'entire fixed-stage interface opts into block skin');
check(nodes.size===77,'all76 accepted static IDs plusUI-onlytooltip are retained');
for(const id of panelIDs)check(classes(nodes.get(id)).has('mc-panel'),'panel skin missing '+id);
const buttons=tags.filter(t=>t.tag==='button');for(const b of buttons)check(classes(b).has('mc-button'),'button has leftover skin '+b.attrs.id);
for(const id of['order-panel','transmission','menu-panel','help-panel'])check(classes(nodes.get(id)).has('mc-modal'),'modal skin missing '+id);
for(const id of['search','prompt'])check(classes(nodes.get(id)).has('mc-input'),'input skin missing '+id);
check(classes(nodes.get('preview-budget')).has('mc-select'),'preview select block skin');
const render=js.slice(js.indexOf('function render(){'),js.indexOf('scene=new VoxelScene'));
check(/class="mc-button session/.test(render),'dynamically emitted session rows receive the same block button skin');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m=>({selectors:m[1].split(',').map(s=>s.trim()),body:m[2]}));
const rule=selector=>rules.filter(r=>r.selectors.includes(selector)).map(r=>r.body).join(';');
for(const selector of['.mc-panel','.mc-button','.mc-button:hover:not(:disabled)','.mc-button:active:not(:disabled)','.mc-button:focus-visible','.mc-button:disabled','.mc-button.hotspot:focus-visible','.mc-button.hotspot:disabled','.mc-input','.mc-select','.mc-input:focus','.mc-select:focus','.mc-input:disabled','.mc-select:disabled'])check(rule(selector).length>0,'missing scoped block-skin state '+selector);
check(rule('.mc-panel').includes('box-shadow:')&&rule('.mc-button').includes('inset'),'actual stone bevel rules, not class labels only');
check(rule('.mc-button:disabled').includes('cursor:default')&&rule('.mc-button:focus-visible').includes('outline:'),'disabled and keyboard focus remain visibly distinct');
check(!/url\s*\(|@import|@font-face/.test(css),'interface skin loads no bitmap, remote stylesheet or font');
check(nodes.get('ui-tooltip')?.attrs.role==='tooltip'&&js.includes("tip.textContent=label")&&!js.includes('tip.innerHTML'),'custom block tooltip uses text rather than HTML injection');
const tt=js.slice(js.indexOf('function showTooltip('),js.indexOf("document.addEventListener('pointerover'"));check(!/\bpost\s*\(|messageHandlers/.test(tt),'tooltip has no native command authority');
const matrix={panels:panelIDs,modals:['order-panel','transmission','menu-panel','help-panel'],staticButtons:buttons.map(b=>b.attrs.id),dynamicButtons:'session rows',inputs:['search','prompt'],selects:['preview-budget'],buttonStates:['normal','hover','active','focus-visible','disabled'],hotspotStates:['hover','active','focus-visible','disabled'],tooltip:'plain text, UI-only',billboard:'actual procedural canvas/nearest material tested in voxel CPU contract'};
console.log(JSON.stringify({status:'PASS',checks,uiCoverageMatrix:matrix,scope:'native accent/origin gates plus actual emitted markup and scoped CSS skin coverage; not browser computed pixels or GPU proof'}));
