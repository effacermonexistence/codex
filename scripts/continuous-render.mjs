import {copyTattooMotion} from './tattoo-motion.mjs';
// Native tattoo catalogue. Public12-only authority; no Instagram runtime/DM access.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const CONTINUOUS_RENDER_ROUTE='/continuous-render';
export const CONTINUOUS_HOME_ROUTES=new Set(['/','/exist','/exist-fr']);
const MARK='<!--effacer-continuous-cta:';
export function readContinuousWorks(root){
 const d=JSON.parse(fs.readFileSync(path.join(root,'content/continuous-render/works.json'),'utf8'));
 if(d.schemaVersion!==1||d.works.length!==12)throw Error('Continuous Render: approved public12 identity changed');
 const seen=new Set();
 for(const [i,w]of d.works.entries()){
  if(w.route!=='/continuous-render-'+String(i+1).padStart(3,'0')||seen.has(w.route)||!/^continuous-[a-f0-9]{16}\.jpg$/.test(w.image.file)||w.image.url!=='/s/'+w.image.file)throw Error('Continuous Render: route/asset identity');
  seen.add(w.route);const b=fs.readFileSync(path.join(root,'content/continuous-render/images',w.image.file));
  if(sha(b)!==w.image.sha256||!/^\d{4}-\d{2}-\d{2}$/.test(w.published)||!/^https:\/\/www\.instagram\.com\/effacermonexistence\/p\/[A-Za-z0-9_-]+\/$/.test(w.sourcePost))throw Error('Continuous Render: source identity');
 }
 return d;
}
export function continuousRoutes(root){return [CONTINUOUS_RENDER_ROUTE,...readContinuousWorks(root).works.map(w=>w.route)]}
export function addContinuousCta(html,route){
 if(!CONTINUOUS_HOME_ROUTES.has(route))return html;
 if(html.includes(MARK))throw Error('Continuous Render: duplicate CTA adoption');
 const matches=[...html.matchAll(/<a\b[^>]*href="https:\/\/www\.instagram\.com\/effacermonexistence\/"[^>]*>\s*(?:Continuous Render|Rendu Continu)\s*<\/a>/g)];
 if(matches.length!==1)throw Error('Continuous Render: exact homepage CTA missing/duplicate');
 const original=matches[0][0],adopted=original.replace('https://www.instagram.com/effacermonexistence/','/continuous-render').replace(/\s+target="_blank"/,'');
 const receipt=Buffer.from(JSON.stringify({route,original,adoptedSha256:sha(adopted)})).toString('base64');
 return html.replace(original,MARK+receipt+'-->'+adopted+'<!--effacer-continuous-cta-end-->');
}
export function removeContinuousCta(html){
 if(!html.includes(MARK))return html;
 const matches=[...html.matchAll(/<!--effacer-continuous-cta:([A-Za-z0-9+/=]+)-->([\s\S]*?)<!--effacer-continuous-cta-end-->/g)];
 if(matches.length!==1)throw Error('Continuous Render: receipt count');
 const r=JSON.parse(Buffer.from(matches[0][1],'base64').toString('utf8'));
 if(!CONTINUOUS_HOME_ROUTES.has(r.route)||sha(matches[0][2])!==r.adoptedSha256)throw Error('Continuous Render: CTA changed after adoption');
 return html.replace(matches[0][0],r.original);
}
const css=`<style id="continuous-render-v1">.cr-page{padding:155px 6vw 100px;background:#000;color:#f3f1ed;font-family:'PT Serif',Georgia,serif;line-height:1.75}.cr-page *{box-sizing:border-box}.cr-page h1,.cr-page h2,.cr-page h3{color:inherit!important;font-weight:400}.cr-page a{color:inherit;text-decoration:none;background-image:none}.cr-page a:focus-visible{outline:1px solid #eee;outline-offset:10px}.cr-intro{text-align:center;max-width:1000px;margin:0 auto 100px}.cr-intro h1{font:400 clamp(36px,5.1vw,70px)/1.15 'Gilda Display',Georgia,serif;text-transform:uppercase;margin:30px 0}.cr-eyebrow{font:12px/1.5 Arial,sans-serif;color:#aaa;text-transform:uppercase;letter-spacing:.17em}.cr-intro p{margin:18px 0;font-size:18px}.cr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:88px 38px;max-width:1220px;margin:auto}.cr-card{display:block;min-width:0}.cr-card figure{margin:0}.cr-thumb{aspect-ratio:4/5;display:grid;place-items:center}.cr-thumb img{display:block;width:100%;height:100%;object-fit:contain}.cr-index{display:block;color:#999;font-size:12px;letter-spacing:.1em;margin:25px 0 10px}.cr-card h2{font:400 21px/1.5 'PT Serif',Georgia,serif;margin:0}.cr-card:hover h2{color:#aaa!important}.cr-work{max-width:1280px;margin:auto;display:grid;grid-template-columns:minmax(0,1.2fr)minmax(320px,.8fr);gap:8vw;align-items:start}.cr-work figure{margin:0;display:flex;justify-content:center;align-items:center;min-height:70vh}.cr-work figure img{display:block;max-width:100%;width:auto;height:auto;max-height:85vh;object-fit:contain}.cr-metadata{max-width:460px;font-size:16px;line-height:1.75}.cr-metadata h1{font:400 28px/1.3 'PT Serif',Georgia,serif;margin:0 0 12px}.cr-metadata p{margin:0 0 24px}.cr-subtitle{font-size:22px;line-height:1.5;margin-bottom:40px!important}.cr-description{margin-top:42px!important}.cr-breadcrumb{max-width:1280px;margin:0 auto 60px;color:#aaa;font-size:14px}.cr-bottom{display:flex;justify-content:space-between;gap:25px;max-width:1280px;margin:100px auto 0;font-size:15px;flex-wrap:wrap}.cr-page a:hover{color:#bbb}.cr-footer{text-align:center;padding-top:110px}.cr-footer .sqs-html-content p{text-align:center}.cr-note{max-width:900px;margin:120px auto 0;text-align:center;color:#999;font-size:14px}@media(max-width:1000px){.cr-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.cr-work{gap:5vw}}@media(max-width:650px){.cr-page{padding:120px 24px 70px}.cr-intro{margin-bottom:65px}.cr-intro p{font-size:16px}.cr-grid{grid-template-columns:1fr;max-width:420px;gap:65px}.cr-thumb{max-height:70svh}.cr-work{display:block}.cr-work figure{min-height:0;max-height:none;margin-bottom:55px}.cr-work figure img{max-height:72svh}.cr-metadata{margin:auto}.cr-breadcrumb{margin-bottom:40px}.cr-bottom{margin-top:70px}.cr-note{margin-top:90px}}</style>`;

