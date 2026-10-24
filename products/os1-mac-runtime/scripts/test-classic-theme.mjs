#!/usr/bin/env node
import fs from 'node:fs';import assert from 'node:assert/strict';import {normalizeAccent,accentRGB,PINK} from '../SimulationGarden/src/theme.js';
const base=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,base),'utf8');let checks=0;const check=(v,m)=>{assert(v,m);checks++};
check(PINK==='#EDB3CC','existing OS1 pink');check(normalizeAccent('#72b7ff')==='#72B7FF','valid hex normalized');
for(const bad of [undefined,null,'pink','#fff','url(https://bad)','#EDB3CC;bad'])check(normalizeAccent(bad)===PINK,'invalid theme rejected');
check(JSON.stringify(accentRGB(PINK))==='[237,179,204]','exact default RGB');
const js=read('SimulationGarden/src/main.js'),view=read('Sources/OS1App/SimulationGardenView.swift'),app=read('Sources/OS1App/OS1App.swift');
check(js.includes('d.accentHex'),'snapshot dedup includes appearance');check(js.includes('scene?.setAccent(accent)'),'renderer uses same theme');
check(js.includes('if(e.metaKey||e.ctrlKey||e.altKey)return'),'game keys never steal native command shortcuts');
check(view.includes('let accentHex: String'),'native palette on same state channel');check(view.includes('"settings"].contains(action)'),'settings uses exact native gate');
check(app.includes('accentHex: store.appSettings.resolvedAccentColor'),'settings is sole theme authority');
check(app.includes('if action == "settings" { profileNavigation.sheet = .settings; return }'),'theme opens actual OS1 Settings');
check(app.includes('OS1AppearanceSettingsRow(accent: store.appSettings.resolvedAccentColor)'),'native palette chooser');
const ref=JSON.parse(read('SimulationGarden/public/reference.json'));check(ref.width===640&&ref.height===480,'classic 640x480 stage');check(ref.wholeFrameIdentical===false,'intentional theme changes are not called full-frame identity');
console.log(JSON.stringify({status:'PASS',checks,scope:'theme normalization, native bridge, source contracts; no provider calls'}));
