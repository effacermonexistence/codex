'use strict';
const crypto = require('node:crypto');
const {pipeline} = require('node:stream/promises');
const {S3Client,PutObjectCommand,HeadObjectCommand,GetObjectCommand,DeleteObjectCommand} = require('@aws-sdk/client-s3');
const FORM_ID = '68656582e759892761381cba';
const MESSAGE_ID = 'textarea-yui_3_17_2_1_1663856203892_2073';
const MAX_FILES = 3, MAX_BYTES = 25 * 1024 * 1024, TOKEN = /^[A-Za-z0-9_-]{43}$/;
const CANONICAL = 'https://www.effacermonexistence.com';
function inspect(b) {
  if (b.length < 16) return null;
  if (b[0]===255 && b[1]===216 && b[2]===255) return {ext:'jpg',mime:'image/jpeg'};
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return {ext:'png',mime:'image/png'};
  if (b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') return {ext:'webp',mime:'image/webp'};
  if (/^GIF8[79]a$/.test(b.toString('ascii',0,6))) return {ext:'gif',mime:'image/gif'};
  if (b.subarray(0,4).equals(Buffer.from([73,73,42,0])) || b.subarray(0,4).equals(Buffer.from([77,77,0,42]))) return {ext:'tiff',mime:'image/tiff'};
  if (b.toString('ascii',4,8)==='ftyp') {
    const brand=b.toString('ascii',8,12);
    if (['heic','heix','hevc','hevx','mif1','msf1'].includes(brand)) return {ext:'heic',mime:'image/heic'};
    if (['avif','avis'].includes(brand)) return {ext:'avif',mime:'image/avif'};
    if (brand==='qt  ') return {ext:'mov',mime:'video/quicktime'};
    if (['isom','iso2','mp41','mp42','avc1','M4V ','MSNV'].includes(brand)) return {ext:'mp4',mime:'video/mp4'};
  }
  if (b.subarray(0,4).equals(Buffer.from([26,69,223,163]))) return {ext:'webm',mime:'video/webm'};
  return null;
}
function safeName(raw) {
  const s=String(raw||'attachment').normalize('NFC').replace(/[\x00-\x1f\x7f/\\]/g,'').replace(/[^\p{L}\p{N} ._()-]/gu,'_').trim();
  return (s||'attachment').slice(0,100);
}
function reply(res,status,body) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(body));
}
function sameOrigin(req) {
  try {const u=new URL(req.headers.origin);return /^https?:$/.test(u.protocol)&&u.host===req.headers.host} catch {return false}
}
function envReady() {
  return ['APPLY_UPLOAD_ENDPOINT','APPLY_UPLOAD_BUCKET','APPLY_UPLOAD_REGION','APPLY_UPLOAD_ACCESS_KEY_ID','APPLY_UPLOAD_SECRET_ACCESS_KEY'].every(k=>!!process.env[k]);
}
function envClient() {
  return new S3Client({region:process.env.APPLY_UPLOAD_REGION,endpoint:process.env.APPLY_UPLOAD_ENDPOINT,
    forcePathStyle:process.env.APPLY_UPLOAD_URL_STYLE==='path',
    credentials:{accessKeyId:process.env.APPLY_UPLOAD_ACCESS_KEY_ID,secretAccessKey:process.env.APPLY_UPLOAD_SECRET_ACCESS_KEY},
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
}
function createApplyUpload({client,bucket,clock=Date.now}={}) {
  const rate=new Map(),s3=()=>client||envClient(),bucketName=()=>bucket||process.env.APPLY_UPLOAD_BUCKET;
  function quota(req) {
    const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',').at(-1).trim().slice(0,80);
    const now=clock(),recent=(rate.get(ip)||[]).filter(t=>now-t<3600000);
    if (recent.length>=6) {rate.set(ip,recent);return false}
    recent.push(now);rate.set(ip,recent);
    if(rate.size>5000) for(const [k,v] of rate) if(v.every(t=>now-t>=3600000))rate.delete(k);
    return true;
  }
  async function upload(req,res) {
    if(req.method!=='POST')return reply(res,405,{error:'method_not_allowed'});
    if(!sameOrigin(req))return reply(res,403,{error:'origin_mismatch'});
    if(!client&&!envReady())return reply(res,503,{error:'upload_unavailable'});
    if(!quota(req))return reply(res,429,{error:'upload_rate_limit'});
    const advertised=Number(req.headers['content-length']);
    if(Number.isFinite(advertised)&&advertised>MAX_BYTES)return reply(res,413,{error:'file_too_large'});
    const session=String(req.headers['x-apply-upload-session']||'');
    if(!/^[0-9a-f-]{36}$/.test(session))return reply(res,400,{error:'invalid_session'});
    let original;
    try {original=safeName(decodeURIComponent(String(req.headers['x-apply-filename']||'attachment')))}
    catch {return reply(res,400,{error:'invalid_filename'})}
    let size=0;const chunks=[];
    try {for await(const part of req){size+=part.length;if(size>MAX_BYTES)return reply(res,413,{error:'file_too_large'});chunks.push(part)}}
    catch {return reply(res,400,{error:'invalid_upload'})}
    const body=Buffer.concat(chunks),kind=inspect(body);
    if(!body.length)return reply(res,400,{error:'empty_file'});
    if(!kind)return reply(res,415,{error:'unsupported_file_type'});
    const ext=original.includes('.')?original.split('.').at(-1).toLowerCase():kind.ext;
    const compatible={jpg:['jpg','jpeg'],png:['png'],webp:['webp'],gif:['gif'],tiff:['tif','tiff'],heic:['heic','heif'],avif:['avif'],mov:['mov'],mp4:['mp4','m4v'],webm:['webm']};
    if(!compatible[kind.ext].includes(ext))return reply(res,415,{error:'file_type_mismatch'});
    const id=crypto.randomBytes(32).toString('base64url'),key='apply/v1/'+id;
    try {
      await s3().send(new PutObjectCommand({Bucket:bucketName(),Key:key,Body:body,ContentType:kind.mime,
        Metadata:{name:encodeURIComponent(original),session,created:String(clock()),sha256:crypto.createHash('sha256').update(body).digest('hex')}}));
      const head=await s3().send(new HeadObjectCommand({Bucket:bucketName(),Key:key}));
      if(Number(head.ContentLength)!==body.length)throw Error('storage_integrity');
    } catch {return reply(res,502,{error:'storage_unavailable'})}
    return reply(res,201,{id,name:original,bytes:body.length,type:kind.mime,url:'/api/apply/file/'+id});
  }
  async function read(req,res,id) {
    if(req.method!=='GET'&&req.method!=='HEAD')return reply(res,405,{error:'method_not_allowed'});
    if(!TOKEN.test(id))return reply(res,404,{error:'not_found'});
    if(!client&&!envReady())return reply(res,503,{error:'upload_unavailable'});
    try {
      const item=await s3().send(new GetObjectCommand({Bucket:bucketName(),Key:'apply/v1/'+id}));
      const filename=safeName(decodeURIComponent(item.Metadata?.name||'attachment')).replace(/"/g,'');
      const ascii=filename.replace(/[^\x20-\x7e]/g,'_');
      res.writeHead(200,{'content-type':item.ContentType||'application/octet-stream','content-length':item.ContentLength,
        'content-disposition':'attachment; filename="'+ascii+'"; filename*=UTF-8'+"''"+encodeURIComponent(filename),'cache-control':'private, no-store',
        'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"});
      if(req.method==='HEAD'){item.Body?.destroy?.();return res.end()}
      await pipeline(item.Body,res);
      return;
    } catch {if(res.headersSent)return res.destroy();return reply(res,404,{error:'not_found'})}
  }
  async function remove(req,res,id) {
    if(req.method!=='DELETE')return reply(res,405,{error:'method_not_allowed'});
    if(!sameOrigin(req))return reply(res,403,{error:'origin_mismatch'});
    const session=String(req.headers['x-apply-upload-session']||'');
    if(!TOKEN.test(id)||!/^[0-9a-f-]{36}$/.test(session))return reply(res,400,{error:'invalid_reference'});
    if(!client&&!envReady())return reply(res,503,{error:'upload_unavailable'});
    try {
      const key='apply/v1/'+id,head=await s3().send(new HeadObjectCommand({Bucket:bucketName(),Key:key}));
      if(head.Metadata?.session!==session)return reply(res,403,{error:'session_mismatch'});
      await s3().send(new DeleteObjectCommand({Bucket:bucketName(),Key:key}));
      res.writeHead(204,{'cache-control':'no-store'});res.end();
    } catch {return reply(res,404,{error:'not_found'})}
  }
  async function attach(body,type) {
    if(!body||!String(type).toLowerCase().startsWith('application/json'))return body;
    let outer;try {outer=JSON.parse(body.toString('utf8'))} catch {return body}
    const ids=outer.applyUploadIds;if(ids===undefined)return body;
    if(outer.formId!==FORM_ID||!Array.isArray(ids)||ids.length>MAX_FILES||new Set(ids).size!==ids.length||ids.some(id=>!TOKEN.test(id)))
      throw Object.assign(Error('invalid_attachments'),{status:400});
    const session=String(outer.applyUploadSession||'');
    if(!/^[0-9a-f-]{36}$/.test(session))throw Object.assign(Error('invalid_session'),{status:400});
    if(ids.length&&!client&&!envReady())throw Object.assign(Error('upload_unavailable'),{status:503});
    let form;try {form=JSON.parse(outer.form)} catch {throw Object.assign(Error('invalid_form'),{status:400})}
    if(!form||Array.isArray(form)||typeof form!=='object')throw Object.assign(Error('invalid_form'),{status:400});
    const links=[];
    for(const id of ids){
      let head;try {head=await s3().send(new HeadObjectCommand({Bucket:bucketName(),Key:'apply/v1/'+id}))}
      catch {throw Object.assign(Error('attachment_missing'),{status:400})}
      if(head.Metadata?.session!==session)throw Object.assign(Error('attachment_session_mismatch'),{status:400});
      const file=safeName(decodeURIComponent(head.Metadata?.name||'attachment'));
      links.push(file+': '+CANONICAL+'/api/apply/file/'+id);
    }
    if(links.length)form[MESSAGE_ID]=String(form[MESSAGE_ID]||'')+(form[MESSAGE_ID]?'\\n\\n':'')+'Reference files\\n'+links.join('\\n');
    delete outer.applyUploadIds;delete outer.applyUploadSession;outer.form=JSON.stringify(form);
    return Buffer.from(JSON.stringify(outer));
  }
  return {upload,read,remove,attach};
}
module.exports={createApplyUpload,inspect,safeName,MAX_FILES,MAX_BYTES};