const viewportCss="<style id=\"continuous-render-viewport-v1\">/* Tattoo imagery only: retain source ratios, typography and all catalogue text. */.cr-page{padding-inline:24px}.cr-grid{grid-template-columns:minmax(0,1fr);max-width:none;gap:80px}.cr-card{width:100%}.cr-thumb{aspect-ratio:auto;height:auto;max-height:none;display:flex;justify-content:center;align-items:center}.cr-thumb img,.cr-work figure img{display:block;width:100%;height:auto;max-width:100%!important;max-height:calc(100svh - 116px);object-fit:contain;object-position:center}.cr-work{display:block;max-width:none}.cr-work figure{width:100%;height:auto;min-height:0;max-height:none;margin:0}.cr-metadata{margin:64px auto 0}@media(max-width:650px){.cr-page{padding-inline:16px}.cr-work figure{margin-bottom:0}.cr-metadata{margin-top:48px}}</style>";

// The index is a sequence of artwork records, not a thumbnail-only menu.
// Reuse the actual detail records: presentation must not invent new metadata.
const CATALOGUE_MARK='<!--effacer-continuous-catalogue:';
const catalogueCss='<style id="continuous-render-catalogue-v2">.cr-catalogue{display:grid;grid-template-columns:minmax(0,1fr);gap:120px}.cr-catalogue-work figure{margin:0}.cr-artwork-link{display:block}.cr-catalogue-work .cr-metadata{margin:64px auto 0}.cr-catalogue-work .cr-metadata h2{font:inherit;font-size:28px;line-height:1.3;margin:0 0 12px}.cr-catalogue-work .cr-metadata h2 a{text-decoration:none}.cr-catalogue-work .cr-metadata a:hover{opacity:.75}@media(max-width:650px){.cr-catalogue{gap:88px}.cr-catalogue-work .cr-metadata{margin-top:48px}}</style>\n';
export function addContinuousCatalogue(html,root,detailPages){
 if(html.includes(CATALOGUE_MARK)||html.includes('id="continuous-render-catalogue-v2"'))throw Error('Continuous catalogue: duplicate adoption');
 const navs=[...html.matchAll(/<nav class="cr-grid" aria-label="Tattoo works">[\s\S]*?<\/nav>/g)];if(navs.length!==1)throw Error('Continuous catalogue: exact index menu required');
 const original=navs[0][0],works=readContinuousWorks(root).works;if((original.match(/class="cr-card"/g)||[]).length!==12)throw Error('Continuous catalogue:12original cards required');
 const records=works.map((w,i)=>{
  if(!original.includes('href="'+w.route+'"')||!original.includes('src="'+w.image.url+'"'))throw Error('Continuous catalogue: index identity '+w.id);
  const detail=detailPages.get(w.route);if(!detail)throw Error('Continuous catalogue: missing authoritative detail '+w.route);
  const found=[...detail.matchAll(/<div class="cr-metadata sqs-html-content">([\s\S]*?)<\/div>/g)];if(found.length!==1)throw Error('Continuous catalogue: metadata shape '+w.id);
  let metadata=found[0][1];for(const label of['Title','Medium','Description'])if(!metadata.includes('<strong>'+label))throw Error('Continuous catalogue: missing '+label+' '+w.id);
  if(!metadata.includes(esc(w.description))||!metadata.includes(esc(w.statement)))throw Error('Continuous catalogue: description provenance '+w.id);
  const title='<h1 translate="no">'+esc(w.catalogId)+'</h1>';if(metadata.split(title).length!==2)throw Error('Continuous catalogue: title identity '+w.id);
  metadata=metadata.replace(title,'<h2 id="'+w.id+'-title" translate="no"><a href="'+w.route+'">'+esc(w.catalogId)+'</a></h2>');
  if(metadata.split('<p class="cr-subtitle">').length!==2)throw Error('Continuous catalogue: subtitle identity '+w.id);
  metadata=metadata.replace('<p class="cr-subtitle">','<p id="'+w.id+'-name" class="cr-subtitle">');
  return '<article class="cr-card cr-catalogue-work" id="'+w.id+'" aria-labelledby="'+w.id+'-title '+w.id+'-name"><figure><a class="cr-artwork-link" href="'+w.route+'" aria-labelledby="'+w.id+'-title '+w.id+'-name"><div class="cr-thumb"><img src="'+w.image.url+'" width="'+w.image.width+'" height="'+w.image.height+'" alt="'+esc(w.title)+' — tattoo in crimson and black" loading="'+(i<3?'eager':'lazy')+'" decoding="async"></div></a></figure><div class="cr-metadata sqs-html-content">'+metadata+'</div></article>';
 }).join('');
 const adopted='<section class="cr-grid cr-catalogue" aria-label="Tattoo works">'+records+'</section>',receipt={version:1,original,adoptedSha256:sha(adopted),style:catalogueCss};
 if(html.split(viewportCss).length!==2)throw Error('Continuous catalogue: owned viewport style anchor required');
 return html.replace(original,CATALOGUE_MARK+Buffer.from(JSON.stringify(receipt)).toString('base64')+'-->'+adopted+'<!--effacer-continuous-catalogue-end-->').replace(viewportCss,viewportCss+catalogueCss);
}
export function removeContinuousCatalogue(html){
 if(!html.includes(CATALOGUE_MARK))return html;const m=[...html.matchAll(/<!--effacer-continuous-catalogue:([A-Za-z0-9+/=]+)-->([\s\S]*?)<!--effacer-continuous-catalogue-end-->/g)];if(m.length!==1)throw Error('Continuous catalogue: receipt count');const r=JSON.parse(Buffer.from(m[0][1],'base64').toString());if(r.version!==1||sha(m[0][2])!==r.adoptedSha256||html.split(r.style).length!==2)throw Error('Continuous catalogue: adopted identity');return html.replace(m[0][0],r.original).replace(r.style,'');
}

