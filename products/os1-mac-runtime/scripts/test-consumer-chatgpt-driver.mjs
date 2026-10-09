import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';

const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'os1-consumer-fixture-'));
process.env.OS1_BROWSER_TRANSPORT_ROOT=tmp;
const helper=fileURLToPath(new URL('../Resources/consumer-chatgpt-driver.mjs',import.meta.url));
const {hash,ordinaryURL,checkedRequest,uidFor,parsedScript,chatReady,completedAnswer,oneShot,stateProbe}=await import(pathToFileURL(helper));
let checks=0;
const ok=(x)=>{assert.ok(x);checks++;};
const throws=f=>{assert.throws(f);checks++;};
try {
  ok(ordinaryURL('https://chatgpt.com/'));
  ok(ordinaryURL('https://chatgpt.com/c/abc-123'));
  for(const value of ['http://chatgpt.com/','https://chatgpt.com.evil/','https://user@chatgpt.com/','https://chatgpt.com/work','https://chatgpt.com/c/id?token=x','https://chatgpt.com:9443/'])ok(!ordinaryURL(value));
  const q={action:'run',prompt:'1+1',request_sha256:hash('1+1'),policy_projection:'locked'};
  ok(checkedRequest(q)===q);
  throws(()=>checkedRequest({...q,request_sha256:hash('2+2')}));
  throws(()=>checkedRequest({...q,cookie:'never'}));
  throws(()=>checkedRequest({...q,action:'login'}));
  throws(()=>checkedRequest({...q,prompt:'x'.repeat(40001)}));
  throws(()=>checkedRequest({...q,policy_projection:'x'.repeat(24001)}));
  const snapshot='uid=1_1 textbox "Ask ChatGPT"\nuid=1_2 button "Send message"';
  ok(uidFor(snapshot,'textbox',['Ask ChatGPT'])==='1_1');
  throws(()=>uidFor(snapshot+'\nuid=1_3 textbox "Ask ChatGPT"','textbox',['Ask ChatGPT']));
  throws(()=>uidFor('uid=1_2 button "Send message" disabled','button',['Send message']));
  const state={url:'https://chatgpt.com/',login:false,composer:1,modes:[{name:'Chat',pressed:'true'},{name:'Work',pressed:'false'}],stopping:false,complete:true,messages:[{role:'user',text:'1+1'},{role:'assistant',text:'2'}]};
  ok(chatReady(state));ok(!chatReady({...state,login:true}));ok(!chatReady({...state,modes:[]}));
  ok(!chatReady({...state,modes:[{name:'Work',pressed:'true'}]}));
  ok(completedAnswer(state,'1+1',state.url)==='2');
  for(const mutation of [{complete:false},{stopping:true},{login:true},{url:'https://evil/'},{messages:[{role:'user',text:'other'},{role:'assistant',text:'2'}]},{messages:[{role:'user',text:'1+1'},{role:'assistant',text:'2'},{role:'assistant',text:'3'}]},{modes:[{name:'Work',pressed:'true'}]}])ok(completedAnswer({...state,...mutation},'1+1',state.url)===null);
  ok(completedAnswer({...state,modes:[]},'1+1',state.url)==='2'); // mode proof survives reply-only layout, exact own request required
  throws(()=>parsedScript({isError:true}));
  ok(parsedScript({content:[{type:'text',text:'Script ran\n```json\n{"ok":true}\n```'}]}).ok);
  throws(()=>parsedScript({content:[{type:'text',text:'not-json'}]}));
  ok(!/fetch\(|cookie|localStorage|sessionStorage|__react|setAttribute|\.click\(/.test(stateProbe));
  ok((await oneShot({action:'status'})).state==='approval_required');
  ok((await oneShot(q)).state==='approval_required');
  await fs.writeFile(path.join(tmp,'config.json'),JSON.stringify({enabled:true,controlIntent:true}),{mode:0o600});
  ok((await oneShot({action:'status'})).state==='approval_required'); // flags do not invent connection
  const run=spawnSync(process.execPath,[helper],{input:JSON.stringify(q),env:{PATH:'/usr/bin:/bin',HOME:os.homedir(),OS1_BROWSER_TRANSPORT_ROOT:tmp},encoding:'utf8',timeout:5000});
  ok(run.status===0);ok(JSON.parse(run.stdout).state==='approval_required');
  ok(!await fs.stat(path.join(tmp,'consumer.sock')).then(()=>true,()=>false));
  // A packaged helper path containing spaces must execute its actual entrypoint.
  const spaced=path.join(tmp,'OS-1 App resources');await fs.mkdir(spaced);const copy=path.join(spaced,'consumer-chatgpt-driver.mjs');await fs.copyFile(helper,copy);
  const copied=spawnSync(process.execPath,[copy],{input:'{"action":"status"}',env:{PATH:'/usr/bin:/bin',HOME:os.homedir(),OS1_BROWSER_TRANSPORT_ROOT:tmp},encoding:'utf8',timeout:5000});
  ok(copied.status===0);ok(JSON.parse(copied.stdout).state==='approval_required');
  console.log(`PASS consumer ChatGPT driver ${checks} checks; actual MCP/browser/provider calls=0`);
} finally {await fs.rm(tmp,{recursive:true,force:true});}
