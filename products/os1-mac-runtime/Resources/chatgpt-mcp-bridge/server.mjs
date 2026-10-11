#!/usr/bin/env node
import {createServer} from 'node:http';
import {lstatSync, readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, isAbsolute, join} from 'node:path';
import {ChatGPTMailbox, MailboxError} from './store.mjs';

export const RESOURCE_URI='ui://os1/chatgpt-bridge';
const MAX_FRAME=1_048_576;
const boundedString=(max=128)=>({type:'string',minLength:1,maxLength:max});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const appMeta={ui:{visibility:['app']}};
const annotations=(readOnly,idempotent=false)=>({readOnlyHint:readOnly,destructiveHint:false,idempotentHint:idempotent,openWorldHint:false});
export const TOOL_DEFINITIONS=[
  {name:'os1_chat_open',title:'Open OS-1 ChatGPT return bridge',
    description:'Open the registered OS-1 transport component. It transports explicitly queued OS-1 requests using the host message API. This does not verify Chat/Work mode, a model, quota accounting, or task quality. Do not use a different provider as fallback.',
    inputSchema:object({}),annotations:annotations(true,true),
    outputSchema:{type:'object'},_meta:{ui:{resourceUri:RESOURCE_URI,visibility:['model','app']},'openai/outputTemplate':RESOURCE_URI}},
  {name:'os1_chat_connect',title:'Connect or refresh OS-1 widget lease',
    description:'Widget-only connection heartbeat. A connection identifies this component, not a user account or billing pool. No model call.',
    inputSchema:object({connection_id:boundedString()},[]),annotations:annotations(false),outputSchema:{type:'object'},_meta:appMeta},
  {name:'os1_chat_next',title:'Receive one queued OS-1 transport request',
    description:'Widget-only single delivery. A delivered request is not resent automatically. Do not call as a model. It does not execute or complete the request.',
    inputSchema:object({connection_id:boundedString()}),annotations:annotations(false),outputSchema:{type:'object'},_meta:appMeta},
  {name:'os1_chat_dispatched',title:'Acknowledge host message submission',
    description:'Widget-only acknowledgement that the host accepted a message submission. An acknowledgement is not an answer or completion.',
    inputSchema:object({request_id:boundedString(),dispatch_token:boundedString(64)}),annotations:annotations(false,true),outputSchema:{type:'object'},_meta:appMeta},
  {name:'os1_chat_status',title:'Read OS-1 outstanding request state',
    description:'Widget-only status for a request already delivered to this component. Does not send or retry anything.',
    inputSchema:object({connection_id:boundedString(),request_id:boundedString()}),annotations:annotations(false,true),outputSchema:{type:'object'},_meta:appMeta},
  {name:'os1_return_result',title:'Return the answer to the originating OS-1 task',
    description:'Return your final answer for the exact OS-1 request that supplied these binding fields. Copy request_id, request_sha256, policy_sha256 and return_token exactly from that request. Put the actual answer in output. Do not fabricate model, quota, provider or hidden execution metadata. A conflicting or late callback is rejected; this does not authorize a new task or retry.',
    inputSchema:object({request_id:boundedString(),request_sha256:boundedString(64),policy_sha256:boundedString(64),return_token:boundedString(64),output:boundedString(256_000)}),
    annotations:annotations(false,true),outputSchema:{type:'object'},_meta:{ui:{visibility:['model']}}},
];
function validObject(value, required, optional=[]){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  required.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>required.includes(k)||optional.includes(k));}
function requireArgs(value,required,optional=[]){if(!validObject(value,required,optional))throw new MailboxError('tool_arguments_invalid');}
function protocolResult(id,result){return {jsonrpc:'2.0',id,result};}
function protocolError(id,code,message){return {jsonrpc:'2.0',id, error:{code,message}};}
function publicText(value){return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
function privateWidget(value){
  // Control capabilities/prompt remain app-only. They are not model-visible
  // until the component deliberately sends this exact request through ui/message.
  const visible={state:value.state??'connected',host_mode:'NOT_EXPOSED',quota:'NOT_EXPOSED'};
  return {...publicText(visible),_meta:{bridge:value}};
}
export function createMCPHandler(mailbox,{resourcePath=join(dirname(fileURLToPath(import.meta.url)),'app.html')}={}){
  const toolCall=async params=>{
    requireArgs(params,['name'],['arguments','_meta']);
    const args=params.arguments??{};
    try{
      switch(params.name){
        case 'os1_chat_open':
          requireArgs(args,[]);
          return {...publicText({state:'component_requested',transport:'registered_mcp_app',
            connection:mailbox.connectionStatus(),host_mode:'NOT_EXPOSED',quota:'NOT_EXPOSED',
            instruction:'Use only the visible registered component to start or stop delivery. No model API, browser automation, hidden host pipe, or Codex fallback is used.'}),
            _meta:{'openai/outputTemplate':RESOURCE_URI}};
        case 'os1_chat_connect':
          requireArgs(args,[],['connection_id']);
          return privateWidget(mailbox.connect(args.connection_id));
        case 'os1_chat_next':
          requireArgs(args,['connection_id']);return privateWidget(mailbox.next(args.connection_id));
        case 'os1_chat_dispatched':
          requireArgs(args,['request_id','dispatch_token']);return privateWidget(mailbox.dispatched(args.request_id,args.dispatch_token));
        case 'os1_chat_status':
          requireArgs(args,['connection_id','request_id']);return privateWidget(mailbox.status(args.request_id,args.connection_id));
        case 'os1_return_result':{
          requireArgs(args,['request_id','request_sha256','policy_sha256','return_token','output']);
          const result=mailbox.complete(args);
          return publicText({state:result.state,request_id:result.request_id,task_id:result.task_id,
            response_sha256:result.output_sha256,idempotent:result.idempotent===true,
            dispatch_acknowledged:result.dispatch_acknowledged,usage_accounting_verified:false,
            native_record_verified:false,host_authentication_verified:false,host_registration_verified:false,task_quality:'unverified',parity_state:'unverified'});
        }
        default:throw new MailboxError('tool_not_found');
      }
    }catch(error){return {isError:true,content:[{type:'text',text:error instanceof MailboxError?error.code:'bridge_operation_failed'}]};}
  };
  return async message=>{
    if(!validObject(message,['jsonrpc','method'],['id','params'])||message.jsonrpc!=='2.0'||
      typeof message.method!=='string'||(message.id!==undefined&&typeof message.id!=='string'&&typeof message.id!=='number'))
      return protocolError(message?.id??null,-32600,'Invalid request');
    // MCP notifications are not calls. No response means no delivery or execution.
    if(message.id===undefined)return null;
    try{
      switch(message.method){
        case 'initialize':return protocolResult(message.id,{protocolVersion:'2025-06-18',
          capabilities:{tools:{listChanged:false},resources:{subscribe:false,listChanged:false}},
          serverInfo:{name:'os1-chatgpt-mcp-return',version:'0.1.0'},
          instructions:'This local MCP server transports one exact OS-1 request at a time. Only os1_return_result is the result callback; os1_chat_* control tools are widget-only. Never claim model selection, ordinary Chat mode, quota debit, quality parity, native JSONL, or an OS-1 task completed merely because the component opened or ui/message was acknowledged. External host authentication and registration are separate prerequisites.'});
        case 'ping':return protocolResult(message.id,{});
        case 'tools/list':return protocolResult(message.id,{tools:TOOL_DEFINITIONS});
        case 'tools/call':return protocolResult(message.id,await toolCall(message.params??{}));
        case 'resources/list':return protocolResult(message.id,{resources:[{uri:RESOURCE_URI,name:'OS-1 ChatGPT return bridge',mimeType:'text/html;profile=mcp-app',description:'Official MCP Apps message bridge; no browser or model API calls.'}]});
        case 'resources/templates/list':return protocolResult(message.id,{resourceTemplates:[]});
        case 'resources/read':{
          requireArgs(message.params??{},['uri']);
          if(message.params.uri!==RESOURCE_URI)throw new MailboxError('resource_not_found');
          const st=lstatSync(resourcePath);
          if(!st.isFile()||st.isSymbolicLink()||st.size>1_000_000)throw new MailboxError('resource_invalid');
          return protocolResult(message.id,{contents:[{uri:RESOURCE_URI,mimeType:'text/html;profile=mcp-app',
            text:readFileSync(resourcePath,'utf8'),_meta:{ui:{csp:{connectDomains:[],resourceDomains:[]}},
              'openai/widgetDescription':'OS-1 transport component. Host mode, model and quota remain unobserved.'}}]});
        }
        default:return protocolError(message.id,-32601,'Method not found');
      }
    }catch(error){return protocolError(message.id,-32602,error instanceof MailboxError?error.code:'bridge_request_failed');}
  };
}
export async function runStdio(handler,input=process.stdin,output=process.stdout){
  // Bound lines before parsing. readline alone can accumulate an unbounded line.
  input.setEncoding('utf8'); let pending='',chain=Promise.resolve();
  for await(const chunk of input){
    pending+=chunk;
    if(Buffer.byteLength(pending)>MAX_FRAME){output.write(JSON.stringify(protocolError(null,-32600,'Request too large'))+'\n');return;}
    let end;
    while((end=pending.indexOf('\n'))>=0){
      const line=pending.slice(0,end).trim();pending=pending.slice(end+1);if(!line)continue;
      chain=chain.then(async()=>{let message;try{message=JSON.parse(line);}catch{output.write(JSON.stringify(protocolError(null,-32700,'Parse error'))+'\n');return;}
        const result=await handler(message);if(result)output.write(JSON.stringify(result)+'\n');});
      await chain;
    }
  }
  if(pending.trim()){let message;try{message=JSON.parse(pending);}catch{output.write(JSON.stringify(protocolError(null,-32700,'Parse error'))+'\n');return;}
    const result=await handler(message);if(result)output.write(JSON.stringify(result)+'\n');}
  await chain;
}
export function createLoopbackHTTP(handler,{port}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw new MailboxError('http_port_invalid');
  const server=createServer(async(req,res)=>{
    const actualPort=server.address()?.port;
    const allowedHosts=new Set([`127.0.0.1:${actualPort}`,`localhost:${actualPort}`]);
    const host=req.headers.host;
    if(!allowedHosts.has(host)||req.headers.origin!==undefined&&!new Set([`http://${host}`]).has(req.headers.origin)){
      res.writeHead(403,{'Content-Type':'text/plain'});res.end('Origin or Host rejected');return;
    }
    if(req.url==='/health'&&req.method==='GET'){
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({state:'listening',transport:'loopback_mcp',
        external_authentication:'NOT_CONFIGURED_BY_THIS_SERVER',production_ready:false}));return;
    }
    if(req.url!=='/mcp'){res.writeHead(404);res.end();return;}
    if(req.method!=='POST'){res.writeHead(405,{'Allow':'POST'});res.end();return;}
    if(!String(req.headers['content-type']??'').toLowerCase().startsWith('application/json')){res.writeHead(415);res.end();return;}
    if(req.headers['content-length']&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>MAX_FRAME)){res.writeHead(413);res.end();return;}
    let chunks=[],size=0;
    try{
      for await(const chunk of req){size+=chunk.length;if(size>MAX_FRAME){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      let message;try{message=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify(protocolError(null,-32700,'Parse error')));return;}
      const result=await handler(message);
      res.writeHead(result?200:202,result?{'Content-Type':'application/json','Cache-Control':'no-store'}:{});
      res.end(result?JSON.stringify(result):'');
    }catch{if(!res.headersSent)res.writeHead(500);res.end();}
  });
  server.requestTimeout=30_000;server.headersTimeout=10_000;server.maxHeadersCount=50;
  return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve(server.address());});})};
}
async function main(){
  const args=process.argv.slice(2);let mode,root,port;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--stdio'||args[i]==='--http'){if(mode)throw new MailboxError('multiple_modes');mode=args[i];}
    else if(args[i]==='--root'){if(root!==undefined)throw new MailboxError('duplicate_root');root=args[++i];}
    else if(args[i]==='--port'){if(port!==undefined)throw new MailboxError('duplicate_port');const raw=args[++i];if(!/^\d+$/.test(raw??''))throw new MailboxError('http_port_invalid');port=Number(raw);}
    else throw new MailboxError('unsupported_argument');
  }
  if(!mode||!root||!isAbsolute(root)||(mode==='--stdio'&&port!==undefined)||(mode==='--http'&&port===undefined))throw new MailboxError('usage_stdio_or_http_root_required');
  const box=new ChatGPTMailbox(root),handler=createMCPHandler(box);
  if(mode==='--stdio'){try{await runStdio(handler);}finally{box.close();}}
  else{
    const {server,listen}=createLoopbackHTTP(handler,{port});await listen();
    // No endpoints, requests, return tokens or auth headers are printed.
    const shutdown=()=>server.close(()=>{box.close();process.exit(0);});
    process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{process.stderr.write((error instanceof MailboxError?error.code:'bridge_start_failed')+'\n');process.exitCode=1;});
}
