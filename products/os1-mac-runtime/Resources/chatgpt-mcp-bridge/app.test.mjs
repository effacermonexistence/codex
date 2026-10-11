import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {waitForReturn} from './client.mjs';

const html = readFileSync(new URL('./app.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
const drain = () => new Promise(resolve => setImmediate(resolve));
async function harness({messageFails=false, initFails=false, wrongSource=false, blocked=false}={}) {
  const events = new Map(), elements = new Map(), requests=[], timers=new Map();
  let timerID=0, delivered=false, acknowledged=false;
  const element = id => {if (!elements.has(id)) elements.set(id,{textContent:'',disabled:true,addEventListener:(name,fn)=>events.set(id+':'+name,fn)});return elements.get(id);};
  const parent = {postMessage(message) {
    requests.push(message); if (message.id === undefined) return;
    let result={},error;
    if (message.method === 'ui/initialize' && initFails) error={code:-1};
    if (message.method === 'ui/message') {delivered=true;if(messageFails) error={code:-1};}
    if (message.method === 'tools/call') {
      switch(message.params.name) {
        case 'os1_chat_connect':result={_meta:{bridge:{connection_id:'fixture-connection'}}};break;
        case 'os1_chat_next':result={_meta:{bridge:blocked?{state:'blocked',reason:'diagnostic_activation_required'}:delivered?{state:'idle'}:{state:'offered',request:{request_id:'fixture-request',task_id:'fixture-task',request_sha256:'a'.repeat(64),policy_sha256:'b'.repeat(64),prompt:'5+5',policy_text:'Return the requested result.',return_token:'c'.repeat(64),dispatch_token:'d'.repeat(64)}}}};break;
        case 'os1_chat_dispatched':acknowledged=true;result={_meta:{bridge:{state:'dispatched'}}};break;
        case 'os1_chat_status':result={_meta:{bridge:{state:acknowledged?'returned':'offered'}}};break;
        default:throw Error('unexpected_tool');
      }
    }
    queueMicrotask(()=>events.get('message')?.({source:wrongSource?{}:parent,origin:'https://chatgpt.com',data:{jsonrpc:'2.0',id:message.id,...(error?{error}:{result})}}));
  }};
  const window={parent,addEventListener:(name,fn)=>events.set(name,fn)};
  vm.runInNewContext(script,{window,document:{getElementById:element},setTimeout:(fn,ms)=>{const id=++timerID;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),console});
  for(let i=0;i<10;i++) await drain();
  return {events,elements,requests,timers,async tick(){const item=[...timers].find(([,x])=>x.ms===1500);if(item){timers.delete(item[0]);item[1].fn();}for(let i=0;i<10;i++)await drain();}};
}

test('registered host sends exactly once and waits for result callback, not ACK',async()=>{
  const h=await harness();
  assert.equal(h.requests.filter(x=>x.method==='ui/message').length,1);
  assert.match(h.elements.get('state').textContent,/Waiting for result/);
  await h.tick();
  assert.match(h.elements.get('state').textContent,/returned/);
  await h.tick();
  assert.equal(h.requests.filter(x=>x.method==='ui/message').length,1);
  const sent=h.requests.find(x=>x.method==='ui/message');
  const payload=JSON.parse(sent.params.content[0].text);
  assert.equal(payload.request,'5+5');assert.equal(payload.binding.request_id,'fixture-request');
  assert.ok(!h.requests.some(x=>x.params?.name==='os1_return_result'),'widget cannot fabricate model callback');
});
test('ambiguous/rejected send stops without resend or dispatch ACK',async()=>{
  const h=await harness({messageFails:true});await h.tick();
  assert.match(h.elements.get('state').textContent,/interrupted/);
  assert.equal(h.requests.filter(x=>x.method==='ui/message').length,1);
  assert.ok(!h.requests.some(x=>x.params?.name==='os1_chat_dispatched'));
});
test('host initialization rejection sends no request',async()=>{
  const h=await harness({initFails:true});assert.equal(h.requests.length,1);
  assert.match(h.elements.get('state').textContent,/initialization failed/);
});
test('blocked mailbox is visible and stops, never masquerades as ready',async()=>{
  const h=await harness({blocked:true});await h.tick();
  assert.match(h.elements.get('state').textContent,/Delivery held: diagnostic_activation_required/);
  assert.ok(!h.requests.some(x=>x.method==='ui/message'));
});
test('unrelated window cannot initialize or inject a task',async()=>{
  const h=await harness({wrongSource:true});assert.equal(h.requests.length,1);
  assert.ok(!h.requests.some(x=>x.method==='tools/call'));
});
test('closing widget never silently retries a dispatched request',async()=>{
  const h=await harness();h.events.get('pagehide')();await h.tick();
  assert.equal(h.requests.filter(x=>x.method==='ui/message').length,1);
  assert.match(h.elements.get('state').textContent,/closed/);
});
test('client timeout preserves uncertain journal and does not resubmit',async()=>{
  let cancelled=false;
  const result=await waitForReturn({status:()=>({state:'dispatched'}),cancel:()=>{cancelled=true;}},'test',{timeoutMS:0});
  assert.equal(result.retry_safe,false);assert.equal(result.wait_timed_out,true);assert.equal(cancelled,false);
});
test('client cancellation delegates once and never turns it into an answer',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  const result=await waitForReturn({status:()=>({state:'dispatched'}),cancel:()=>{calls++;return{state:'cancelled'};}},'test',{signal:controller.signal});
  assert.equal(result.state,'cancelled');assert.equal(calls,1);
});
test('surface has no browser automation, provider endpoint, or credential access',()=>{
  for(const forbidden of ['api.openai.com','api.anthropic.com','localhost','127.0.0.1','fetch(','XMLHttpRequest','CODEX_APP_TOOLS_PIPE_PATH','document.cookie'])assert.ok(!html.includes(forbidden),forbidden);
  assert.ok(html.includes('textContent = r.prompt'));
});
