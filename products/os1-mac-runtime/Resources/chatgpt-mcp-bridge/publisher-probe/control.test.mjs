import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,linkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {control,readOperatorKey} from './control.mjs';
const url='https://os1-native-chat-probe.fixture.workers.dev/';
function fixture(){const root=mkdtempSync(join(tmpdir(),'os1-probe-control-test-'));const path=join(root,'dummy.key');writeFileSync(path,'a'.repeat(64),{mode:0o600});return {root,path,close:()=>rmSync(root,{recursive:true,force:true})};}
test('operator control sends fixed operation and filters all capabilities from terminal result',async()=>{
  const f=fixture();try{
    let seen;
    const result=await control({action:'start',url,keyPath:f.path,fetcher:async(u,o)=>{seen={u:String(u),o};return Response.json({state:'queued',request_id:'probe-fixture',return_token:'do-not-output',operator_key:'do-not-output',native_host_verified:false});}});
    assert.equal(seen.u,url+'ops/start');assert.equal(seen.o.body,'{}');assert.equal(seen.o.redirect,'error');
    assert.equal(seen.o.headers.Authorization,'Bearer '+'a'.repeat(64));
    assert.deepEqual(result,{state:'queued',request_id:'probe-fixture',native_host_verified:false});
    assert.equal(JSON.stringify(result).includes('do-not-output'),false);
  }finally{f.close();}
});
test('result is a fixed read without arbitrary query, prompt or body',async()=>{
  const f=fixture();try{
    await control({action:'result',url,keyPath:f.path,fetcher:async(u,o)=>{assert.equal(o.method,'GET');assert.equal(o.body,undefined);assert.equal(String(u),url+'ops/result');return Response.json({state:'idle'});}});
  }finally{f.close();}
});
test('non-HTTPS, secret-bearing and non-probe URLs reject before networking',async()=>{
  const f=fixture();try{
    for(const u of ['http://127.0.0.1/','https://evil.example/','https://token@example.com/','https://os1-native-chat-probe.fixture.workers.dev/?key=x','https://os1-native-chat-probe.fixture.workers.dev/mcp']){
      await assert.rejects(control({action:'start',url:u,keyPath:f.path,fetcher:()=>{throw Error('must not fetch');}}),/probe_url_invalid/);
    }
  }finally{f.close();}
});
test('operator credential permissions, symlinks and hardlinks are rejected',()=>{
  const f=fixture();try{
    chmodSync(f.path,0o644);assert.throws(()=>readOperatorKey(f.path),/unsafe/);chmodSync(f.path,0o600);
    const alias=join(f.root,'alias');symlinkSync(f.path,alias);assert.throws(()=>readOperatorKey(alias));
    const hard=join(f.root,'hard');linkSync(f.path,hard);assert.throws(()=>readOperatorKey(f.path),/unsafe/);
  }finally{f.close();}
});
test('rejected endpoint cannot echo raw arbitrary error into the CLI',async()=>{
  const f=fixture();try{
    await assert.rejects(control({action:'start',url,keyPath:f.path,fetcher:async()=>Response.json({error:'credential: do-not-output'},{status:401})}),/control_rejected/);
  }finally{f.close();}
});
