import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const html=readFileSync(fileURLToPath(new URL('./app.html',import.meta.url)),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const request={request_id:'synthetic-fixture',request_sha256:'a'.repeat(64),prompt:'1+1',return_token:'b'.repeat(64),dispatch_token:'c'.repeat(64)};
async function fixture({extended=true,messageError=false,nextState='offered',nextReplies=[],ackError=false,standalone=false}={}){
  const elements=new Map(['state','details','stop'].map(id=>[id,{textContent:'',disabled:true,listeners:{},addEventListener(k,f){this.listeners[k]=f;}}]));
  const listeners={},calls=[],timers=new Map();let serial=0,nextCall=0;
  const parent={postMessage(message,origin){
    calls.push({message,origin});
    if(message.id===undefined)return;
    let result,rpcError;
    if(message.method==='ui/initialize')result={hostInfo:{name:'fixture-host',version:'1'},hostCapabilities:extended?{experimental:{'openai/message':{}}}:{}};
    else if(message.method==='tools/call'&&message.params.name==='os1_probe_next'){
      const reply=nextReplies[nextCall++]??nextState;
      if(typeof reply==='object'&&reply.error){
        if(reply.rpc)rpcError={code:-32602,message:reply.error};
        else result={isError:true,content:[{type:'text',text:reply.error}]};
      }else result={_meta:{bridge:reply==='offered'?{state:'offered',request}:{state:reply}}};
    }
    else if(message.method==='tools/call'&&message.params.name==='os1_probe_dispatched')result=ackError?{isError:true,content:[{type:'text',text:'probe_rate_limited'}]}:{structuredContent:{state:'acknowledged'}};
    else if(message.method==='ui/message')result={};
    else throw Error('unexpected fixture call');
    queueMicrotask(()=>listeners.message?.({source:parent,origin:'https://chatgpt.com',data:rpcError?{jsonrpc:'2.0',id:message.id,error:rpcError}:message.method==='ui/message'&&messageError?{jsonrpc:'2.0',id:message.id,error:{code:-1,message:'blocked'}}:{jsonrpc:'2.0',id:message.id,result}}));
  }};
  const window={parent,addEventListener(k,f){listeners[k]=f;}};
  if(standalone)window.parent=window;
  const ctx={window,document:{getElementById:id=>elements.get(id)},Map,Promise,Error,String,JSON,clearTimeout:id=>timers.delete(id),setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;}};
  vm.runInNewContext(script,ctx);
  for(let n=0;n<16;n++)await new Promise(r=>setImmediate(r));
  async function runTimer(ms){
    const entry=[...timers].find(([,value])=>value.ms===ms);assert.ok(entry,`missing timer ${ms}`);
    timers.delete(entry[0]);entry[1].fn();
    for(let n=0;n<16;n++)await new Promise(r=>setImmediate(r));
  }
  return {elements,listeners,calls,timers,runTimer};
}
test('registered host sends one immutable synthetic request, then ACK—not a completion',async()=>{
  const f=await fixture();
  const sends=f.calls.filter(x=>x.message.method==='ui/message');assert.equal(sends.length,1);
  assert.equal(sends[0].message.params._meta['openai/message'].target,'new');
  assert.equal(sends[0].message.params._meta['openai/message'].send,true);
  const payload=JSON.parse(sends[0].message.params.content[0].text);
  assert.equal(payload.request,'1+1');assert.equal(payload.binding.request_id,request.request_id);
  assert.equal(payload.binding.return_token,request.return_token);
  const methods=f.calls.filter(x=>x.message.method==='tools/call').map(x=>x.message.params.name);
  assert.deepEqual(methods,['os1_probe_next','os1_probe_dispatched']);
  assert.match(f.elements.get('state').textContent,/Awaiting actual callback/);
  assert.doesNotMatch(f.elements.get('details').textContent,/bbbbbbbb|cccccccc/);
  assert.equal(f.calls.some(x=>x.message.method==='os1_probe_return'),false);
});
test('host without advertised extended targeting is held without sending',async()=>{
  const f=await fixture({extended:false});
  assert.equal(f.calls.filter(x=>x.message.method==='ui/message').length,0);
  assert.equal(f.calls.filter(x=>x.message.method==='tools/call').length,0);
  assert.match(f.elements.get('state').textContent,/Nothing sent/);
});
test('denied host submission is not acknowledged, retried, or switched to another backend',async()=>{
  const f=await fixture({messageError:true});
  assert.equal(f.calls.filter(x=>x.message.method==='ui/message').length,1);
  assert.equal(f.calls.some(x=>x.message.params?.name==='os1_probe_dispatched'),false);
  assert.match(f.elements.get('state').textContent,/no resend or Codex fallback/);
});
test('already-offered durable state cannot dispatch again',async()=>{
  const f=await fixture({nextState:'busy'});
  assert.equal(f.calls.some(x=>x.message.method==='ui/message'),false);
  assert.match(f.elements.get('state').textContent,/No resend/);
});
test('standalone HTML cannot acquire registered host authority',async()=>{
  const f=await fixture({standalone:true});assert.equal(f.calls.length,0);
  assert.match(f.elements.get('state').textContent,/genuinely registered/);
});
test('teardown and user stop never send cancellation or replay',async()=>{
  const f=await fixture();const before=f.calls.filter(x=>x.message.method==='ui/message').length;
  f.elements.get('stop').listeners.click();
  assert.equal(f.calls.filter(x=>x.message.method==='ui/message').length,before);
  assert.equal(f.calls.some(x=>x.message.params?.name==='os1_probe_cancel'),false);
  assert.match(f.elements.get('state').textContent,/Already submitted model work may continue/);
});
test('terminal states stop observing instead of polling an empty mailbox',async()=>{
  for(const nextState of ['expired','cancelled','returned','effects_uncertain']){
    const f=await fixture({nextState});
    assert.equal(f.timers.size,0);
    assert.equal(f.calls.some(x=>x.message.method==='ui/message'),false);
    assert.match(f.elements.get('state').textContent,new RegExp('Diagnostic state: '+nextState));
  }
});
test('idle polling is slower and has a finite observation budget',async()=>{
  const f=await fixture({nextState:'idle'});
  assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].ms,5000);
  for(let n=1;n<120;n++)await f.runTimer(5000);
  assert.equal(f.timers.size,0);
  assert.equal(f.calls.filter(x=>x.message.params?.name==='os1_probe_next').length,120);
  assert.equal(f.calls.some(x=>x.message.method==='ui/message'),false);
  assert.match(f.elements.get('state').textContent,/observation window/);
});
test('known rate rejection before an offer gets only two read-only backoffs',async()=>{
  for(const rpc of [false,true]){
    const f=await fixture({nextReplies:Array(3).fill({error:'probe_rate_limited',rpc})});
    await f.runTimer(60000);await f.runTimer(60000);
    assert.equal(f.timers.size,0);
    assert.equal(f.calls.filter(x=>x.message.params?.name==='os1_probe_next').length,3);
    assert.equal(f.calls.some(x=>x.message.method==='ui/message'),false);
    assert.match(f.elements.get('state').textContent,/backoff exhausted/);
  }
});
test('a pre-offer rate backoff can recover without sending twice',async()=>{
  const f=await fixture({nextReplies:[{error:'probe_rate_limited',rpc:true},'offered']});
  await f.runTimer(60000);
  assert.equal(f.calls.filter(x=>x.message.method==='ui/message').length,1);
  assert.equal(f.timers.size,0);
});
test('rate rejection after message submission cannot retry the message or ACK',async()=>{
  const f=await fixture({ackError:true});
  assert.equal(f.calls.filter(x=>x.message.method==='ui/message').length,1);
  assert.equal(f.calls.filter(x=>x.message.params?.name==='os1_probe_dispatched').length,1);
  assert.equal(f.timers.size,0);
  assert.match(f.elements.get('state').textContent,/Outcome may be uncertain/);
});
test('unknown lookup failure does not acquire rate-retry permission',async()=>{
  const f=await fixture({nextReplies:[{error:'binding_invalid'}]});
  assert.equal(f.timers.size,0);
  assert.equal(f.calls.some(x=>x.message.method==='ui/message'),false);
  assert.match(f.elements.get('state').textContent,/Nothing sent/);
});
