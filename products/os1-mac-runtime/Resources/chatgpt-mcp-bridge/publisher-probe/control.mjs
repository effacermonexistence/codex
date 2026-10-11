#!/usr/bin/env node
// Publisher diagnostic control only. Never bundled into customer OS1.
import {openSync,fstatSync,readFileSync,closeSync,constants} from 'node:fs';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

export function readOperatorKey(path){
  if(!isAbsolute(path))throw Error('operator_key_path_invalid');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const st=fstatSync(fd);
    if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid()||(st.mode&0o777)!==0o600||st.size<32||st.size>512)throw Error('operator_key_file_unsafe');
    const value=readFileSync(fd,'utf8');
    if(!/^[a-f0-9]{64}$/.test(value))throw Error('operator_key_invalid');
    return value;
  }finally{closeSync(fd);}
}
export async function control({action,url,keyPath,fetcher=fetch}){
  if(!['start','result','cancel'].includes(action))throw Error('unsupported_control');
  const base=new URL(url);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||base.pathname!=='/'||!/^os1-native-chat-probe\.[a-z0-9-]+\.workers\.dev$/.test(base.hostname))throw Error('probe_url_invalid');
  const key=readOperatorKey(keyPath);
  const result=await fetcher(new URL('/ops/'+action,base),{
    method:action==='result'?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
    ...(action==='result'?{}:{body:'{}'})
  });
  const text=await result.text();
  if(Buffer.byteLength(text)>16384)throw Error('control_response_too_large');
  let data;try{data=JSON.parse(text);}catch{throw Error('control_response_invalid');}
  if(!result.ok){
    const code=typeof data.error==='string'&&/^[a-z_]{1,80}$/.test(data.error)?data.error:'control_rejected';
    throw Error(code);
  }
  // Explicit output allowlist. No credentials, capabilities, raw headers or
  // unknown response fields can enter a terminal/log result.
  const keys=['state','request_id','request_sha256','created_at_ms','expires_at_ms','offered_at_ms','dispatched_at_ms','returned_at_ms','terminal_at_ms','output','output_sha256','dispatch_acknowledged','idempotent','probe_only','production_available','native_host_verified','host_authentication_verified','usage_accounting_verified','host_mode','model','effort','quota'];
  return Object.fromEntries(keys.filter(k=>Object.hasOwn(data,k)).map(k=>[k,data[k]]));
}
async function main(){
  const args=process.argv.slice(2),action=args.shift();let url,keyPath;
  while(args.length){const name=args.shift(),value=args.shift();if(name==='--url'&&!url)url=value;else if(name==='--key-file'&&!keyPath)keyPath=value;else throw Error('control_usage_invalid');}
  if(!url||!keyPath)throw Error('control_usage_invalid');
  console.log(JSON.stringify(await control({action,url,keyPath}),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(e=>{process.stderr.write(/^[a-z_]{1,80}$/.test(e.message)?e.message+'\n':'probe_control_failed\n');process.exitCode=1;});
}
