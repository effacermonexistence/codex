(()=>{'use strict';
 const BLOCK='block-61b1bd79481c34f2f1bb',FORM='/api/form/SaveFormSubmission',MAX_FILES=3,MAX_BYTES=25*1024*1024;
 const session=crypto.randomUUID(),entries=[],allow=/\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?|mp4|m4v|mov|webm)$/i;
 let message='';
 function list(){const mount=document.getElementById('apply-upload-v1');if(!mount)return;
  const ul=mount.querySelector('.apply-upload-list'),error=mount.querySelector('.apply-upload-error');ul.replaceChildren();error.textContent=message;
  for(const e of entries){const row=document.createElement('li'),name=document.createElement('span'),state=document.createElement('span'),remove=document.createElement('button');
   row.className='apply-upload-item';name.className='apply-upload-item-name';state.className='apply-upload-item-state';
   name.textContent=e.name;state.textContent=e.state==='ready'?'Added':e.state==='error'?'Failed':e.state==='deleting'?'Removing':'Uploading';
   remove.type='button';remove.className='apply-upload-remove';remove.textContent='Remove';remove.disabled=e.state==='pending'||e.state==='deleting';
   remove.addEventListener('click',()=>drop(e));row.append(name,state,remove);ul.append(row)}
 }
 function readJSON(response){return response.json().catch(()=>({}))}
 async function drop(entry){
  if(entry.state==='ready'){entry.state='deleting';list();try{
    const r=await fetch('/api/apply/file/'+entry.id,{method:'DELETE',credentials:'same-origin',headers:{'X-Apply-Upload-Session':session}});
    if(!r.ok)throw Error('remove_failed')
   }catch{entry.state='ready';message='Could not remove this file. Please try again';list();return}}
  entries.splice(entries.indexOf(entry),1);message='';list();
 }
 async function upload(file,entry){
  try{const r=await fetch('/api/apply/upload',{method:'POST',credentials:'same-origin',signal:AbortSignal.timeout(180000),headers:{'Content-Type':file.type||'application/octet-stream','X-Apply-Filename':encodeURIComponent(file.name),'X-Apply-Upload-Session':session},body:file});
   const data=await readJSON(r);if(!r.ok||!data.id)throw Error(data.error||'Upload failed');
   entry.id=data.id;entry.state='ready';message='';
  }catch(err){entry.state='error';message='This file could not be added. Please choose it again'}
  list();
 }
 function selected(event){
  const files=[...event.target.files];event.target.value='';
  if(!files.length)return;
  if(entries.length+files.length>MAX_FILES){message='Choose up to 3 files';list();return}
  for(const file of files){if(!allow.test(file.name)){message='Choose an image or video file';continue}
   if(file.size>MAX_BYTES){message='Each file must be 25 MB or less';continue}
   const entry={name:file.name,state:'pending',id:null};entries.push(entry);upload(file,entry)}
  list();
 }
 function mount(){
  const block=document.getElementById(BLOCK),form=block?.querySelector('form.react-form-contents'),fields=form?.querySelector('.field-list');
  if(!fields||document.getElementById('apply-upload-v1'))return;
  const wrap=document.createElement('div');wrap.id='apply-upload-v1';wrap.className='form-item field';
  wrap.innerHTML='<label class="apply-upload-title" for="apply-upload-input">Images or video</label><label class="apply-upload-chooser" for="apply-upload-input"><span class="apply-upload-plus" aria-hidden="true">+</span><span>Choose files</span><input id="apply-upload-input" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.avif,.tif,.tiff,.mp4,.m4v,.mov,.webm"></label><small class="apply-upload-note">Up to 3 files · 25 MB each</small><ul class="apply-upload-list" aria-live="polite"></ul><div class="apply-upload-error" role="alert"></div>';
  fields.appendChild(wrap);wrap.querySelector('input').addEventListener('change',selected);list();
  if(!form.__applyUploadGuard){form.__applyUploadGuard=true;form.addEventListener('submit',event=>{if(entries.some(x=>x.state!=='ready')){event.preventDefault();event.stopImmediatePropagation();message='Wait for uploads to finish or choose failed files again';list()}},true)}
 }
 const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
 XMLHttpRequest.prototype.open=function(method,url,...rest){try{const u=new URL(url,location.href);this.__applyUploadSubmit=method.toUpperCase()==='POST'&&u.origin===location.origin&&u.pathname===FORM}catch{this.__applyUploadSubmit=false}return open.call(this,method,url,...rest)};
 XMLHttpRequest.prototype.send=function(body){if(this.__applyUploadSubmit&&entries.some(x=>x.state==='ready')){
   try{if(typeof body!=='string')throw Error('unexpected_body');const value=JSON.parse(body);value.applyUploadIds=entries.filter(x=>x.state==='ready').map(x=>x.id);value.applyUploadSession=session;body=JSON.stringify(value);this.addEventListener('load',()=>{if(this.status>=200&&this.status<300){entries.splice(0);message='';list()}},{once:true})}
   catch{message='Could not attach the files';list();throw Error('Attachment metadata could not be added')}}
  return send.call(this,body)};
 const observer=new MutationObserver(mount);function start(){mount();const block=document.getElementById(BLOCK);if(block)observer.observe(block,{childList:true,subtree:true})}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
