'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');
const ID=/^[A-Za-z0-9][A-Za-z0-9-]{2,110}$/;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const CONTENT_TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.pdf':'application/pdf','.mp4':'video/mp4','.m4a':'audio/mp4','.woff2':'font/woff2','.woff':'font/woff'};
function normalizePage(value){
 if(typeof value!=='string'||value.length>180||!/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(value))return null;
 return value.length>1&&value.endsWith('/')?value.slice(0,-1):value;
}
function json(res,status,data){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data))}
function s3FromEnv(){
 const e=process.env,names=['SITE_HISTORY_ENDPOINT','SITE_HISTORY_BUCKET','SITE_HISTORY_REGION','SITE_HISTORY_ACCESS_KEY_ID','SITE_HISTORY_SECRET_ACCESS_KEY'];
 if(!names.every(k=>e[k]))return null;
 return new S3Client({region:e.SITE_HISTORY_REGION,endpoint:e.SITE_HISTORY_ENDPOINT,forcePathStyle:e.SITE_HISTORY_URL_STYLE==='path',
   credentials:{accessKeyId:e.SITE_HISTORY_ACCESS_KEY_ID,secretAccessKey:e.SITE_HISTORY_SECRET_ACCESS_KEY},
   requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
}
function createSiteHistory(root,{client,bucket}={}){
 const index=JSON.parse(fs.readFileSync(path.join(root,'content/site-history/index.json'),'utf8'));
 if(index.schemaVersion!==1||!Array.isArray(index.releases)||!Array.isArray(index.deploymentLedger))throw Error('Site history index invalid');
 const storage=client||s3FromEnv(),bucketName=bucket||process.env.SITE_HISTORY_BUCKET;
 const releaseById=new Map(index.releases.map(r=>[r.id,r]));
 if(releaseById.size!==index.releases.length)throw Error('Duplicate history release');
 const manifestCache=new Map();
 async function getObject(key,limit){
  if(!storage||!bucketName)throw Object.assign(Error('History storage unavailable'),{status:503});
  const object=await storage.send(new GetObjectCommand({Bucket:bucketName,Key:key}));
  const chunks=[];let n=0;
  for await(const chunk of object.Body){n+=chunk.length;if(n>limit)throw Error('History object too large');chunks.push(chunk)}
  return Buffer.concat(chunks);
 }
 async function manifest(id){
  if(!ID.test(id)||!releaseById.has(id))throw Object.assign(Error('Unknown release'),{status:404});
  if(manifestCache.has(id))return manifestCache.get(id);
  const meta=releaseById.get(id),raw=await getObject(meta.manifestKey,1024*1024);
  if(sha(raw)!==meta.manifestSha256)throw Error('History manifest checksum');
  const doc=JSON.parse(raw.toString('utf8'));
  if(doc.schemaVersion!==1||doc.id!==id||typeof doc.pages!=='object'||typeof doc.assets!=='object')throw Error('History manifest schema');
  manifestCache.set(id,doc);
  return doc;
 }
 function indexResponse(req,res,url){
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'method_not_allowed'});
  const page=normalizePage(url.searchParams.get('path')||'/');
  if(page===null)return json(res,400,{error:'invalid_page'});
  const releases=index.releases.filter(r=>r.pagePaths.includes(page)).map(r=>({id:r.id,date:r.date,source:r.source,label:r.label,kind:r.kind,
    pagePath:page,viewUrl:'/api/site-history/page?release='+encodeURIComponent(r.id)+'&path='+encodeURIComponent(page)}));
  const unavailable=index.deploymentLedger.filter(x=>!x.sourceArchived).map(x=>({date:x.date,label:x.label}));
  return json(res,200,{schemaVersion:1,page,releases,unavailable,releaseCount:index.releases.length,
   ledgerCount:index.deploymentLedger.length,unviewableDeployments:unavailable.length,
   sourceBoundary:'Only source-verified archived releases are viewable; a deployment log alone is not a page snapshot'});
 }
 function rewriteLocalAssets(html,id){
  const prefix='/api/site-history/asset?release='+encodeURIComponent(id)+'&path=';
  return html.replace(/https:\/\/www\.effacermonexistence\.com\/s\/([A-Za-z0-9._~%/-]+)/g,(_,name)=>prefix+encodeURIComponent('/s/'+decodeURIComponent(name)))
    .replace(/(?<![A-Za-z0-9])\/s\/([A-Za-z0-9._~%/-]+)/g,(_,name)=>prefix+encodeURIComponent('/s/'+decodeURIComponent(name)))
    .replace(/(["'])\/\/(images\.squarespace-cdn\.com|static1\.squarespace\.com)/g,'$1https://$2');
 }
 async function pageResponse(req,res,url){
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'method_not_allowed'});
  const id=url.searchParams.get('release')||'',page=normalizePage(url.searchParams.get('path')||'');
  if(!ID.test(id)||!page)return json(res,400,{error:'invalid_request'});
  const item=releaseById.get(id);if(!item||!item.pagePaths.includes(page))return json(res,404,{error:'page_not_archived'});
  try{const doc=await manifest(id),spec=doc.pages[page];if(!spec)return json(res,404,{error:'page_not_archived'});
   const zipped=await getObject(spec.key,6*1024*1024),raw=zlib.gunzipSync(zipped,{maxOutputLength:8*1024*1024});
   if(raw.length!==spec.bytes||sha(raw)!==spec.sha256)throw Error('History page checksum');
   const html=rewriteLocalAssets(raw.toString('utf8'),id);
   const body=Buffer.from(html);
   res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-length':body.length,'cache-control':'private, no-store',
    'x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'self' https: data: blob:; script-src 'none'; style-src 'self' 'unsafe-inline' https:; form-action 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'"});
   return res.end(req.method==='HEAD'?undefined:body);
  }catch(error){return json(res,error.status||502,{error:error.status===503?'storage_unavailable':error.status===404?'not_found':'history_unavailable'})}
 }
 async function assetResponse(req,res,url){
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'method_not_allowed'});
  const id=url.searchParams.get('release')||'',asset=url.searchParams.get('path')||'';
  if(!ID.test(id)||asset.length>220||!/^\/s\/[A-Za-z0-9._~%/-]+$/.test(asset))return json(res,400,{error:'invalid_request'});
  if(!releaseById.has(id))return json(res,404,{error:'unknown_release'});
  try{const doc=await manifest(id),spec=doc.assets[asset];if(!spec)return json(res,404,{error:'asset_not_archived'});
   const body=await getObject(spec.key,50*1024*1024);if(body.length!==spec.bytes||sha(body)!==spec.sha256)throw Error('History asset checksum');
   const type=spec.type||CONTENT_TYPES[path.extname(asset).toLowerCase()]||'application/octet-stream';
   res.writeHead(200,{'content-type':type,'content-length':body.length,'cache-control':'public, max-age=31536000, immutable','x-content-type-options':'nosniff'});
   return res.end(req.method==='HEAD'?undefined:body);
  }catch(error){return json(res,error.status||502,{error:error.status===503?'storage_unavailable':error.status===404?'not_found':'history_unavailable'})}
 }
 return {indexResponse,pageResponse,assetResponse,index,manifest};
}
module.exports={createSiteHistory,normalizePage};
