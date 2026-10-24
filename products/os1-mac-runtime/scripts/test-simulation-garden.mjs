#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=fs.readFileSync(path.join(root,'Sources/OS1App/OS1App.swift'),'utf8');
const view=fs.readFileSync(path.join(root,'Sources/OS1App/SimulationGardenView.swift'),'utf8');
const js=fs.readFileSync(path.join(root,'SimulationGarden/src/main.js'),'utf8');
const scene=fs.readFileSync(path.join(root,'SimulationGarden/src/terran-scene.js'),'utf8');
assert(app.includes('.accessibilityIdentifier("os1.rail.simulation")'));
assert(app.includes('name: session.title'), 'unit title must come from actual conversation');
assert(app.includes('id: session.id.uuidString'), 'unit identity must be the OS1 UUID');
assert(app.includes('let running = isSessionRunning(session.id)'), 'animation must reflect actual engine state');
assert(app.includes('store.composer = text\n            store.send()'), 'use existing send path');
assert(app.includes('store.cancelSelectedRun()'), 'use existing cancellation');
assert(app.includes('store.createSession()'), 'new SCV must be a native session');
assert(app.includes('store.composer.trimmingCharacters'), 'do not overwrite existing drafts');
assert(view.includes('message.frameInfo.isMainFrame') && view.includes('webView?.url?.standardizedFileURL == entry'), 'only trusted bundled page may dispatch');
assert(view.includes('.nonPersistent()'), 'no shared website credentials');
assert(!view.includes('Process()') && !js.includes('fetch(') && !js.includes('localStorage'), 'no second engine or session store');
assert(scene.includes('if(!this.enabled||!this.loaded)return'), 'hidden surface must stop frame work');
assert(scene.includes('this.sessions.some(s=>s.id===u.id)'), 'nonvisible workers must not receive clicks');
assert(scene.includes("s.status==='working'"), 'real active state only');
const dest=path.join(root,'Resources/SimulationGarden'),manifest=JSON.parse(fs.readFileSync(path.join(dest,'manifest.json'),'utf8'));
for(const entry of manifest.files){assert(/^(index\.html|THREE-LICENSE\.txt|terran-reference\.jpg|terran-cleanplate\.png|reference\.json|assets\/index-[a-zA-Z0-9_-]+\.(js|css))$/.test(entry.path),'asset path outside exact resource contract');const b=fs.readFileSync(path.join(dest,entry.path));assert.equal(b.length,entry.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),entry.sha256)}
const html=fs.readFileSync(path.join(dest,'index.html'),'utf8');assert(!html.includes('type="module"'));assert(html.includes("connect-src 'none'"));
console.log(JSON.stringify({status:'PASS',checks:16,assetFiles:manifest.files.length,basis:'deterministic source and asset integrity; native render separately verified'}));