export function buildContinuousRender(root,template){
 if(/id="archive-failed-rendering-style"|id="archive-spacing-map"/.test(template))throw Error('Continuous Render: clean native Archive shell required');
 const works=readContinuousWorks(root).works,pages=new Map();
 const footers=[...template.matchAll(/<div class="sqs-html-content" data-sqsp-text-block-content>([\s\S]*?)<\/div>/g)].filter(m=>m[1].includes('Designed to disintegrate'));
 if(footers.length!==1)throw Error('Continuous Render: native footer identity');
 const footer='<footer class="cr-footer">'+footers[0][0]+'</footer>';
 function page(body,title,route){
  const fullTitle=title+' — effacermonexistence;';
  const w=works.find(w=>w.route===route),description=w?w.description:'Continuous Render — tattoo works on skin by Bennie';
  const image='https://www.effacermonexistence.com'+(w||works[0]).image.url;
  let h=template.replace(/<title>[\s\S]*?<\/title>/,'<title>'+esc(fullTitle)+'</title>').replace(/<main\b[^>]*>[\s\S]*?<\/main>/,m=>m.slice(0,m.indexOf('>')+1)+'<div class="cr-page">'+body+footer+'</div></main>').replace('</head>',css+viewportCss+'\n</head>');
  h=h.replace(/<meta\b[^>]*>/gi,m=>{
   const key=/(?:name|property)="([^"]+)"/i.exec(m)?.[1];
   const value=key==='og:url'?'https://www.effacermonexistence.com'+route:/^(og:|twitter:)title$/.test(key||'')?fullTitle:/^(description|og:description|twitter:description)$/.test(key||'')?description:/^(og:|twitter:)image$/.test(key||'')?image:null;
   return value===null?m:m.replace(/content="[^"]*"/i,'content="'+esc(value)+'"');
  }).replace(/<link\b[^>]*rel="canonical"[^>]*>/i,'<link rel="canonical" href="https://www.effacermonexistence.com'+route+'">');
  return h;
 }
