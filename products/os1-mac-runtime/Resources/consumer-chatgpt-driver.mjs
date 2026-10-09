// Ordinary ChatGPT public UI transport. No Codex/SIWC/API fallback and no
// authentication-cache import. Only a deliberate owner Connect action may
// start the official existing-Chrome-session bridge. status/run NEVER start it.
import fs from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const home = process.env.OS1_BROWSER_USER_HOME || os.homedir();
const root = process.env.OS1_BROWSER_TRANSPORT_ROOT || path.join(home, '.os1/browser-transport');
const socketPath = path.join(root, 'consumer.sock');
const configPath = path.join(root, 'config.json');
const limits = { prompt: 40000, projection: 24000, response: 96000, envelope: 131072 };
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const result = (state, error, fields = {}) => ({ state, ...(error ? { error } : {}), ...fields });
const approval = () => result('approval_required', 'ChatGPT browser control needs an owner-initiated connection. No browser was attached or opened.');
export function ordinaryURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'chatgpt.com' && !u.username && !u.password && !u.port &&
      (u.pathname === '/' || /^\/c\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) && !u.search;
  } catch { return false; }
}
export function checkedRequest(value) {
  if (!value || Array.isArray(value) || Object.keys(value).some(k => !['action','prompt','request_sha256','policy_projection'].includes(k))) throw Error('input_shape');
  if (!['status','run','disconnect'].includes(value.action)) throw Error('input_action');
  if (value.action !== 'run') return { action: value.action };
  if (typeof value.prompt !== 'string' || !value.prompt.trim() || Buffer.byteLength(value.prompt) > limits.prompt ||
      typeof value.policy_projection !== 'string' || Buffer.byteLength(value.policy_projection) > limits.projection ||
      value.request_sha256 !== hash(value.prompt)) throw Error('input_binding');
  return value;
}
export function uidFor(snapshot, role, names) {
  const matching = snapshot.split('\n').map(line => line.match(/^\s*uid=([^\s]+)\s+([^\s]+)\s+"([^"]*)"(.*)$/))
    .filter(m => m && m[2] === role && names.includes(m[3]) && !/\bdisabled\b/.test(m[4]));
  if (matching.length !== 1) throw Error('ambiguous_control');
  return matching[0][1];
}
export function parsedScript(response) {
  if (response.isError) throw Error('browser_tool_failed');
  const text = (response.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const block = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!block || Buffer.byteLength(block[1]) > limits.envelope) throw Error('browser_state_shape');
  return JSON.parse(block[1]);
}
// Fixed read-only DOM probe, only on helper-created chatgpt.com pages. It does
// not read storage, cookies, network headers, React internals or other tabs.
export const stateProbe = `() => {
  const visible = e => !!(e && e.getClientRects().length);
  const buttons = [...document.querySelectorAll('button')].filter(visible);
  const modes = buttons.filter(e => ['Chat','Work'].includes(e.innerText.trim())).map(e => ({ name:e.innerText.trim(), pressed:e.getAttribute('aria-pressed') }));
  const region = document.querySelector('[role="region"][aria-label="Conversation"]') || document.querySelector('main');
  const messages = [];
  if (region) {
    const legacy = [...region.querySelectorAll('[data-message-author-role]')];
    if (legacy.length) for (const e of legacy) messages.push({role:e.getAttribute('data-message-author-role'),text:e.innerText});
    else for (const h of region.querySelectorAll('h4')) {
      if (!['You said:','ChatGPT said:'].includes(h.innerText.trim())) continue;
      const siblings = [...h.parentElement.children].filter(e=>e!==h);
      messages.push({role:h.innerText.trim()==='You said:'?'user':'assistant',text:siblings.map(e=>e.innerText).join('\n').trim()});
    }
  }
  return {url:location.href,modes,login:buttons.some(e=>/^(Log in|Sign up|로그인|가입하기)$/.test(e.innerText.trim())),
    composer:[...document.querySelectorAll('[role="textbox"][contenteditable="true"],textarea')].filter(visible).length,
    stopping:buttons.some(e=>/stop (generating|response)|생성 중지/i.test(e.getAttribute('aria-label')||'')),
    complete:[...document.querySelectorAll('[role="status"],[aria-live]')].filter(e=>/Response complete|응답 완료/.test(e.innerText)).length>0,
    messages:messages.slice(-4)};
}`;
export function chatReady(state) {
  return !!(state && ordinaryURL(state.url) && !state.login && state.composer === 1 &&
    state.modes?.some(m => m.name === 'Chat' && m.pressed === 'true') &&
    !state.modes?.some(m => m.name === 'Work' && m.pressed === 'true'));
}
export function completedAnswer(state, sentText, verifiedChatURL) {
  if (!ordinaryURL(state?.url) || state.login || state.stopping || !state.complete || !ordinaryURL(verifiedChatURL)) return null;
  if (state.modes?.some(m => m.name === 'Work' && m.pressed === 'true')) return null;
  const messages = state.messages || [];
  const user = messages.findLastIndex(m => m.role === 'user');
  const after = messages.slice(user + 1).filter(m => m.role === 'assistant');
  if (user < 0 || messages[user].text !== sentText || after.length !== 1 ||
      typeof after[0].text !== 'string' || !after[0].text.trim() || Buffer.byteLength(after[0].text) > limits.response) return null;
  return after[0].text;
}
async function privateRoot() {
  await fs.mkdir(root, { recursive:true, mode:0o700 });
  const st = await fs.lstat(root);
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid()) throw Error('private_root');
  await fs.chmod(root, 0o700);
}
async function privateJSON(file, object) {
  await privateRoot();
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(object,null,2)+'\n', {mode:0o600,flag:'wx'});
  await fs.rename(temp,file);
}
async function permission() {
  try {
    const st = await fs.lstat(configPath);
    if (!st.isFile() || st.isSymbolicLink() || st.size > 16384 || st.uid !== process.getuid()) return false;
    const c = JSON.parse(await fs.readFile(configPath,'utf8'));
    return c.enabled === true && c.controlIntent === true;
  } catch { return false; }
}
async function rpc(request) {
  try {
    const st = await fs.lstat(socketPath);
    if (!st.isSocket() || st.uid !== process.getuid() || (st.mode & 0o077)) return approval();
  } catch { return approval(); }
  return await new Promise(resolve => {
    let bytes = '', finished = false;
    const s = net.createConnection(socketPath);
    const finish = value => { if (finished) return; finished=true;s.destroy();resolve(value); };
    s.setTimeout(request.action === 'run' ? 170000 : 10000, () => finish(result('blocked','Browser operation timed out. Inspect its private journal; it was not replayed.')));
    s.once('error',()=>finish(approval()));
    s.once('connect',()=>s.write(JSON.stringify(request)+'\n'));
    s.on('data', data => {
      bytes += data;
      if (Buffer.byteLength(bytes) > limits.envelope) return finish(result('blocked','Browser result exceeds its bounded contract.'));
      if (bytes.includes('\n')) { try { finish(JSON.parse(bytes.split('\n')[0])); } catch { finish(result('blocked','Invalid browser result.')); } }
    });
    s.on('end',()=>finish(result('blocked','Browser connection ended without an adopted result.')));
  });
}
export async function oneShot(request) {
  const q = checkedRequest(request);
  if (q.action !== 'disconnect' && !await permission()) return approval();
  // A client NEVER imports the MCP SDK, starts a browser or grants access.
  return await rpc(q);
}
async function officialClient() {
  const tools = path.join(home,'Library/Application Support/OS-1/tools');
  const packageRoot = path.join(tools,'chrome-devtools-mcp-1.10.1/node_modules/chrome-devtools-mcp');
  const pkg = JSON.parse(await fs.readFile(path.join(packageRoot,'package.json'),'utf8'));
  if (pkg.version !== '1.10.1' || pkg.repository !== 'ChromeDevTools/chrome-devtools-mcp') throw Error('dependency_identity');
  const sdk = path.join(tools,'openclaw-2026.9.9/node_modules/@modelcontextprotocol/sdk/dist/esm');
  const {Client} = await import(pathToFileURL(path.join(sdk,'client/index.js')));
  const {StdioClientTransport} = await import(pathToFileURL(path.join(sdk,'client/stdio.js')));
  const transport = new StdioClientTransport({command:process.execPath,args:[path.join(packageRoot,'build/src/bin/chrome-devtools-mcp.js'),
    '--autoConnect','--channel=stable','--experimentalStructuredContent','--no-usage-statistics','--no-performance-crux',
    '--no-category-network','--no-category-performance','--no-category-emulation','--no-category-extensions','--no-category-memory',
    '--no-source-maps'],env:{HOME:home,PATH:path.dirname(process.execPath)+':/usr/bin:/bin',
    CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS:'1',CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS:'1'},stderr:'pipe'});
  const client = new Client({name:'os1-consumer-chat',version:'1.0.0'});
  await client.connect(transport);
  // Never persist arbitrary server stderr (it may contain page/auth details).
  transport.stderr?.on('data',()=>{});
  return client;
}
async function serve(ownerConnect) {
  if (!ownerConnect) { process.stdout.write(JSON.stringify(approval())+'\n'); return; }
  await privateRoot();
  const existing = await rpc({action:'status'});
  if (existing.state === 'ready') { process.stdout.write(JSON.stringify(existing)+'\n'); return; }
  // A reachable but blocked old bridge must be disconnected through its own
  // protocol, not merely unlinked while its authorized session remains alive.
  await rpc({action:'disconnect'});
  // Remove ONLY our own dead socket. Never stop Chrome, CUA, OpenClaw or peers.
  try { const st=await fs.lstat(socketPath); if (!st.isSocket() || st.uid!==process.getuid()) throw Error('socket_collision'); await fs.unlink(socketPath); }
  catch(e) { if (e.code!=='ENOENT') throw e; }
  await privateJSON(configPath,{enabled:false,controlIntent:true});
  let client, server, busy=false, ready=false, ownedPage=null, activeJournal=null;
  const toolsAllowed = new Set(['list_pages','new_page','take_snapshot','evaluate_script','fill','click']);
  async function call(name,args) {
    if (!toolsAllowed.has(name)) throw Error('tool_scope');
    const r = await client.callTool({name,arguments:args},undefined,{timeout:90000});
    if (r.isError || r.structuredContent?.dialog) throw Error('browser_tool_blocked');
    return r;
  }
  const probe = pageId => call('evaluate_script',{pageId,function:stateProbe}).then(parsedScript);
  const text = r => (r.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  async function freshPage() {
    const before = await call('list_pages',{});
    const previous = new Set((before.structuredContent?.pages||[]).map(p=>p.id));
    const opened = await call('new_page',{url:'https://chatgpt.com/',background:true,timeout:20000});
    const candidates = (opened.structuredContent?.pages||[]).filter(p=>!previous.has(p.id)&&ordinaryURL(p.url));
    if(candidates.length!==1 || !Number.isSafeInteger(candidates[0].id)) throw Error('page_identity');
    const id = candidates[0].id;
    for(let i=0;i<15;i++) {
      const s=await probe(id); if(chatReady(s)) return {id,state:s};
      if(s.login) throw Error('login_required');
      // Only our newly created page, after owner authorization. Choosing Chat
      // is routine mode selection, not granting permission or selecting Work.
      if(s.modes?.some(m=>m.name==='Work'&&m.pressed==='true')) {
        const snapshot=text(await call('take_snapshot',{pageId:id}));
        await call('click',{pageId:id,uid:uidFor(snapshot,'button',['Chat'])});
      }
      await new Promise(r=>setTimeout(r,400));
    }
    throw Error('ordinary_chat_unverified');
  }
  async function close() {
    ready=false;
    await privateJSON(configPath,{enabled:false,controlIntent:false});
    server?.close();
    await client?.close().catch(()=>{}); // official bridge disconnects, not kills Chrome
    await fs.unlink(socketPath).catch(()=>{});
  }
  try {
    client=await officialClient();
    ownedPage=await freshPage(); // first attachment may require Chrome's OWNER approval
    ready=true;
    await privateJSON(configPath,{enabled:true,controlIntent:true});
    server=net.createServer(s=>{
      let data='',received=false;
      s.setTimeout(175000,()=>s.destroy());
      s.on('error',()=>{});
      s.on('data',async b=>{
        if(received)return;
        data+=b;
        if(Buffer.byteLength(data)>limits.envelope){s.destroy();return;}
        if(!data.includes('\n'))return;
        received=true;
        const send = value => { if(!s.destroyed)s.end(JSON.stringify(value)+'\n'); };
        let q;
        try {q=checkedRequest(JSON.parse(data.split('\n')[0]));} catch {send(result('blocked','Invalid browser request.'));return;}
        if(q.action==='disconnect'){send(result('approval_required','ChatGPT browser bridge disconnected. Chrome and its account were left intact.'));await close();return;}
        if(!ready || !await permission()){send(approval());return;}
        if(q.action==='status'){send(result('ready',null,{conversation_url:ownedPage.state.url}));return;}
        if(busy){send(result('blocked','Ordinary ChatGPT has a request in flight. This request was not sent.'));return;}
        busy=true;
        const id=crypto.randomUUID(),journal=path.join(root,'receipts',id+'.json');
        await fs.mkdir(path.dirname(journal),{recursive:true,mode:0o700});
        const record={version:1,id,request_sha256:q.request_sha256,policy_projection_sha256:hash(q.policy_projection),
          projection_authority:'user_message_not_provider_system',mode:'chat',state:'prepared',started_at:new Date().toISOString(),
          transport:'approved_existing_chrome_session',usage_accounting:'unverified',task_quality:'execution_only'};
        activeJournal=journal;
        try {
          await privateJSON(journal,record);
          const page=await freshPage();ownedPage=page;
          record.conversation_url=page.state.url;record.state='prepared';await privateJSON(journal,record);
          const sent=q.policy_projection ? `[OS-1 governance guidance; user-level context, not a privileged system message]\n${q.policy_projection}\n\n[User request]\n${q.prompt}` : q.prompt;
          let snapshot=text(await call('take_snapshot',{pageId:page.id}));
          const inputUID=uidFor(snapshot,'textbox',['Ask ChatGPT','Message ChatGPT']);
          await call('fill',{pageId:page.id,uid:inputUID,value:sent});
          const immediatelyBefore=await probe(page.id);
          if(!chatReady(immediatelyBefore))throw Error('mode_changed');
          snapshot=text(await call('take_snapshot',{pageId:page.id}));
          const sendUID=uidFor(snapshot,'button',['Send prompt','Send message','Send']);
          record.state='dispatch_intent';record.sent_text_sha256=hash(sent);await privateJSON(journal,record);
          // No automatic retry after this point: a transport error may hide a sent request.
          await call('click',{pageId:page.id,uid:sendUID});
          record.state='sent';record.sent_at=new Date().toISOString();await privateJSON(journal,record);
          let answer=null,last=null;
          const until=Date.now()+145000;
          while(Date.now()<until && !s.destroyed) {
            last=await probe(page.id);answer=completedAnswer(last,sent,immediatelyBefore.url);
            if(answer!==null)break;
            if(!ordinaryURL(last.url)||last.login)throw Error('surface_changed');
            await new Promise(r=>setTimeout(r,800));
          }
          if(answer===null)throw Error('response_not_complete');
          Object.assign(record,{state:'returned',response_sha256:hash(answer),conversation_url:last.url,completed_at:new Date().toISOString()});
          await privateJSON(journal,record);
          send(result('returned',null,{response:answer,conversation_url:last.url,receipt_path:journal}));
        } catch {
          record.state=record.state==='prepared'?'blocked':'outcome_unverified';record.failed_at=new Date().toISOString();
          await privateJSON(journal,record).catch(()=>{});
          // No login/permission popup is deliberately opened on retry; retire
          // a failed bridge and require an explicit owner reconnect action.
          ready=false;await privateJSON(configPath,{enabled:false,controlIntent:true});
          send(result('blocked','Ordinary ChatGPT did not produce a verified completed reply. It was not replayed or replaced by Codex.',{receipt_path:journal}));
        } finally {activeJournal=null;busy=false;}
      });
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
    await fs.chmod(socketPath,0o600);
    process.stdout.write(JSON.stringify(result('ready',null,{conversation_url:ownedPage.state.url}))+'\n');
    const shutdown=async()=>{if(activeJournal)await privateJSON(path.join(root,'last-interruption.json'),{receipt_path:activeJournal,at:new Date().toISOString()});await close();process.exit(0);};
    process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  } catch {
    await close();
    process.stdout.write(JSON.stringify(result('approval_required','Chrome existing-session connection is not approved/available, or ordinary Chat mode could not be verified. No login or native fallback was opened.'))+'\n');
  }
}
async function main() {
  if(process.argv.includes('--serve'))return await serve(process.argv.includes('--owner-connect'));
  if(process.argv.includes('--disconnect'))return process.stdout.write(JSON.stringify(await oneShot({action:'disconnect'}))+'\n');
  let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>limits.envelope)throw Error('input_size');}
  process.stdout.write(JSON.stringify(await oneShot(JSON.parse(input)))+'\n');
}
if(process.argv[1] && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(()=>{process.stdout.write(JSON.stringify(result('blocked','Browser transport input or private state is invalid. No fallback was executed.'))+'\n');process.exitCode=1;});
}
