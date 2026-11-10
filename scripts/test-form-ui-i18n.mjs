import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractFormUi,collectFormUi,localizeFormUi,validateFormUiLocale} from './form-ui-i18n.mjs';
import {validateEntry} from './site-i18n.mjs';
const root=new URL('../',import.meta.url),catalog=JSON.parse(fs.readFileSync(new URL('../content/i18n/form-ui-source.json',import.meta.url)));
const entries=Object.fromEntries(catalog.segments.map(s=>[s.id,'SYNTHETIC '+s.source]));
const locale={schemaVersion:1,kind:'form-ui-sidecar',locale:'ko',sourceCatalogHash:catalog.sourceCatalogHash,parentSourceCatalogHash:catalog.parentSourceCatalogHash,entries};
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const set=(obj,bits,value)=>{let target=obj;for(const k of bits.slice(0,-1))target=target[k];target[bits.at(-1)]=value;};
test('source inventory is current, exact, independently frozen from main',()=>{
 const fresh=collectFormUi(new URL('../',import.meta.url).pathname);
 assert.equal(fresh.sourceCatalogHash,catalog.sourceCatalogHash);assert.equal(fresh.parentSourceCatalogHash,'b333c12ae049758c9d70c2b8a3867354cd59717816579efb8bdda75efc3acfaf');
 assert.equal(catalog.segmentCount,327);assert.equal(catalog.scripts.length,4);
 assert.equal(validateFormUiLocale(catalog,locale,validateEntry).complete,true);
});
test('missing UI data is atomic and cannot masquerade as translated form UI',()=>{
 const html=fs.readFileSync(new URL('../site/pages/apply.html',import.meta.url),'utf8');
 const missing=localizeFormUi(html,'/apply','ko',catalog,{},validateEntry);
 assert.equal(missing.html,html);assert.equal(missing.status,'unavailable');assert(missing.missing.length>0);assert.equal(missing.translated,0);
 const english=localizeFormUi(html,'/apply','en',catalog,entries,validateEntry);assert.equal(english.html,html);assert.equal(english.status,'original');
});
test('only allowlisted form UI values change; IDs/config/submission values remain identical',()=>{
 for(const route of ['/apply','/contact']){
  const html=fs.readFileSync(new URL('../site/pages/'+route.slice(1)+'.html',import.meta.url),'utf8'),before=extractFormUi(html,route);
  const result=localizeFormUi(html,route,'ko',catalog,entries,validateEntry);assert.equal(result.status,'translated');
  const after=extractFormUi(result.html,route);assert.equal(before.length,after.length);
  for(let i=0;i<before.length;i++){
   const a=structuredClone(before[i].data),b=structuredClone(after[i].data);
   for(const slot of before[i].slots){set(a,slot.bits,'UI-REMOVED');set(b,slot.bits,'UI-REMOVED');}
   if(a.formSubmitButtonText===''){a.formSubmitButtonText='UI-DEFAULT-ALIAS';b.formSubmitButtonText='UI-DEFAULT-ALIAS';}
   assert.deepEqual(b,a,'non-UI data mutated in '+before[i].id);
  }
  let strippedBefore=html,strippedAfter=result.html.replace(result.displayScript,'');
  const afterWithoutDisplay=extractFormUi(strippedAfter,route);
  for(const s of [...before].reverse())strippedBefore=strippedBefore.slice(0,s.start)+s.open+'UI-BODY'+ '</script>'+strippedBefore.slice(s.end);
  for(const s of [...afterWithoutDisplay].reverse())strippedAfter=strippedAfter.slice(0,s.start)+s.open+'UI-BODY'+'</script>'+strippedAfter.slice(s.end);
  assert.equal(strippedAfter,strippedBefore,'non-form scripts/markup changed');
 }
});
test('plain JSON text is not HTML-escaped; source HTML is preserved and text safely escaped',()=>{
 const html=fs.readFileSync(new URL('../site/pages/apply.html',import.meta.url),'utf8');
 const country=catalog.segments.find(s=>s.occurrences.some(o=>o.pointer==='/formFieldFormats/countries/0/name'));
 const htmlEntry=catalog.segments.find(s=>s.kind==='html'&&s.protected.some(p=>p.kind==='markup'));
 const custom={...entries,[country.id]:'SYNTHETIC & COUNTRY',[htmlEntry.id]:'SYNTHETIC & '+htmlEntry.source};
 const result=localizeFormUi(html,'/apply','ko',catalog,custom,validateEntry);const scripts=extractFormUi(result.html,'/apply');
 assert.equal(scripts.find(s=>!s.id.includes('localized-strings')).data.formFieldFormats.countries[0].name,'SYNTHETIC & COUNTRY');
 const ui=scripts.find(s=>s.id.includes('localized-strings')).data.noStorageConnectedMessage;
 assert(ui.includes('SYNTHETIC &amp;'));assert(ui.includes('<strong>Storage</strong>'));
});
test('parameter/number/markup tokens and catalog lineage are hard gates',()=>{
 const parameter=catalog.segments.find(s=>s.protected.some(p=>p.value==='{0}'));
 assert.throws(()=>validateEntry(parameter,entries[parameter.id].replace(parameter.protected[0].token,'')),/protected tokens/);
 assert.throws(()=>validateFormUiLocale(catalog,{...locale,parentSourceCatalogHash:'stale'},validateEntry),/lineage/);
 assert.throws(()=>validateFormUiLocale(catalog,{...locale,locale:'xx'},validateEntry),/schema/);
 assert.throws(()=>validateFormUiLocale(catalog,{...locale,entries:{...entries,ui_unknown:'text'}},validateEntry),/unknown segment/);
  assert.throws(()=>validateFormUiLocale(catalog,{...locale,entries:Object.fromEntries(catalog.segments.map(s=>[s.id,s.source]))},validateEntry),/untranslated source copy/);
});
test('unregistered script or newly introduced UI pointer cannot widen the adapter',()=>{
 const html=fs.readFileSync(new URL('../site/pages/apply.html',import.meta.url),'utf8');
 const unknown=html.replace('id="form-context-68656582e759892761381cba"','id="form-context-unregistered"');
 const result=localizeFormUi(unknown,'/apply','ko',catalog,entries,validateEntry);assert.equal(result.status,'unavailable');assert.equal(result.html,unknown);
 const original=extractFormUi(html,'/apply'),dictionary=original.find(s=>s.id.includes('localized-strings'));
 const withoutDictionary=html.slice(0,dictionary.start)+html.slice(dictionary.end);
 assert.equal(localizeFormUi(withoutDictionary,'/apply','ko',catalog,entries,validateEntry).status,'unavailable');
 const scripts=extractFormUi(html,'/apply'),context=scripts.find(s=>!s.id.includes('localized-strings'));
 context.data.formFields.push({id:'untouched-new-id',type:'text',title:'Name'});
 const newHtml=html.slice(0,context.start)+context.open+JSON.stringify(context.data)+'</script>'+html.slice(context.end);
 const pending=localizeFormUi(newHtml,'/apply','ko',catalog,entries,validateEntry);assert.equal(pending.status,'unavailable');assert.equal(pending.html,newHtml);
});
console.log(`${passed} bounded form UI tests passed using in-memory synthetic entries only; no submissions, providers, locale writes, build or deployment.`);
