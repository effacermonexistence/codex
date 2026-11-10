import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const ROUTES=new Set(['/','/exist','/exist-fr']);
const MARK='<!--effacer-fullfield-receipt:';
export function fullfieldConfig(root){
 const dir=path.join(root,'content/home-fullfield'),c=JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8'));
 if(c.schemaVersion!==1||c.version!=='home-fullfield-marble-v1'||Object.keys(c.sources).sort().join(',')!=='archive,axiom,entity,large,small,woman')throw Error('fullfield: exact approved six-source scope required');
 for(const[role,v]of Object.entries(c.sources)){
  if(!/^[a-f0-9]{64}$/.test(v.sourceSha256)||v.file!==`fullfield-${role}-${v.sourceSha256.slice(0,12)}${path.extname(v.file)}`||!/^\.(png|jpg)$/.test(path.extname(v.file))||v.url!=='/s/'+v.file)throw Error('fullfield: source identity '+role);
  if(!Array.isArray(v.center)||v.center.length!==2||!v.center.every(Number.isFinite)||!v.center.some(n=>n<0||n>1)||!(v.rate>0&&v.rate<=2))throw Error('fullfield: convergence/rate '+role);
  if(sha(fs.readFileSync(path.join(dir,v.file)))!==v.sourceSha256)throw Error('fullfield: source bytes changed '+role);
 }
 const runtime=fs.readFileSync(path.join(dir,'runtime.js')),css=fs.readFileSync(path.join(dir,'style.css'),'utf8');
 return{...c,runtime,css,runtimeAsset:'/s/home-fullfield-'+sha(runtime).slice(0,12)+'.js'};
}
export function addHomeFullfield(html,root,route){
 if(!ROUTES.has(route))return html;
 if(html.includes(MARK)||html.includes('id="effacer-fullfield-style"'))throw Error('fullfield: duplicate adoption');
 const c=fullfieldConfig(root);
 const oldScripts=html.match(/<script id="effacer-home-(?:circles|artwork)-runtime"[^>]*><\/script>\n/g)||[];
 if(oldScripts.length!==2)throw Error('fullfield: prior two runtimes required for checked migration');
 for(const s of oldScripts)html=html.replace(s,'<!--effacer-fullfield-paused:'+Buffer.from(s).toString('base64')+'-->');
 const style='<style id="effacer-fullfield-style">'+c.css+'</style>\n';
 const config='<script id="effacer-fullfield-config" data-i18n-ignore>window.FULLFIELD_SOURCES='+JSON.stringify(c.sources).replace(/</g,'\\u003c')+';</script>\n';
 const runtime='<script id="effacer-fullfield-runtime" src="'+c.runtimeAsset+'" defer></script>\n';
 const receipt=Buffer.from(JSON.stringify({route,style,config,runtime,sourceHashes:Object.fromEntries(Object.entries(c.sources).map(([k,v])=>[k,v.sourceSha256]))})).toString('base64');
 return html.replace('</head>',MARK+receipt+'-->\n'+style+'</head>').replace('</body>',config+runtime+'</body>');
}
export function removeHomeFullfield(html){
 if(!html.includes(MARK))return html;
 const matches=[...html.matchAll(/<!--effacer-fullfield-receipt:([A-Za-z0-9+/=]+)-->\n/g)];if(matches.length!==1)throw Error('fullfield: receipt missing/duplicate');
 const r=JSON.parse(Buffer.from(matches[0][1],'base64').toString('utf8'));if(!ROUTES.has(r.route))throw Error('fullfield: receipt scope');
 for(const s of[r.style,r.config,r.runtime]){if(!s||html.split(s).length!==2)throw Error('fullfield: adopted surface changed');html=html.replace(s,'');}
 html=html.replace(matches[0][0],'');let restored=0;
 html=html.replace(/<!--effacer-fullfield-paused:([A-Za-z0-9+/=]+)-->/g,(_,b)=>{const s=Buffer.from(b,'base64').toString('utf8');if(!/^<script id="effacer-home-(circles|artwork)-runtime"/.test(s))throw Error('fullfield: paused runtime scope');restored++;return s;});
 if(restored!==2)throw Error('fullfield: paused runtime receipt count');return html;
}
export function copyHomeFullfieldMedia(root,out){const c=fullfieldConfig(root);fs.mkdirSync(path.join(out,'s'),{recursive:true});for(const v of Object.values(c.sources))fs.copyFileSync(path.join(root,'content/home-fullfield',v.file),path.join(out,'s',v.file));fs.writeFileSync(path.join(out,c.runtimeAsset.slice(1)),c.runtime);}
