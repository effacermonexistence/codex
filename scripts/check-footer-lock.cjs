'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),lock=JSON.parse(fs.readFileSync(path.join(root,'content/site-footer/LOCK.json')));
if(lock.schemaVersion!==1||lock.files.length!==3)throw Error('Footer lock identity');
for(const file of lock.files){const got=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file.path))).digest('hex');if(got!==file.sha256)throw Error('Frozen footer changed: '+file.path+'. A new explicit owner footer request is required.');}
const shell='<html><head></head><body><main></main><footer class="sections" id="footer-sections"></footer></body></html>';
const frozen=require('./site-shared-footer.cjs').withSharedFooter(shell,'/404',root);
for(const policy of [require('./body-wordmarks.cjs').bodyWordmarks(root),require('./site-typography.cjs').siteTypography(root),require('./text-veil.cjs').textVeil(root)]){
 if(policy.render(frozen,'/404')!==frozen)throw Error('Global page policy changed the frozen footer.');
}
const css=fs.readFileSync(path.join(root,'content/body-wordmarks/style.css'),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
 const visual=rule[2].split(';').some(p=>p.includes(':')&&!p.trim().startsWith('--'));
 if(visual&&!rule[1].includes('html body main'))throw Error('Body-logo visual styles must remain inside main.');
}
console.log('Approved footer files unchanged.');
