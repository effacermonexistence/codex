// Prepare the official transport client's profile only. Does not read a key,
// register a ChatGPT plugin, start a tunnel, call a model, or change OS1 routing.
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,readFileSync,existsSync,realpathSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const CLIENT_SHA='6f1e8d5494d6c4d6c45cd4f6e07b5291459c0b23f4b8cd8266c7a64be3d9a2a0';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const shellWord=s=>"'"+s.replaceAll("'","'\\''")+"'";
export function buildPreparation(tunnelID,home) {
  if(typeof tunnelID!=='string'||!/^tunnel_[A-Za-z0-9]{8,100}$/.test(tunnelID))throw Error('real_tunnel_id_required');
  if(typeof home!=='string'||!home.startsWith('/')||home.includes('\0')||home.includes('\n'))throw Error('home_invalid');
  const base=join(home,'.local/share/os1-chatgpt-mcp');
  const client=join(base,'tunnel-client-v0.0.16-darwin-arm64/tunnel-client');
  const profiles=join(base,'profiles');
  const mailbox=join(home,'.os1/chatgpt-mcp-transport');
  const packageRoot=join(home,'.os1/plugin-sources/native-chat-return-20261011');
  const server=join(packageRoot,'plugins/os1-chatgpt-return/server.mjs');
  const node=join(home,'.local/share/node-v24.20.0/bin/node');
  const secretFile=join(mailbox,'control-plane.key');
  return {client,profiles,mailbox,packageRoot,server,node,secretFile,
    args:['init','--sample','sample_mcp_stdio_local','--profile','os1-chatgpt',
      '--profile-dir',profiles,'--tunnel-id',tunnelID,
      '--health-listen-addr','127.0.0.1:0',
      '--mcp-command',[node,server,'--stdio','--root',mailbox].map(shellWord).join(' '),
      '--control-plane-api-key-ref','file:'+secretFile]};
}
function privateDirectory(path) {
  let current='/';
  for(const part of resolve(path).split('/').filter(Boolean)){
    current=join(current,part);
    if(!existsSync(current))mkdirSync(current,{mode:0o700});
    if(lstatSync(current).isSymbolicLink())throw Error('symlink_rejected');
  }
  const st=lstatSync(path);
  if(!st.isDirectory()||st.uid!==process.getuid()||(st.mode&0o077))throw Error('directory_custody_rejected');
  if(realpathSync(path)!==path)throw Error('path_changed');
}
function regular(path) {
  const st=lstatSync(path);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.uid!==process.getuid())throw Error('file_custody_rejected');
}
export function prepare(tunnelID) {
  const p=buildPreparation(tunnelID,homedir());
  regular(p.client);
  if(sha(readFileSync(p.client))!==CLIENT_SHA)throw Error('official_client_identity_changed');
  regular(p.server);regular(p.node);
  const manifest=JSON.parse(readFileSync(join(p.packageRoot,'source-manifest.json'),'utf8'));
  for(const name of ['server.mjs','store.mjs','app.html']){
    const file=join(p.packageRoot,'plugins/os1-chatgpt-return',name);regular(file);
    if(sha(readFileSync(file))!==manifest[name])throw Error('mcp_package_identity_changed');
  }
  privateDirectory(p.profiles);privateDirectory(p.mailbox);
  // Do not overwrite a profile or replace an earlier transport assignment.
  const receiptPath=join(p.profiles,'os1-preparation.json');
  if(existsSync(receiptPath))throw Error('profile_preparation_already_exists');
  const env={HOME:homedir(),PATH:join(homedir(),'.local/share/node-v24.20.0/bin')+':/usr/bin:/bin',LANG:'en_US.UTF-8'};
  const r=spawnSync(p.client,p.args,{env,encoding:'utf8',timeout:15000,maxBuffer:128000});
  // Any diagnostic output is private, never copied into a public transcript.
  writeFileSync(join(p.profiles,'init-output.log'),(r.stdout??'')+(r.stderr??''),{mode:0o600,flag:'wx'});
  if(r.error||r.status!==0)throw Error('profile_init_failed');
  const receipt={schema:1,tunnel_id:tunnelID,profile:'os1-chatgpt',profile_directory:p.profiles,
    client_sha256:CLIENT_SHA,prepared_at:new Date().toISOString(),
    key_read:false,tunnel_started:false,chatgpt_registered:false,model_calls:0};
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});
  return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    if(process.argv.length!==4||process.argv[2]!=='--tunnel-id')throw Error('usage');
    process.stdout.write(JSON.stringify(prepare(process.argv[3]))+'\n');
  }catch{process.stderr.write('Tunnel profile preparation stopped; inspect private state. No key or model call used.\n');process.exitCode=1;}
}
