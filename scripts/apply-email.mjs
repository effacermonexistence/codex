import fs from 'node:fs';
import path from 'node:path';
const EXPECTED_OPTIONAL_IDS=['text-yui_3_17_2_1_1663856203892_2072'];
const EXPECTED_REQUIRED_IDS=['text-a918a092-a73a-4662-9211-a624cda69ae7','phone-21d0e5c2-e9f5-410c-b807-d6926d40cce9','text-a468a4dc-03d5-4186-8e9e-73a82ce9c8b0'];
export function addApplyEmail(html,root,route){
 if(route!=='/apply')return html;
 const c=JSON.parse(fs.readFileSync(path.join(root,'content/apply-email/config.json'),'utf8'));
 if(c.version!=='apply-email-v4-time-optional'||c.field.required!==true||c.optionalFieldIds.join(',')!==EXPECTED_OPTIONAL_IDS.join(','))throw Error('Apply: locked form contract');
 const matches=[...html.matchAll(/<script\b([^>]*?)>([\s\S]*?)<\/script>/gi)].filter(m=>m[1].includes(`id="${c.contextScriptId}"`));
 if(matches.length!==1)throw Error('Apply: expected exact form context');
 const match=matches[0],data=JSON.parse(match[2]);
 if(data.formId!==c.formId||!Array.isArray(data.formFields))throw Error('Apply: native form identity');
 const fields=data.formFields,found=fields.filter(f=>f.id===c.field.id);
 if(found.length>1)throw Error('Apply: duplicate Email');
 if(found.length===0){const after=fields.findIndex(f=>f.id===c.afterFieldId),before=fields.findIndex(f=>f.id===c.beforeFieldId);if(after<0||before!==after+1)throw Error('Apply: Email placement anchors');fields.splice(before,0,c.field)}
 else{const at=fields.indexOf(found[0]);if(JSON.stringify(found[0])!==JSON.stringify(c.field)||fields[at-1]?.id!==c.afterFieldId||fields[at+1]?.id!==c.beforeFieldId)throw Error('Apply: Email identity/order conflict')}
 const ids=fields.map(f=>f.id);if(new Set(ids).size!==ids.length||c.optionalFieldIds.some(id=>!ids.includes(id)))throw Error('Apply: optional field identity');
 for(const f of fields){if(f.id===c.field.id||EXPECTED_REQUIRED_IDS.includes(f.id))f.required=true;else if(c.optionalFieldIds.includes(f.id)||f.id===c.messageFieldId)f.required=false;else throw Error('Apply: unexpected form field '+f.id)}
 const next=JSON.stringify(data).replace(/</g,'\\u003c');const offset=match.index+match[0].indexOf('>')+1;
 html=html.slice(0,offset)+next+html.slice(offset+match[2].length);
 const guardId='apply-email-required-v4';
 const guard=`<script id="${guardId}">(()=>{const formId=${JSON.stringify(c.formId)},emailId=${JSON.stringify(c.field.id)},optional=${JSON.stringify(c.optionalFieldIds)},required=${JSON.stringify(EXPECTED_REQUIRED_IDS)};function mount(){const block=document.getElementById('block-61b1bd79481c34f2f1bb');if(!block)return;function sync(){const source=block.querySelector('script.sqs-form-block-context');if(source){try{const ctx=JSON.parse(source.textContent);if(ctx.formId!==formId)return null}catch{return null}}for(const id of optional){const input=block.querySelector('[id="'+id+'-field"], [id="'+id+'-input-field"]');if(input){input.required=false;input.setAttribute('aria-required','false')}}for(const id of required){const input=block.querySelector('[id="'+id+'-field"], [id="'+id+'-input-field"]');if(input){input.required=true;input.setAttribute('aria-required','true')}}const input=block.querySelector('[id="'+emailId+'-field"]');if(input){input.required=true;input.setAttribute('aria-required','true');input.autocomplete='email';input.inputMode='email'}return input}sync();new MutationObserver(sync).observe(block,{childList:true,subtree:true});block.addEventListener('submit',event=>{const input=sync();if(input&&!input.checkValidity()){event.preventDefault();event.stopImmediatePropagation();input.reportValidity()}},true)}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount()})();</script>`;
 if(html.includes('id="apply-email-required-v2"')||html.includes('id="apply-email-required-v3"')||html.includes('id="'+guardId+'"'))throw Error('Apply: old or duplicate guard');
 if(html.split('</body>').length!==2)throw Error('Apply: one body');return html.replace('</body>',guard+'\n</body>');
}
