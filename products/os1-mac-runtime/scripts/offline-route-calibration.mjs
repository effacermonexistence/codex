#!/usr/bin/env node
/** Offline-only CLI. Explicit source path + SHA, exclusive output. Never scans
 * accounts, calls a provider, registers a runtime artifact, or modifies inputs.
 */
import {createHash} from 'node:crypto';
import {constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, readSync, writeFileSync} from 'node:fs';
import {isAbsolute, resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {produceOfflineRouteCalibration, OFFLINE_CALIBRATION_LIMITS as L} from '../Resources/openclaw-os1-bridge/offline-route-calibration.mjs';
const need = (x, code) => {if (!x) throw Object.assign(new Error(code), {code});};
const same = (a,b) => ['dev','ino','mode','uid','nlink','size','mtimeNs','ctimeNs'].every(k=>a[k]===b[k]);
export function parseOfflineJSON(text) {
  try {
  let i=0,n=0;
  const ws=()=>{while (/[\t\r\n ]/.test(text[i]??'x'))i++;};
  const str=()=>{const start=i++;while(i<text.length){const c=text[i++];if(c==='\\')i++;else if(c==='"')return JSON.parse(text.slice(start,i));}need(false,'oc_json_invalid');};
  const value=depth=>{need(++n<=L.json_nodes,'oc_capacity_json_nodes');need(depth<=L.json_depth,'oc_capacity_json_depth');ws();const c=text[i];
    if(c==='"')return str();
    if(c==='{'){i++;ws();const o=Object.create(null);if(text[i]==='}'){i++;return o;}
      for(;;){ws();need(text[i]==='"','oc_json_invalid');const k=str();need(!Object.hasOwn(o,k)&&!['__proto__','constructor','prototype'].includes(k),'oc_duplicate_or_forbidden_key');ws();need(text[i++]===':','oc_json_invalid');o[k]=value(depth+1);ws();const end=text[i++];if(end==='}')return o;need(end===',','oc_json_invalid');}}
    if(c==='['){i++;ws();const a=[];if(text[i]===']'){i++;return a;}for(;;){need(a.length<L.array_items,'oc_capacity_array_items');a.push(value(depth+1));ws();const end=text[i++];if(end===']')return a;need(end===',','oc_json_invalid');}}
    const token=text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    need(token,'oc_json_invalid');i+=token.length;const v=JSON.parse(token);need(typeof v!=='number'||Number.isFinite(v),'oc_nonfinite');return v;};
  const result=value(0);ws();need(i===text.length,'oc_json_invalid');return result;
  } catch(error) {const code=/^oc_[a-z_]+$/.test(error?.code??'')?error.code:'oc_json_invalid';
    throw Object.assign(new Error(code),{code});}
}
export function readPinnedOfflineJSON(path, expectedSHA) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&realpathSync(path)===path,'oc_source_path_not_canonical');
  need(/^[a-f0-9]{64}$/.test(expectedSHA??''),'oc_source_pin_required');
  let fd;
  try {fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const a=fstatSync(fd,{bigint:true});
    need(a.isFile()&&a.nlink===1n&&a.uid===BigInt(process.getuid())&&(a.mode&0o7133n)===0n&&a.size>1n&&
      same(a,lstatSync(path,{bigint:true})),'oc_source_custody_or_size');
    need(a.size<=BigInt(L.input_bytes),'oc_capacity_input_bytes');
    const bytes=Buffer.alloc(Number(a.size));let at=0;while(at<bytes.length){const n=readSync(fd,bytes,at,bytes.length-at,at);need(n>0,'oc_short_read');at+=n;}
    const b=fstatSync(fd,{bigint:true});need(same(a,b)&&same(b,lstatSync(path,{bigint:true}))&&realpathSync(path)===path,'oc_source_changed');
    const observed=createHash('sha256').update(bytes).digest('hex');need(observed===expectedSHA,'oc_source_hash_mismatch');
    const text=bytes.toString('utf8');need(Buffer.from(text).equals(bytes),'oc_utf8_invalid');
    return {value:parseOfflineJSON(text),source_sha256:observed,source_bytes:bytes.length};
  } finally {if(fd!==undefined)closeSync(fd);}
}
/** Read-only readiness report for legacy/current data. NEVER fits or translates
 * legacy rows into qualified examples. Missing quantities remain null.
 */
export function inspectOfflineCalibrationSource(value) {
  const rows=Array.isArray(value?.rows)?value.rows:[];
  const requirements={preregistered_statistical_policy:value?.policy,
    explicit_training_assignment_retaining_original_labels:value?.assignment,source_bound_exact_attempt_evidence_join:value?.evidence,
    preoutcome_features_and_per_tuple_harness:value?.samples,independently_grounded_reference_match_and_task_success_labels:value?.evidence,
    disjoint_supported_total_resource_evidence:value?.samples,training_fit_lock_before_calibration_collection:value?.fit_lock,
    source_rights_lineage_and_iid_review:value?.sources};
  const contract_presence=Object.fromEntries(Object.entries(requirements).map(([k,v])=>[k,v==null?'missing':'present_not_validated']));
  return {schema:1,status:'insufficient_evidence',action:'inspection_only_no_fit',
    declared_proof_mode:typeof value?.proof_mode==='string'?value.proof_mode:null,
    observed_rows:rows.length,observed_unique_case_ids:[...new Set(rows.map(x=>x.case_id).filter(x=>typeof x==='string'))].sort(),
    observed_explicit_null_reference_match_labels:rows.filter(x=>Object.hasOwn(x,'learnable_reference_match_label')&&x.learnable_reference_match_label===null).length,
    contract_presence,missing_contracts:Object.keys(contract_presence).filter(k=>contract_presence[k]==='missing'),
    training_executed:false,calibration_assessed:false,training_model:null,model_calls:0,
    execution_authorized:false,quality_certificate:false,live_route_change_authorized:false};
}
export function main(args) {
  need(args.length===4&&['produce','inspect'].includes(args[0]),'oc_cli_usage');
  const [mode,path,pin,out]=args;
  need(isAbsolute(out)&&resolve(out)===out&&out!==path,'oc_output_path_invalid');
  need(realpathSync(dirname(out))===dirname(out),'oc_output_parent_alias');
  const parent=lstatSync(dirname(out),{bigint:true});
  need(parent.isDirectory()&&parent.uid===BigInt(process.getuid())&&(parent.mode&0o077n)===0n,'oc_output_parent_not_private');
  const loaded=readPinnedOfflineJSON(path,pin);
  const report=mode==='produce'?produceOfflineRouteCalibration(loaded.value):inspectOfflineCalibrationSource(loaded.value);
  writeFileSync(out,JSON.stringify({...report,input_file_receipt:{path,sha256:loaded.source_sha256,bytes:loaded.source_bytes}},null,2)+'\n',
    {encoding:'utf8',mode:0o600,flag:'wx'});
  return ['synthetic_training_fit_not_efficacy','offline_training_fit_needs_independent_calibration',
    'synthetic_fit_assessed_not_efficacy','offline_fit_assessed_external_review_required'].includes(report.status)?0:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try{process.exitCode=main(process.argv.slice(2));}catch(error){const code=/^(?:oc_[a-z_]+|E[A-Z0-9_]+)$/.test(error?.code??'')?error.code:'oc_cli_input_or_io_failed';process.stderr.write(`${code}\n`);process.exitCode=1;}
}
