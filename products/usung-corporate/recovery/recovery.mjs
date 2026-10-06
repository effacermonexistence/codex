#!/usr/bin/env node
// Explicit commands: seal/verify are local; fetch reads R2; publish writes R2.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const ACCOUNT='d18c5d440fedbf100c4afd13b4b7a2c0', BUCKET='omar-private-archive', REPOSITORY='effacermonexistence/codex', ROOT='products/usung-corporate', LIMIT=300*1024**2;
const PART_BYTES=16*1024**2, MIN_PART_BYTES=1024**2, PART_TRANSPORT='immutable-object-parts-v1';
const argv=process.argv.slice(2), command=argv.shift(), opts={};
while(argv.length){const k=argv.shift(); if(!/^--[a-z-]+$/.test(k)||!argv.length)throw new Error('Use explicit --option value arguments'); opts[k.slice(2)]=argv.shift();}
const required=k=>{if(!opts[k])throw new Error('Missing --'+k);return opts[k];};
const absolute=p=>path.resolve(p), stamp=()=>new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const jsonBytes=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const shaBytes=b=>createHash('sha256').update(b).digest('hex');
async function digest(file){let h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
function run(bin,args,options={}){let r=spawnSync(bin,args,{encoding:'utf8',maxBuffer:32*1024**2,...options});if(r.error)throw r.error;if(r.status!==0)throw new Error(`${path.basename(bin)} failed (${r.status}): ${(r.stderr||'').slice(-1600)}`);return r.stdout;}
function helper(args){const python=process.env.USUNG_RECOVERY_PYTHON||'python3';return JSON.parse(run(python,[path.join(HERE,'recovery-helper.py'),...args]));}
async function writeJson(file,x){await fsp.writeFile(file,jsonBytes(x),{flag:'wx'});}
function checkManifest(m){
 if(m.schema!=='usung-product-recovery-v1'||m.repository!==REPOSITORY||m.accountId!==ACCOUNT||m.bucket!==BUCKET)throw new Error('Recovery identity mismatch');
 if(!/^[0-9a-f]{40}$/.test(m.sourceCommit)||typeof m.release!=='string'||!m.release||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.deploymentId))throw new Error('Invalid release coordinates');
 const prefix=`usung-corporate/releases/${m.createdKeyDate}/${m.sourceCommit}/`;
 if(!/^\d{8}T\d{6}Z$/.test(m.createdKeyDate)||m.prefix!==prefix||m.package.key!==prefix+'usung-corporate.tar.gz'||m.manifestKey!==prefix+'manifest.json')throw new Error('Invalid immutable keys');
 if(!/^[0-9a-f]{64}$/.test(m.package.sha256)||!Number.isSafeInteger(m.package.bytes)||m.package.bytes<=0||m.package.bytes>LIMIT||!Array.isArray(m.files)||!m.files.length)throw new Error('Invalid package integrity record');
 if(m.package.parts!==undefined){
  const size=m.package.partBytes,parts=m.package.parts;
  if(m.package.transport!==PART_TRANSPORT||!Number.isSafeInteger(size)||size<MIN_PART_BYTES||size>PART_BYTES||!Array.isArray(parts)||parts.length!==Math.ceil(m.package.bytes/size))throw new Error('Invalid package chunk transport');
  let total=0;for(let i=0;i<parts.length;i++){const part=parts[i],expected=Math.min(size,m.package.bytes-total);if(part.index!==i+1||part.key!==prefix+'parts/'+partName(i+1)||part.bytes!==expected||!Number.isSafeInteger(part.bytes)||part.bytes<=0||part.bytes>PART_BYTES||!/^[0-9a-f]{64}$/.test(part.sha256))throw new Error('Invalid package chunk identity/order/size');total+=part.bytes;}
  if(total!==m.package.bytes)throw new Error('Package chunk byte sum mismatch');
 }else if(m.package.transport!==undefined&&m.package.transport!=='single-object-v1')throw new Error('Unsupported package transport');
 if(shaBytes(Buffer.from(JSON.stringify(m.files)))!==m.fileInventorySha256)throw new Error('Inventory digest mismatch');
 for(const f of m.files)if(typeof f.path!=='string'||!f.path.startsWith('usung-corporate/')||!/^[0-9a-f]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0||!/^0[0-7]{3}$/.test(f.mode))throw new Error('Invalid file inventory');
 for(const t of m.tools)if(!['recovery.mjs','recovery-helper.py','RESTORE.md'].includes(t.name)||t.key!==prefix+t.name||!/^[0-9a-f]{64}$/.test(t.sha256))throw new Error('Invalid recovery tool record');
}
async function loadManifest(file){const raw=await fsp.readFile(file);const m=JSON.parse(raw);checkManifest(m);return {m,raw,sha256:shaBytes(raw)};}
async function verifyPackage(m,file){const stat=await fsp.stat(file);if(stat.size!==m.package.bytes||await digest(file)!==m.package.sha256)throw new Error('Archive bytes/SHA256 mismatch');}
function partName(index){return `part-${String(index).padStart(5,'0')}.bin`;}
async function verifyPart(part,file){const stat=await fsp.stat(file);if(stat.size!==part.bytes||await digest(file)!==part.sha256)throw new Error(`Chunk ${part.index} bytes/SHA256 mismatch`);}
async function splitArchive(archive,directory,prefix,partBytes){
 if(!Number.isSafeInteger(partBytes)||partBytes<MIN_PART_BYTES||partBytes>PART_BYTES)throw new Error('Part size must be 1–16MiB');
 await fsp.mkdir(directory,{recursive:false});const input=await fsp.open(archive,'r'),total=(await input.stat()).size;let offset=0,index=1;const parts=[];
 try{while(offset<total){const length=Math.min(partBytes,total-offset),buffer=Buffer.alloc(length);let used=0;while(used<length){const n=await input.read(buffer,used,length-used,offset+used);if(!n.bytesRead)throw new Error('Unexpected archive EOF');used+=n.bytesRead;}const file=path.join(directory,partName(index));await fsp.writeFile(file,buffer,{flag:'wx'});parts.push({index,key:prefix+'parts/'+partName(index),bytes:length,sha256:shaBytes(buffer)});offset+=length;index++;}}finally{await input.close();}
 return parts;
}
async function verifyChunkSet(m,directory){const h=createHash('sha256');let bytes=0;for(const part of m.package.parts){const file=path.join(directory,partName(part.index));await verifyPart(part,file);for await(const data of fs.createReadStream(file)){h.update(data);bytes+=data.length;}}if(bytes!==m.package.bytes||h.digest('hex')!==m.package.sha256)throw new Error('Chunk set does not reproduce full archive bytes/SHA256');}
async function concatenateParts(m,directory,archive){
 const output=await fsp.open(archive,'wx');try{for(const part of m.package.parts){const file=path.join(directory,partName(part.index));await verifyPart(part,file);for await(const chunk of fs.createReadStream(file)){let used=0;while(used<chunk.length){const n=await output.write(chunk,used,chunk.length-used,null);if(!n.bytesWritten)throw new Error('Archive assembly made no progress');used+=n.bytesWritten;}}}}finally{await output.close();}await verifyPackage(m,archive);
}
async function readPackage(w,m,directory){
 const archive=path.join(directory,'usung-corporate.tar.gz');
 if(m.package.parts){const chunks=path.join(directory,'parts');await fsp.mkdir(chunks,{recursive:false});for(const part of m.package.parts){const file=path.join(chunks,partName(part.index));cf(w,['r2','object','get',`${BUCKET}/${part.key}`,'--remote','--file',file]);await verifyPart(part,file);console.error(`Verified downloaded R2 chunk ${part.index}/${m.package.parts.length}`);}await concatenateParts(m,chunks,archive);}
 else{cf(w,['r2','object','get',`${BUCKET}/${m.package.key}`,'--remote','--file',archive]);await verifyPackage(m,archive);}
 return archive;
}
async function freePort(){const n=net.createServer();await new Promise((ok,no)=>{n.once('error',no);n.listen(0,'127.0.0.1',ok)});let p=n.address().port;await new Promise(ok=>n.close(ok));return p;}
async function drill(stage,m){
 const product=path.join(stage,'usung-corporate');run(process.execPath,['build.mjs'],{cwd:product});
 const langs=(await fsp.readdir(path.join(product,'public/locales'),{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>x.name);
 for(const lang of langs)for(const route of ['','ai','smart-construction','physical-ai'])await fsp.access(path.join(product,'public/locales',lang,route,'index.html'));
 // Static assets must remain byte-identical after the source build.
 for(const f of m.files.filter(f=>f.path.startsWith('usung-corporate/public/assets/')||/\.(mp4|webp|png|jpg|svg)$/.test(f.path)))if(await digest(path.join(stage,f.path))!==f.sha256)throw new Error('Build changed recorded media: '+f.path);
 const port=await freePort();const server=spawn(process.execPath,['server.mjs'],{cwd:product,env:{...process.env,PORT:String(port),NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});let error='';server.stderr.on('data',b=>{error=(error+b).slice(-1200)});server.stdout.resume();let health;
 try{
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw new Error('Restored server exited: '+error);try{let r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){health=await r.json();break;}}catch{}await new Promise(ok=>setTimeout(ok,100));}
  if(health?.status!=='ok'||health.site!=='usung-corporate'||health.release!==m.release||health.languages!==langs.length)throw new Error('Restored health/release/languages mismatch');
  const routes=[];for(const route of ['/','/ai/','/smart-construction/','/physical-ai/']){const r=await fetch(`http://127.0.0.1:${port}${route}`,{headers:{'user-agent':'USUNG-Recovery-Drill'}});if(r.status!==200)throw new Error('Restored route failed: '+route);const html=await r.text();for(const z of html.matchAll(/(?:src|poster|href)="(\/[^"#]+)"/g)){const url=new URL(z[1],'http://local');if(!/\.(?:js|css|svg|png|jpg|webp|mp4|ico|webmanifest)$/.test(url.pathname))continue;await fsp.access(path.join(product,'public',decodeURIComponent(url.pathname)));}routes.push({route,status:r.status});}
  return {health,routes,generatedLanguages:langs.length,generatedLocalizedPages:langs.length*4,mediaUnchangedAfterBuild:true,buildExitCode:0,serverHealthActual:true};
 }finally{server.kill('SIGTERM');await new Promise(ok=>{if(server.exitCode!==null)return ok();server.once('exit',ok);setTimeout(()=>{server.kill('SIGKILL');ok()},3000).unref()});}
}
async function verifyAndDrill(manifest,archive,stage){const {m,sha256}=await loadManifest(manifest);await verifyPackage(m,archive);helper(['extract',absolute(archive),absolute(stage)]);const inventory=helper(['verify',absolute(stage),absolute(manifest)]);const runtime=await drill(absolute(stage),m);return {schema:'usung-recovery-drill-v1',sourceCommit:m.sourceCommit,release:m.release,deploymentId:m.deploymentId,manifestSha256:sha256,packageSha256:m.package.sha256,packageBytes:m.package.bytes,...inventory,...runtime,verifiedAtUtc:new Date().toISOString()};}
function wrangler(repo){const root=absolute(repo);const bin=path.join(root,'node_modules/.bin/wrangler');if(!fs.existsSync(bin))throw new Error('Install repository pinned dependencies first');const pin=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).devDependencies.wrangler;const version=run(bin,['--version'],{cwd:root});if(!version.includes(pin))throw new Error('Wrangler does not match repository pin');return {bin,root,pin,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:ACCOUNT}};}
class R2TransportError extends Error{constructor(transient){super('R2 command failed; read the exact key before repeating or adopting latest');this.transient=transient;}}
function cf(w,args,allowMissing=false){let r=spawnSync(w.bin,args,{cwd:w.root,env:w.env,encoding:'utf8',maxBuffer:8*1024**2});if(r.error)throw new R2TransportError(/ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(r.error.code||''));if(r.status!==0){const text=(r.stdout||'')+(r.stderr||'');if(allowMissing&&/The specified key does not exist\./i.test(text))return false;const denied=/authentication|unauthorized|forbidden|permission|\b(?:401|403)\b/i.test(text);throw new R2TransportError(!denied&&/fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|socket hang up|connectivity|\b(?:429|500|502|503|504)\b/i.test(text));}return true;}
function checkAccount(w){const result=run(w.bin,['whoami'],{cwd:w.root,env:w.env});if(!result.includes(ACCOUNT))throw new Error('Required Cloudflare account unavailable');}
async function immutable(w,key,file,readback){
 const wanted=await digest(file),bytes=(await fsp.stat(file)).size;
 for(let attempt=1;attempt<=4;attempt++){
  try{
   // Every retry GETs the exact key first, including an unknown prior PUT outcome.
   const exists=cf(w,['r2','object','get',`${BUCKET}/${key}`,'--remote','--file',readback],true);
   if(exists){if((await fsp.stat(readback)).size!==bytes||await digest(readback)!==wanted)throw new Error('Existing immutable object differs; refusing overwrite');return;}
   if(bytes>PART_BYTES)throw new Error('Large immutable PUT refused; reseal with 16MiB chunk transport');
   cf(w,['r2','object','put',`${BUCKET}/${key}`,'--remote','--file',file,'--content-type',file.endsWith('.json')?'application/json':file.endsWith('.bin')?'application/octet-stream':file.endsWith('.gz')?'application/gzip':'text/plain','--force']);
   cf(w,['r2','object','get',`${BUCKET}/${key}`,'--remote','--file',readback]);
   if((await fsp.stat(readback)).size!==bytes||await digest(readback)!==wanted)throw new Error('R2 full readback bytes/SHA256 mismatch');return;
  }catch(e){if(!(e instanceof R2TransportError)||!e.transient||attempt===4)throw e;console.error(`Transient small-object transport failure; checking immutable key before retry ${attempt+1}/4`);await new Promise(ok=>setTimeout(ok,Math.min(4000,1000*2**(attempt-1))));}
 }
}
async function seal(){
 const repo=absolute(required('repo')),commit=required('commit'),out=absolute(required('out')),release=required('release'),deploymentId=required('deployment');
 if(!/^[0-9a-f]{40}$/.test(commit)||run('git',['rev-parse','--verify',commit+'^{commit}'],{cwd:repo}).trim()!==commit)throw new Error('Use a fixed full commit SHA');
 const origin=run('git',['remote','get-url','origin'],{cwd:repo}).trim();if(!['https://github.com/effacermonexistence/codex.git','git@github.com:effacermonexistence/codex.git'].includes(origin))throw new Error('Repository origin identity mismatch');
 const files=run('git',['ls-tree','-r','--name-only',commit+':'+ROOT],{cwd:repo}).trim().split('\n');for(const f of files)if(f.split('/').some(x=>/^(?:\.env|\.dev\.vars)/.test(x)||['.git','.wrangler','.railway','.codex','node_modules','.npmrc','.netrc','credentials.json','oauth.json','auth.json','id_rsa','id_ed25519'].includes(x)))throw new Error('Tracked env/auth path rejected');
 await fsp.mkdir(out,{recursive:false});const archive=path.join(out,'usung-corporate.tar.gz');const child=spawn('git',['archive','--format=tar','--prefix=usung-corporate/',commit+':'+ROOT],{cwd:repo,stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',b=>err+=b);const done=new Promise((ok,no)=>{child.once('error',no);child.once('exit',c=>c===0?ok():no(new Error('git archive failed: '+err)));});await pipeline(child.stdout,createGzip({level:6}),fs.createWriteStream(archive,{flags:'wx'}));await done;
 const bytes=(await fsp.stat(archive)).size;if(bytes>LIMIT)throw new Error('Whole package exceeds the configured 300MiB recovery bound');const stage=path.join(out,'pre-upload-drill');const inventory=helper(['extract',archive,stage]);const date=stamp(),prefix=`usung-corporate/releases/${date}/${commit}/`;const partBytes=opts['part-bytes']===undefined?PART_BYTES:Number(opts['part-bytes']);const parts=await splitArchive(archive,path.join(out,'parts'),prefix,partBytes);const tools=[];
 for(const name of ['recovery.mjs','recovery-helper.py','RESTORE.md']){const destination=path.join(out,name);await fsp.copyFile(path.join(HERE,name),destination,fs.constants.COPYFILE_EXCL);tools.push({name,key:prefix+name,bytes:(await fsp.stat(destination)).size,sha256:await digest(destination)});}
 const manifest={schema:'usung-product-recovery-v1',repository:REPOSITORY,accountId:ACCOUNT,bucket:BUCKET,createdUtc:new Date().toISOString(),createdKeyDate:date,prefix,sourceCommit:commit,sourceRef:opts.ref||run('git',['branch','--show-current'],{cwd:repo}).trim(),productRoot:ROOT,release,deploymentId,production:{projectId:'3ed80199-e7ca-4d74-8258-d7cde282d310',serviceId:'056dec14-c2b1-4dcb-b152-29782e2ac385',environmentId:'f496e79f-dd76-431e-8e7c-2c3b0fc78d90',domains:['usungcorp.com','www.usungcorp.com'],healthUrl:'https://usungcorp.com/health',port:8080},package:{key:prefix+'usung-corporate.tar.gz',bytes,sha256:await digest(archive),transport:PART_TRANSPORT,partBytes,parts},manifestKey:prefix+'manifest.json',fileInventorySha256:shaBytes(Buffer.from(JSON.stringify(inventory))),files:inventory,tools,excluded:'git archive fixed product commit includes no untracked runtime/env/auth/node_modules; tracked credential filenames are rejected. public/locales is ignored build output and regenerated from committed src/locales dictionaries.'};
 checkManifest(manifest);await verifyChunkSet(manifest,path.join(out,'parts'));const mf=path.join(out,'manifest.json');await writeJson(mf,manifest);helper(['verify',stage,mf]);const runtime=await drill(stage,manifest);const receipt={schema:'usung-recovery-drill-v1',sourceCommit:commit,release,deploymentId,manifestSha256:await digest(mf),packageSha256:manifest.package.sha256,packageBytes:bytes,filesVerified:inventory.length,allFileBytesModesSHA256Match:true,...runtime,verifiedAtUtc:new Date().toISOString()};await writeJson(path.join(out,'pre-upload-drill.json'),receipt);return {sealed:out,manifestSha256:receipt.manifestSha256,packageSha256:receipt.packageSha256,packageBytes:bytes,packageTransport:PART_TRANSPORT,partBytes,partCount:parts.length,files:inventory.length,preUploadDrill:runtime};
}
async function publish(){
 const dir=absolute(required('sealed')),mf=path.join(dir,'manifest.json'),archive=path.join(dir,'usung-corporate.tar.gz'),{m,sha256}=await loadManifest(mf);await verifyPackage(m,archive);const w=wrangler(required('repo'));checkAccount(w);const rb=await fsp.mkdtemp(path.join(dir,'r2-readback-'));
 if(m.package.parts){const chunks=path.join(rb,'parts');await fsp.mkdir(chunks,{recursive:false});for(const part of m.package.parts){const file=path.join(dir,'parts',partName(part.index)),downloaded=path.join(chunks,partName(part.index));await verifyPart(part,file);await immutable(w,part.key,file,downloaded);await verifyPart(part,downloaded);console.error(`Verified immutable R2 chunk ${part.index}/${m.package.parts.length}`);}await concatenateParts(m,chunks,path.join(rb,'usung-corporate.tar.gz'));}
 else await immutable(w,m.package.key,archive,path.join(rb,'usung-corporate.tar.gz'));
 const receipt=await verifyAndDrill(mf,path.join(rb,'usung-corporate.tar.gz'),path.join(rb,'restored'));receipt.packageTransport=m.package.parts?PART_TRANSPORT:'single-object-v1';receipt.partCount=m.package.parts?.length||1;receipt.fullArchiveReassembledSHA256Verified=true;
 await immutable(w,m.manifestKey,mf,path.join(rb,'manifest.json'));
 for(const t of m.tools){const file=path.join(dir,t.name);if(await digest(file)!==t.sha256)throw new Error('Recovery tool changed after seal');await immutable(w,t.key,file,path.join(rb,t.name));}
 if(await digest(path.join(rb,'manifest.json'))!==sha256)throw new Error('Immutable manifest readback hash mismatch');const proofFile=path.join(rb,'restore-drill.json');await writeJson(proofFile,receipt);const proofSha=await digest(proofFile),proofKey=m.prefix+`verification/${stamp()}-${proofSha}/restore-drill.json`;await immutable(w,proofKey,proofFile,path.join(rb,'restore-drill-readback.json'));
 const pointer={schema:'usung-recovery-pointer-v1',accountId:ACCOUNT,bucket:BUCKET,repository:REPOSITORY,sourceCommit:m.sourceCommit,release:m.release,deploymentId:m.deploymentId,manifestKey:m.manifestKey,manifestSha256:sha256,packageKey:m.package.key,packageSha256:m.package.sha256,packageTransport:m.package.parts?PART_TRANSPORT:'single-object-v1',partCount:m.package.parts?.length||1,verificationKey:proofKey,verificationSha256:proofSha,publishedAtUtc:new Date().toISOString()};const pp=path.join(rb,'latest.json');await writeJson(pp,pointer);
 cf(w,['r2','object','put',`${BUCKET}/usung-corporate/latest.json`,'--remote','--file',pp,'--content-type','application/json','--force']);cf(w,['r2','object','get',`${BUCKET}/usung-corporate/latest.json`,'--remote','--file',path.join(rb,'latest-readback.json')]);if(await digest(pp)!==await digest(path.join(rb,'latest-readback.json')))throw new Error('Latest pointer readback mismatch');return {published:true,readbackDirectory:rb,pointer,fullRestoreDrill:receipt};
}
async function fetchRecovery(){
 const dir=absolute(required('out'));await fsp.mkdir(dir,{recursive:false});const w=wrangler(required('repo'));checkAccount(w);let key=opts['manifest-key'],wanted=opts['manifest-sha'],latest;
 if(!key){const p=path.join(dir,'latest.json');cf(w,['r2','object','get',`${BUCKET}/usung-corporate/latest.json`,'--remote','--file',p]);latest=JSON.parse(await fsp.readFile(p));if(latest.schema!=='usung-recovery-pointer-v1'||latest.accountId!==ACCOUNT||latest.bucket!==BUCKET||latest.repository!==REPOSITORY)throw new Error('Latest pointer identity mismatch');key=latest.manifestKey;wanted=latest.manifestSha256;}
 if(typeof key!=='string'||!/^usung-corporate\/releases\/\d{8}T\d{6}Z\/[0-9a-f]{40}\/manifest.json$/.test(key)||!/^[0-9a-f]{64}$/.test(wanted||''))throw new Error('Provide fixed manifest key and SHA256');const mf=path.join(dir,'manifest.json');cf(w,['r2','object','get',`${BUCKET}/${key}`,'--remote','--file',mf]);if(await digest(mf)!==wanted)throw new Error('Fixed manifest SHA256 mismatch');const {m}=await loadManifest(mf);if(m.manifestKey!==key)throw new Error('Manifest key identity mismatch');if(latest&&(latest.sourceCommit!==m.sourceCommit||latest.release!==m.release||latest.deploymentId!==m.deploymentId||latest.packageKey!==m.package.key||latest.packageSha256!==m.package.sha256||(latest.packageTransport||'single-object-v1')!==(m.package.parts?PART_TRANSPORT:'single-object-v1')))throw new Error('Latest pointer and fixed manifest disagree');const archive=await readPackage(w,m,dir);const receipt=await verifyAndDrill(mf,archive,path.join(dir,'restored'));receipt.packageTransport=m.package.parts?PART_TRANSPORT:'single-object-v1';receipt.partCount=m.package.parts?.length||1;receipt.fullArchiveReassembledSHA256Verified=true;await writeJson(path.join(dir,'restore-drill.json'),receipt);return {fetchedAndRestoredForReview:true,directory:dir,receipt};
}
try{let result;if(command==='seal')result=await seal();else if(command==='publish')result=await publish();else if(command==='fetch')result=await fetchRecovery();else if(command==='verify'){result=await verifyAndDrill(absolute(required('manifest')),absolute(required('archive')),absolute(required('stage')));if(opts.receipt)await writeJson(absolute(opts.receipt),result);}else throw new Error('Commands: seal | publish | fetch | verify');console.log(JSON.stringify(result,null,2));}catch(e){console.error(e.message);process.exitCode=1;}
