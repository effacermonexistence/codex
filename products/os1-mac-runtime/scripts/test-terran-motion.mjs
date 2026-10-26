#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createWorker, advanceWorker, MINERALS } from '../SimulationGarden/src/mining-state.js';
const snapshot=u=>({id:u.id,phase:u.phase,x:u.x,y:u.y,cargo:u.cargo});
const reports=[];
function check(name,fn){fn();reports.push({name,status:'PASS'});}
check('idle initial SCV does not mine without native activity',()=>{const u=createWorker('native-A',0),before=snapshot(u);for(let i=0;i<200;i++)advanceWorker(u,.05,false);assert.deepEqual(snapshot(u),before);assert(!u.moving&&!u.mining);});
check('active SCV travels toward an actual mineral patch',()=>{const u=createWorker('native-A',0),start=[u.x,u.y];for(let i=0;i<40;i++)advanceWorker(u,.05,true);assert(u.x>start[0]);assert(Math.hypot(u.x-MINERALS[0][0],u.y-MINERALS[0][1])<Math.hypot(start[0]-MINERALS[0][0],start[1]-MINERALS[0][1]));assert(u.moving);});
check('mining phase occurs at the mineral, not at a decorative worksite',()=>{const u=createWorker('native-A',2);for(let i=0;i<95;i++)advanceWorker(u,.05,true);assert(u.mining);assert.equal(u.x,MINERALS[2][0]);assert.equal(u.y,MINERALS[2][1]);});
check('return trip carries a mineral and heads back toward base',()=>{const u=createWorker('native-A',1);for(let i=0;i<145;i++)advanceWorker(u,.05,true);assert(u.cargo&&u.moving);assert(u.x<MINERALS[1][0]);assert.equal(u.facing,-1);});
check('stop mid-route freezes exact position, phase and cargo',()=>{const u=createWorker('native-A',0);for(let i=0;i<151;i++)advanceWorker(u,.05,true);const before=snapshot(u);for(let i=0;i<500;i++)advanceWorker(u,.05,false);assert.deepEqual(snapshot(u),before);assert.equal(u.moving,false);assert.equal(u.mining,false);});
check('same native UUID resumes from the frozen phase without teleporting',()=>{const u=createWorker('native-A',3);for(let i=0;i<20;i++)advanceWorker(u,.05,true);advanceWorker(u,.05,false);const before=snapshot(u);advanceWorker(u,.05,true);assert.equal(u.id,before.id);assert(u.phase>before.phase);assert(Math.hypot(u.x-before.x,u.y-before.y)<10);});
check('mineral trips repeat for as long as the native session runs',()=>{const u=createWorker('native-A',2);let returns=0,prev=false;for(let i=0;i<1000;i++){advanceWorker(u,.05,true);if(!u.cargo&&prev)returns++;prev=u.cargo;}assert(returns>=4);});
check('one stopped worker does not stop another independent session',()=>{const a=createWorker('A',0),b=createWorker('B',1);for(let i=0;i<50;i++){advanceWorker(a,.05,false);advanceWorker(b,.05,true);}assert.equal(a.phase,0);assert(b.phase>0);});
console.log(JSON.stringify({status:'PASS',origin:'deterministic regression fixtures, not provider runs',checks:reports},null,2));
