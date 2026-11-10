'use strict';
const config=require('../content/apply-email/config.json');
class ApplyEmailValidationError extends Error {
  constructor(){super('Invalid email');this.status=400;this.body={errors:{[config.field.id]:'Enter a valid email address'}};}
}
function withApplyEmail(body,contentType='') {
  // Existing forms, captcha keys, consent flags and request metadata stay intact.
  // The upstream form schema is unchanged: carry Email through its native message.
  const type=contentType.split(';')[0].trim().toLowerCase();
  if(type!=='application/json'&&type!=='application/x-www-form-urlencoded')return body;
  let outer;
  try{outer=type==='application/json'?JSON.parse(body.toString('utf8')):Object.fromEntries(new URLSearchParams(body.toString('utf8')));}catch{return body;}
  if(!outer||outer.formId!==config.formId||typeof outer.form!=='string')return body;
  let form;try{form=JSON.parse(outer.form);}catch{return body;}
  if(!form||Array.isArray(form)||typeof form!=='object')return body;
  if(!Object.hasOwn(form,config.field.id)){
    if(config.field.required)throw new ApplyEmailValidationError();
    return body;
  }
  const submitted=form[config.field.id];
  // Native legacy forms send a string; the current React form sends emailAddress.
  const raw=submitted&&typeof submitted==='object'&&!Array.isArray(submitted)?submitted.emailAddress:submitted;
  if(typeof raw!=='string')throw new ApplyEmailValidationError();
  const email=raw.trim();
  if(config.field.required&&!email)throw new ApplyEmailValidationError();
  if(email&&(email.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)))throw new ApplyEmailValidationError();
  const message=form[config.messageFieldId];
  if(message!==undefined&&message!==null&&typeof message!=='string')throw new ApplyEmailValidationError();
  if(email)form[config.messageFieldId]=(message?message+'\n\n':'')+'Email: '+email;
  delete form[config.field.id];
  outer.form=JSON.stringify(form);
  return Buffer.from(type==='application/json'?JSON.stringify(outer):new URLSearchParams(outer).toString());
}
module.exports={withApplyEmail,ApplyEmailValidationError};
