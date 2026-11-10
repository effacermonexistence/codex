import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const ROUTES=new Set(['/','/exist','/exist-fr']);
const MARK='<!--home-cern-layout-receipt:';
const END='<!--home-cern-layout-receipt-end-->';
export function homeCernLayoutAssets(root) {
 const dir=path.join(root,'content/home-cern-layout'),config=JSON.parse(fs.readFileSync(dir+'/layout.json','utf8')),css=fs.readFileSync(dir+'/policy.css','utf8');
 if(config.version!==2||config.routes.length!==3||new Set(config.routes.map(x=>x.route)).size!==3)throw Error('CERN layout: scope');
 for(const route of config.routes)if(!ROUTES.has(route.route)||route.sections.length!==8||route.panelCount!==9||!route.protectedLanding||!/^[a-f0-9]{24}$/.test(route.protectedLanding.sectionId)||route.sections.some(s=>s.sectionId===route.protectedLanding.sectionId))throw Error('CERN layout: source shape');
 return{dir,config,css,asset:'/s/home-cern-layout-'+sha(css).slice(0,16)+'.css'};
}
export function addHomeCernLayout(html,root,route) {
 if(!ROUTES.has(route))return html;
 if(html.includes(MARK)||html.includes('data-home-cern-layout='))throw Error('CERN layout: duplicate');
 const a=homeCernLayoutAssets(root),source=a.config.routes.find(x=>x.route===route),prior=sha(html),edits=[];
 const main=/<main\b[^>]*>[\s\S]*?<\/main>/.exec(html),first=main&&/<section\b[^>]*data-section-id="([^"]+)"/.exec(main[0]);
 if(!first||first[1]!==source.protectedLanding.sectionId)throw Error('CERN layout: protected first section identity');
 const bodies=[...html.matchAll(/<body\b[^>]*>/g)];if(bodies.length!==1)throw Error('CERN layout: one body');
 const oldBody=bodies[0][0],newBody=oldBody.replace('<body','<body data-home-cern-layout="1"');html=html.replace(oldBody,newBody);
 // Protected first landing must remain outside every applied edit and selector.
 if(source.sections.some(s=>s.sectionId===source.protectedLanding.sectionId))throw Error('CERN layout: protected landing targeted');
 for(const section of source.sections) {
  if(!/^[a-f0-9]{24}$/.test(section.sectionId))throw Error('CERN layout: section ID');
  const pattern=new RegExp('<section\\b[^>]*data-section-id="'+section.sectionId+'"[^>]*>','g'),matches=[...html.matchAll(pattern)];if(matches.length!==1)throw Error('CERN layout: exact section '+section.sectionId);
  const m=matches[0],end=html.indexOf('</section>',m.index+m[0].length);if(end<0)throw Error('CERN layout: close');
  let block=html.slice(m.index,end);const content=[...block.matchAll(/<div\s+class="content"\s*>/g)];if(content.length!==1)throw Error('CERN layout: content anchor '+section.sectionId);
  // Validate source coverage and cardinality, not merely substring presence.
  const sourcePs=[...block.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/g)].map(x=>x[0]).filter(p=>{const t=p.replace(/<[^>]+>/g,' ').replace(/&(?:nbsp|#160);/g,' ').trim();return t&&!/©|Copyright\. All rights reserved/.test(t)});
  if(sourcePs.length!==section.paragraphCount||sha(sourcePs.join(''))!==section.paragraphSourceHash)throw Error('CERN layout: source paragraph count/hash mismatch '+section.sectionId);
  // Every displayed paragraph must still occur in its exact original section.
  for(const panel of section.panels)for(const p of panel.sourceParagraphs)if(!block.includes(p))throw Error('CERN layout: source paragraph changed');
  const oldOpen=m[0],newOpen=oldOpen.replace('<section','<section data-home-cern-layout-section="'+section.sectionId+'"');
  const surface='<!--home-cern-editorial:'+section.sectionId+'-->'+section.fragment+'<!--home-cern-editorial-end:'+section.sectionId+'-->';
  block=block.replace(oldOpen,newOpen).replace(content[0][0],content[0][0]+surface);html=html.slice(0,m.index)+block+html.slice(end);
  edits.push({id:section.sectionId,oldOpen,newOpen,surfaceSha256:sha(surface)});
 }
 const link='<link id="home-cern-layout-policy" rel="stylesheet" href="'+a.asset+'">\n',r={version:1,route,priorHtmlSha256:prior,oldBody,newBody,edits,linkSha256:sha(link)};
 return html.replace('</head>',MARK+Buffer.from(JSON.stringify(r)).toString('base64')+'-->'+link+END+'\n</head>');
}
export function removeHomeCernLayout(html) {
 if(!html.includes(MARK))return html;
 const m=[...html.matchAll(/<!--home-cern-layout-receipt:([A-Za-z0-9+/=]+)-->([\s\S]*?)<!--home-cern-layout-receipt-end-->\n/g)];if(m.length!==1)throw Error('CERN layout: receipt');
 const r=JSON.parse(Buffer.from(m[0][1],'base64').toString());if(r.version!==1||!ROUTES.has(r.route)||sha(m[0][2])!==r.linkSha256)throw Error('CERN layout: identity');
 for(const e of r.edits){const re=new RegExp('<!--home-cern-editorial:'+e.id+'-->[\\s\\S]*?<!--home-cern-editorial-end:'+e.id+'-->','g'),s=[...html.matchAll(re)];if(s.length!==1||sha(s[0][0])!==e.surfaceSha256||html.split(e.newOpen).length!==2)throw Error('CERN layout: altered surface');html=html.replace(s[0][0],'').replace(e.newOpen,e.oldOpen);}
 html=html.replace(m[0][0],'').replace(r.newBody,r.oldBody);if(sha(html)!==r.priorHtmlSha256)throw Error('CERN layout: original changed');return html;
}
export function copyHomeCernLayout(root,out){const a=homeCernLayoutAssets(root);fs.mkdirSync(out+'/s',{recursive:true});fs.writeFileSync(path.join(out,a.asset.slice(1)),a.css);return a.asset;}