const cards=works.map((w,i)=>`<a class="cr-card" href="${w.route}"><figure><div class="cr-thumb"><img src="${w.image.url}" width="${w.image.width}" height="${w.image.height}" alt="${esc(w.title)} — tattoo in crimson and black" loading="${i<3?'eager':'lazy'}" decoding="async"></div><figcaption><span class="cr-index" translate="no">${esc(w.catalogId)}</span><h2>${esc(w.title)}</h2></figcaption></figure></a>`).join('');
const intro='<header class="cr-intro"><div class="cr-eyebrow">Tattoo archive</div><h1>Continuous Render</h1><p>Works on skin</p><p><em>Pain performs its own archival.</em></p></header>';
pages.set('/continuous-render',page(intro+'<nav class="cr-grid" aria-label="Tattoo works">'+cards+'</nav>','Continuous Render','/continuous-render'));
for(const [i,w]of works.entries()){const prev=works[(i+works.length-1)%works.length],next=works[(i+1)%works.length];const body=`<nav class="cr-breadcrumb"><a href="/continuous-render">Continuous Render / All works</a></nav><article class="cr-work"><figure><img src="${w.image.url}" width="${w.image.width}" height="${w.image.height}" style="max-width:min(100%,${w.image.width}px)" alt="${esc(w.title)} — tattoo in crimson and black" fetchpriority="high" decoding="async"></figure><div class="cr-metadata sqs-html-content"><p><strong>Title</strong></p><h1 translate="no">${esc(w.catalogId)}</h1><p class="cr-subtitle"><em>${esc(w.title)}</em></p><p><strong>Year </strong>${esc(w.documentationYear)} (documentation)</p><p><strong>Medium </strong>${esc(w.medium)}</p><p><strong>Dimensions </strong>${esc(w.dimensions)}</p><p><strong>Palette </strong>${esc(w.palette)}</p><p><strong>Published </strong><time datetime="${w.published}">${w.published}</time></p><p class="cr-description"><strong>Description</strong></p><p>${esc(w.description)}</p><p>${esc(w.statement)}</p></div></article><nav class="cr-bottom"><a href="${prev.route}">← ${esc(prev.catalogId)}</a><a href="/continuous-render">All works</a><a href="${next.route}">${esc(next.catalogId)} →</a></nav>`;pages.set(w.route,page(body,w.catalogId+' / '+w.title,w.route))}

 pages.set('/continuous-render',addContinuousCatalogue(pages.get('/continuous-render'),root,pages));
 return pages;
}
export function copyContinuousMedia(root,out){copyTattooMotion(root,out);for(const w of readContinuousWorks(root).works)fs.copyFileSync(path.join(root,'content/continuous-render/images',w.image.file),path.join(out,'s',w.image.file))}
