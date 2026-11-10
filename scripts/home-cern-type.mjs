import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const MARK = '<!--effacer-home-cern-type:';
const END = '<!--effacer-home-cern-type-end-->';
export const HOME_CERN_ROUTES = new Set(['/','/exist','/exist-fr']);
export function homeCernAssets(root) {
  const dir = path.join(root,'content/home-cern-typography');
  const manifest = JSON.parse(fs.readFileSync(dir+'/font-manifest.json','utf8'));
  if (manifest.family !== 'Gilda Display' || manifest.localAlias !== 'Effacer CERN' || manifest.faces.length !== 2) throw Error('home-cern: canonical CERN family required');
  for (const face of manifest.faces) {
    if (!/^home-gilda-[a-f0-9]{16}\.woff2$/.test(face.file)) throw Error('home-cern: unsafe font name');
    const b=fs.readFileSync(dir+'/'+face.file);
    if(b.length!==face.bytes || sha(b)!==face.sha256) throw Error('home-cern: font source changed');
  }
  const css=fs.readFileSync(dir+'/fonts.css','utf8')+'\n'+fs.readFileSync(dir+'/policy.css','utf8');
  return {dir,manifest,css,asset:'/s/home-cern-type-'+sha(css).slice(0,16)+'.css'};
}
export function addHomeCernType(html,root,route) {
  if (!HOME_CERN_ROUTES.has(route)) return html;
  if(html.includes(MARK)||html.includes('data-home-cern-type='))throw Error('home-cern: duplicate adoption');
  const bodies=[...html.matchAll(/<body\b[^>]*>/g)];
  if(bodies.length!==1||html.split('</head>').length!==2)throw Error('home-cern: one document required');
  const a=homeCernAssets(root),oldBody=bodies[0][0],newBody=oldBody.replace('<body','<body data-home-cern-type="1"');
  const surface='<link id="home-cern-type-policy" rel="stylesheet" href="'+a.asset+'">\n';
  const receipt={version:1,route,oldBody,newBody,surfaceSha256:sha(surface),priorHtmlSha256:sha(html)};
  return html.replace(oldBody,newBody).replace('</head>',MARK+Buffer.from(JSON.stringify(receipt)).toString('base64')+'-->'+surface+END+'\n</head>');
}
export function removeHomeCernType(html) {
  if(!html.includes(MARK)){if(html.includes('data-home-cern-type='))throw Error('home-cern: orphan body');return html;}
  const m=[...html.matchAll(/<!--effacer-home-cern-type:([A-Za-z0-9+/=]+)-->([\s\S]*?)<!--effacer-home-cern-type-end-->\n/g)];
  if(m.length!==1)throw Error('home-cern: one receipt required');
  const r=JSON.parse(Buffer.from(m[0][1],'base64').toString());
  if(r.version!==1||!HOME_CERN_ROUTES.has(r.route)||sha(m[0][2])!==r.surfaceSha256||html.split(r.newBody).length!==2)throw Error('home-cern: altered adopted surface');
  const original=html.replace(m[0][0],'').replace(r.newBody,r.oldBody);
  if(sha(original)!==r.priorHtmlSha256)throw Error('home-cern: original identity changed');
  return original;
}
export function copyHomeCernType(root,out) {
  const a=homeCernAssets(root);
  fs.mkdirSync(out+'/s',{recursive:true});
  fs.writeFileSync(path.join(out,a.asset.slice(1)),a.css);
  for(const f of a.manifest.faces)fs.copyFileSync(a.dir+'/'+f.file,out+'/s/'+f.file);
  fs.copyFileSync(a.dir+'/OFL.txt',out+'/s/home-cern-type-OFL.txt');
  return a.asset;
}
