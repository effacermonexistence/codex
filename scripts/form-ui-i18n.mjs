// Bounded Squarespace form UI adapter. Never translates arbitrary scripts,
// submitted values, field IDs, storage settings, redirects or transport data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const LANGUAGE_CODES=new Set(JSON.parse(fs.readFileSync(path.join(ROOT,'content/i18n/languages.json'),'utf8')).map(x=>x.code));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const TOKEN=/⟦P\d{4,}⟧/g;
const attr=raw=>Object.fromEntries([...raw.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),m[2]??m[3]]));
const isDictionary=id=>/^form-context-localized-strings-[\w-]+$/.test(id);
const isContext=id=>/^form-context-(?!localized-strings-)[\w-]+$/.test(id);
const pointer=bits=>'/'+bits.map(x=>String(x).replaceAll('~','~0').replaceAll('/','~1')).join('/');
function uiSegment(raw,kind){
  if(typeof raw!=='string'||!/[\p{L}]/u.test(raw))return null;
  const protectedItems=[];
  const put=(value,type)=>{const token='⟦P'+String(protectedItems.length).padStart(4,'0')+'⟧';protectedItems.push({token,value,kind:type});return token;};
  const source=raw.replace(/<\/?[A-Za-z][\w:-]*(?:"[^"]*"|'[^']*'|[^'">])*>|\{(?:\d+|@)\}|[\u200b-\u200f\ufeff]+|\b\d+(?:[.,]\d+)*\b|\buser@domain\.com\b/g,value=>put(value,value.startsWith('<')?'markup':'literal'));
  const stable={kind,source,protected:protectedItems};
  return{id:'ui_'+sha(JSON.stringify(stable)).slice(0,20),...stable};
}
function valueSlots(data,id){
  const slots=[];
  const add=(bits,kind='text')=>{let value=data;for(const bit of bits)value=value?.[bit];const s=uiSegment(value,kind);if(s)slots.push({bits,pointer:pointer(bits),sourceRaw:value,segment:s});};
  if(isDictionary(id)){
    const walk=(value,bits=[])=>{if(typeof value==='string')add(bits,/<\/?[A-Za-z]/.test(value)?'html':'text');else if(value&&typeof value==='object')for(const[key,next]of Object.entries(value))walk(next,[...bits,key]);};
    walk(data);return slots;
  }
  if(!isContext(id))return slots;
  for(const[fieldIndex,field]of(data.formFields||[]).entries()){
    if(!field||typeof field!=='object')continue;
    for(const key of ['title','description','placeholder'])add(['formFields',fieldIndex,key]);
    // Plain option strings may also be submitted values. Do not translate them.
  }
  add(['formSubmitButtonText']);add(['formSubmissionMessage','html'],'html');
  for(const format of ['initialAddressFormat','initialPhoneFormat'])for(const[index,field]of(data.formFieldFormats?.[format]?.fields||[]).entries())if(field.type==='FIELD')add(['formFieldFormats',format,'fields',index,'label']);
  for(const[index]of(data.formFieldFormats?.countries||[]).entries())add(['formFieldFormats','countries',index,'name']);
  return slots;
}
export function extractFormUi(html,route='/'){
  const scripts=[];
  for(const m of html.matchAll(/<script\b([^>]*?)>([\s\S]*?)<\/script>/gi)){
    const attributes=attr(m[1]),id=attributes.id||'';
    if(attributes.type!=='application/json'||(!isContext(id)&&!isDictionary(id)))continue;
    const data=JSON.parse(m[2]),slots=valueSlots(data,id);
    scripts.push({id,start:m.index,end:m.index+m[0].length,open:m[0].slice(0,m[0].indexOf('>')+1),raw:m[2],data,slots:slots.map(s=>({...s,route,scriptId:id}))});
  }
  return scripts;
}
export function collectFormUi(root=ROOT){
  const main=JSON.parse(fs.readFileSync(path.join(root,'content/i18n/source-catalog.json'),'utf8'));
  const files=[['/',path.join(root,'site/index.html')],...fs.readdirSync(path.join(root,'site/pages')).filter(x=>x.endsWith('.html')).sort().map(x=>['/'+x.slice(0,-5),path.join(root,'site/pages',x)]),['404',path.join(root,'site/404.html')]];
  const segments=new Map(),scripts=[];
  for(const[route,file]of files)for(const script of extractFormUi(fs.readFileSync(file,'utf8'),route)){
    scripts.push({route,scriptId:script.id,sourceSha256:sha(script.raw),slotCount:script.slots.length});
    for(const slot of script.slots){if(!segments.has(slot.segment.id))segments.set(slot.segment.id,{...slot.segment,occurrences:[]});segments.get(slot.segment.id).occurrences.push({route,scriptId:script.id,pointer:slot.pointer,sourceRaw:slot.sourceRaw});}
  }
  const list=[...segments.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const sourceCatalogHash=sha(JSON.stringify(list.map(({id,kind,source,protected:p})=>({id,kind,source,protected:p}))));
  return{schemaVersion:1,kind:'form-ui-sidecar',parentSourceCatalogHash:main.sourceCatalogHash,sourceCatalogHash,sourceLanguage:'en',segmentCount:list.length,sourceCharacterCount:list.reduce((n,s)=>n+s.source.length,0),allowlist:{scriptIds:['form-context-<id>','form-context-localized-strings-<id>'],contextPointers:['/formFields/*/title','/formFields/*/description','/formFields/*/placeholder','/formSubmitButtonText','/formSubmissionMessage/html','/formFieldFormats/initialAddressFormat/fields/*/label (FIELD only)','/formFieldFormats/initialPhoneFormat/fields/*/label (FIELD only)','/formFieldFormats/countries/*/name'],dictionaryPointers:'string leaves only in the exact form-context-localized-strings application/json script',excluded:['field IDs','field types','required flags','option/submission values','country codes','phone codes','format identifiers','form/storage IDs','secureUrl','redirects','captcha/consent/business configuration','every other script']},scripts,segments:list};
}
export function validateFormUiLocale(catalog,data,validateEntry,{allowPartial=false}={}){
  if(data.schemaVersion!==1||data.kind!=='form-ui-sidecar'||data.locale==='en'||!LANGUAGE_CODES.has(data.locale))throw Error('form UI: invalid locale schema');
  if(data.sourceCatalogHash!==catalog.sourceCatalogHash||data.parentSourceCatalogHash!==catalog.parentSourceCatalogHash)throw Error('form UI: catalog lineage/hash mismatch');
  if(!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries))throw Error('form UI: entries must be an ID-to-string object');
  const known=new Map(catalog.segments.map(s=>[s.id,s]));
  for(const[id,value]of Object.entries(data.entries)){if(!known.has(id))throw Error('form UI: unknown segment '+id);validateEntry(known.get(id),value);}
  const missing=catalog.segments.filter(s=>data.entries[s.id]===undefined).map(s=>s.id);
  if(!missing.length&&catalog.segmentCount>0&&catalog.segments.every(s=>data.entries[s.id]===s.source))throw Error('form UI: untranslated source copy cannot qualify as complete');
  if(missing.length&&!allowPartial)throw Error(`form UI: ${data.locale} missing ${missing.length}/${catalog.segmentCount}`);
  return{locale:data.locale,translated:Object.keys(data.entries).length,required:catalog.segmentCount,missing,complete:missing.length===0};
}
function restore(s,value,validateEntry){
  validateEntry(s,value);const p=new Map(s.protected.map(x=>[x.token,x]));
  return value.split(/(⟦P\d{4,}⟧)/).map(part=>{if(p.has(part))return p.get(part).value;return s.kind==='html'?escape(part):part;}).join('');
}
export function localizeFormUi(html,route,language,catalog,entries,validateEntry){
  const scripts=extractFormUi(html,route),slots=scripts.flatMap(s=>s.slots);
  const expectedScripts=(catalog?.scripts||[]).filter(s=>s.route===route).map(s=>s.scriptId);
  if(language==='en'||(!slots.length&&!expectedScripts.length))return{html,status:slots.length?'original':'not-applicable',missing:[],translated:0,required:slots.length};
  const known=new Map((catalog?.segments||[]).map(s=>[s.id,s]));
  const allowedScripts=new Set((catalog?.scripts||[]).filter(s=>s.route===route).map(s=>s.scriptId));
  const allowed=slot=>known.get(slot.segment.id)?.occurrences.some(o=>o.route===route&&o.scriptId===slot.scriptId&&o.pointer===slot.pointer&&o.sourceRaw===slot.sourceRaw);
  const observedScripts=new Set(scripts.map(s=>s.id));
  const missing=[...new Set([...expectedScripts.filter(id=>!observedScripts.has(id)).map(id=>'ui-script:'+id),...scripts.filter(s=>!allowedScripts.has(s.id)).map(s=>'ui-script:'+s.id),...slots.filter(s=>!allowed(s)||entries[s.segment.id]===undefined).map(s=>s.segment.id)])];
  if(missing.length)return{html,status:'unavailable',missing,translated:0,required:slots.length};
  const derivedUiAliases=[],displayTargets=[];
  for(const script of [...scripts].reverse()){
    for(const slot of script.slots){let target=script.data;for(const key of slot.bits.slice(0,-1))target=target[key];target[slot.bits.at(-1)]=restore(known.get(slot.segment.id),entries[slot.segment.id],validateEntry);}
    // The contact form leaves this display-only field empty. Its vendor
    // default ignores the companion translated submit dictionary. Materialize
    // that existing, verified UI default; never change a submitted field value.
    if(isContext(script.id)){
      const companion=scripts.find(s=>s.id==='form-context-localized-strings-'+script.id.slice('form-context-'.length));
      const error=companion?.slots.find(s=>s.pointer==='/submitError');
      if(!error)throw Error('form UI: verified submitError dictionary entry missing');
      displayTargets.push({contextScriptId:script.id,message:restore(known.get(error.segment.id),entries[error.segment.id],validateEntry)});
     if(script.data.formSubmitButtonText===''){
      const submit=companion?.slots.find(s=>s.pointer==='/submit');
      if(!submit)throw Error('form UI: empty submit label has no verified companion default');
      script.data.formSubmitButtonText=restore(known.get(submit.segment.id),entries[submit.segment.id],validateEntry);
      derivedUiAliases.push({route,scriptId:script.id,pointer:'/formSubmitButtonText',sourceScriptId:companion.id,sourcePointer:'/submit'});
     }
    }
    // JSON serialization preserves value/field types; '<' cannot end the script.
    const json=JSON.stringify(script.data).replaceAll('<','\\u003c');
    html=html.slice(0,script.start)+script.open+json+'</script>'+html.slice(script.end);
  }
  const displayScript=displayTargets.length?'<script id="site-form-ui-display-i18n" type="application/json">'+JSON.stringify({schemaVersion:1,locale:language,targets:displayTargets}).replaceAll('<','\\u003c')+'</script>':'';
  if(displayScript){if(html.includes('id="site-form-ui-display-i18n"'))throw Error('form UI: duplicate display adapter payload');html=html.replace('</body>',displayScript+'</body>');}
  return{html,status:'translated',missing:[],translated:slots.length,required:slots.length,derivedUiAliases,displayScript};
}
export function createFormUiRuntime(root,languageCodes,validateEntry,parentSourceCatalogHash){
  const file=path.join(root,'content/i18n/form-ui-source.json');
  const catalog=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  if(catalog&&parentSourceCatalogHash&&catalog.parentSourceCatalogHash!==parentSourceCatalogHash)throw Error('form UI: parent main catalog mismatch');
  const dictionaries=new Map(),reports={};
  for(const language of languageCodes){if(language==='en'||catalog?.segmentCount===0)continue;const f=path.join(root,'content/i18n/ui-locales',language+'.json');
    if(!catalog||!fs.existsSync(f)){reports[language]={complete:false,translated:0,required:catalog?.segmentCount??null,status:catalog?'missing':'missing-source'};continue;}
    const data=JSON.parse(fs.readFileSync(f,'utf8'));if(data.locale!==language)throw Error('form UI: file/locale mismatch');const r=validateFormUiLocale(catalog,data,validateEntry,{allowPartial:true});dictionaries.set(language,data.entries);reports[language]={...r,missing:r.missing.length,status:r.complete?'complete':'partial'};
  }
  return{coverage:()=>({kind:'form-ui-sidecar',sourceCatalogHash:catalog?.sourceCatalogHash??null,parentSourceCatalogHash:catalog?.parentSourceCatalogHash??null,completeLocales:Object.values(reports).filter(r=>r.complete).length,requiredLocales:reports?Object.keys(reports).length:0,ready:!!catalog&&Object.values(reports).every(r=>r.complete),languages:reports}),localize:(html,route,language)=>localizeFormUi(html,route,language,catalog,dictionaries.get(language)||{},validateEntry)};
}
async function cli(){
  const[command,destination]=process.argv.slice(2);
  if(command==='inventory'){
    if(!destination)throw Error('inventory requires an explicit output file');
    const inventory=collectFormUi();fs.mkdirSync(path.dirname(path.resolve(destination)),{recursive:true});fs.writeFileSync(path.resolve(destination),JSON.stringify(inventory,null,2)+'\n');console.log(JSON.stringify({file:path.resolve(destination),sourceCatalogHash:inventory.sourceCatalogHash,parentSourceCatalogHash:inventory.parentSourceCatalogHash,segments:inventory.segmentCount,characters:inventory.sourceCharacterCount,scripts:inventory.scripts.length}));
  }else if(command==='validate'){
    const{validateEntry}=await import('./site-i18n.mjs');const c=JSON.parse(fs.readFileSync(path.join(ROOT,'content/i18n/form-ui-source.json'))),data=JSON.parse(fs.readFileSync(path.resolve(destination),'utf8'));const r=validateFormUiLocale(c,data,validateEntry,{allowPartial:process.argv.includes('--allow-partial')});console.log(JSON.stringify({...r,missing:r.missing.length}));
  }else throw Error('Usage: node scripts/form-ui-i18n.mjs inventory OUTPUT.json | validate UI_LOCALE.json [--allow-partial]');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await cli();
