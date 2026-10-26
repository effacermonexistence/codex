#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
// Run maintained event/state-machine tests. Never reintroduce assumptions about
// the removed 10.4-second four-lane phase-interpolation implementation.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=path.join(root,'SimulationGarden/tests/workshop-state.test.mjs');
const result=spawnSync(process.execPath,['--test','--test-reporter=tap',fixture],{cwd:root,encoding:'utf8',maxBuffer:1_000_000});
if(result.error)throw result.error;
if(result.status!==0){process.stderr.write(result.stdout||'');process.stderr.write(result.stderr||'');throw Error('Current gameplay state/motion regression failed');}
const passed=[...result.stdout.matchAll(/^ok \d+ - (.+)$/gm)].map(match=>match[1]);
assert(passed.length>=9,'expected maintained gameplay state/motion regression cases');assert(!/^not ok /m.test(result.stdout));
console.log(JSON.stringify({status:'PASS',origin:'deterministic maintained gameplay fixtures, not provider runs',checks:passed.length,checksPassed:passed,fixture:path.relative(root,fixture),fixtureSHA256:createHash('sha256').update(fs.readFileSync(fixture)).digest('hex'),sourceSHA256:Object.fromEntries(['mining-state.js','field-state.js'].map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,'SimulationGarden/src',file))).digest('hex')]))},null,2));
