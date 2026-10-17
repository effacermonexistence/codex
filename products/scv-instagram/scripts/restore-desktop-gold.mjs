#!/usr/bin/env node
// Thin desktop closure step over the existing Gold resolver/downloader.
// Does not deploy cloud code, overwrite customer state, start a peer or copy auth.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadGold,recoverGold} from './recover-gold.mjs';
import {check,reference,verify,safeRelative} from './recover-v151.mjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const allowInstall=new Set(['portable-desktop.py','continuity-adapter.cjs','continuity-source/portable-history.cjs','continuity-source/native-rpc.cjs','continuity-source/native-provider.cjs','continuity-source/history-visibility.cjs']);
export function checkedArtifact(acquisition,ref){
 ref=reference(ref);const receipt=JSON.parse(fs.readFileSync(path.join(acquisition,'ACQUISITION-AND-RESTORE-RECEIPT.json')));
 check(receipt.artifact_acquisition_verified===true&&receipt.production_mutated===false&&Array.isArray(receipt.artifacts),'verified_acquisition_receipt_required');
 const matches=receipt.artifacts.filter(x=>x.key===ref.key);check(matches.length===1&&JSON.stringify(reference(matches[0]))===JSON.stringify(ref),'artifact_not_in_verified_chain');
 const file=path.join(acquisition,'objects',ref.key);verify(file,ref);return{file,ref};
}
export function stageDesktop(acquisition,gold,{python='/usr/bin/python3',run=spawnSync}={}){
 const manifests=gold.manifests.map(ref=>JSON.parse(fs.readFileSync(checkedArtifact(acquisition,ref).file)));
 const extensions=manifests.filter(m=>m.desktop_component&&m.desktop_archive);check(extensions.length===1,'exact_desktop_closure_extension_required');
 const ext=extensions[0],metadata=checkedArtifact(acquisition,ext.desktop_component),archive=checkedArtifact(acquisition,ext.desktop_archive);
 const components=ext.components||[];const helpers=components.filter(x=>String(x.name).startsWith('desktop_restore_adapter_'));
 check(helpers.length===1,'one_pinned_desktop_restore_adapter_required');
 const toolRoot=path.join(acquisition,'recovery-tools');check(!fs.existsSync(toolRoot),'desktop_recovery_tools_already_exists');fs.mkdirSync(toolRoot,{mode:0o700});
 const helper=checkedArtifact(acquisition,helpers[0]),helperPath=path.join(toolRoot,'portable-desktop.py');fs.copyFileSync(helper.file,helperPath,fs.constants.COPYFILE_EXCL);fs.chmodSync(helperPath,0o600);
 // Optional recovery primitives install only at exact fixed role paths. No
 // path or shell program supplied by a manifest can escape this allowlist.
 const installed=[],mappedPaths=new Set();
 for(const item of components){
  if(!item.recovery_relative_path)continue;const relative=safeRelative(item.recovery_relative_path);check(allowInstall.has(relative),'recovery_tool_path_not_allowed');check(!mappedPaths.has(relative),'duplicate_recovery_tool_path');mappedPaths.add(relative);
  if(relative==='portable-desktop.py'){check(item.key===helper.ref.key&&item.sha256===helper.ref.sha256,'desktop_helper_role_mismatch');continue}const checked=checkedArtifact(acquisition,item),to=path.join(toolRoot,relative);check(!fs.existsSync(to),'duplicate_recovery_tool_path');fs.mkdirSync(path.dirname(to),{recursive:true,mode:0o700});fs.copyFileSync(checked.file,to,fs.constants.COPYFILE_EXCL);fs.chmodSync(to,0o600);installed.push({path:relative,sha256:item.sha256});
 }
 for(const required of allowInstall)check(mappedPaths.has(required),'missing_recovery_primitive:'+required);
 const target=path.join(acquisition,'staged','desktop');
 const result=run(python,[helperPath,'restore','--archive',archive.file,'--component',metadata.file,'--component-sha256',metadata.ref.sha256,'--target',target],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
 check(result.status===0,'desktop_offline_restore_failed');const receipt=JSON.parse(result.stdout);check(receipt.runtime_activated===false&&receipt.auth_material_copied===false&&receipt.customer_sends===0&&receipt.runtime_binding?.release_id===gold.release_id,'desktop_restore_receipt_scope_mismatch');
 const out={schema:'scv-gold-desktop-stage-v1',ok:true,gold_id:gold.gold_id,release_id:gold.release_id,desktop:target,helper:helperPath,recovery_tools:toolRoot,installed_recovery_tools:installed,desktop_restore_receipt:receipt,production_mutated:false,runtime_activated:false,customer_state_applied:false,auth_caches_copied:false,physical_new_mac_tested:false};
 fs.writeFileSync(path.join(acquisition,'DESKTOP-STAGE-RECEIPT.json'),JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});return out;
}
export function prepareLocal(stage,{node=process.execPath,python='/usr/bin/python3',run=spawnSync}={}){
 const result=run(python,[stage.helper,'prepare-install','--staged',stage.desktop,'--node',node,'--python',python],{encoding:'utf8',timeout:180000,maxBuffer:1024*1024});
 check(result.status===0,'local_preparation_blocked_device_prerequisite_or_existing_service');const receipt=JSON.parse(result.stdout);check(receipt.ok===true&&receipt.runtime_activated===false&&receipt.services_started===false&&receipt.auth_caches_copied===false&&receipt.customer_state_modified===false,'local_preparation_receipt_mismatch');return receipt;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.umask(0o077);try{
  const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i++){
   if(['--resolve','--acquire-only','--prepare-local'].includes(args[i])){check(!options[args[i]],'duplicate_flag');options[args[i]]=true;continue}
   check(['--target','--offline-root','--gold'].includes(args[i])&&args[i+1]&&!options[args[i]],'usage: --resolve | --target NEW_PRIVATE_DIRECTORY [--gold EXACT_ID] [--offline-root VERIFIED_OBJECTS] [--acquire-only | --prepare-local]');options[args[i]]=args[++i];
  }
  const selected=loadGold(undefined,options['--gold']||'');if(options['--resolve']){console.log(JSON.stringify(selected.gold,null,2));process.exit(0)}
  check(options['--target'],'fresh_private_target_required');check(!(options['--acquire-only']&&options['--prepare-local']),'conflicting_preparation_mode');
  const acquired=await recoverGold({target:options['--target'],offlineRoot:options['--offline-root'],goldId:options['--gold']||''});
  const stage=stageDesktop(acquired.target,selected.gold);const preparation=options['--prepare-local']?prepareLocal(stage):null;
  console.log(JSON.stringify({ok:true,gold_id:selected.gold.gold_id,acquisition:acquired,desktop_stage:stage,local_preparation:preparation,
   runtime_activated:false,customer_state_applied:false,physical_new_mac_tested:false,
   next:'Follow the Gold guide: fresh device OAuth, safe single-peer continuity rebind and actual runtime readiness are separate mandatory activation gates. Acquisition/local preparation is not operating-system activation.'},null,2));
 }catch(e){console.error(JSON.stringify({ok:false,error:e.message,production_mutated:false,runtime_activated:false}));process.exitCode=1}
}
