'use strict';
const fs=require('node:fs'),path=require('node:path');
const assets=new Map();
function read(root){if(!assets.has(root)){const dir=path.join(root,'content/site-footer'),layout=JSON.parse(fs.readFileSync(path.join(dir,'layout.json'),'utf8')),css=fs.readFileSync(path.join(dir,'style.css'),'utf8');if(layout.schemaVersion!==1)throw Error('Footer layout schema');assets.set(root,{layout,css})}return assets.get(root)}
function elementBounds(html,selector){
 const m=selector.match(/^(?:(footer)\.)?([A-Za-z0-9_-]+)$/)||selector.match(/^\.([A-Za-z0-9_-]+)$/);
 if(!m)throw Error('Unsupported footer selector '+selector);
 const tag=selector.startsWith('footer.')?'footer':'div',cls=selector.replace(/^footer\.|^\./,'');
 const rx=new RegExp('<'+tag+'\\b[^>]*\\bclass="[^"]*\\b'+cls+'\\b[^"]*"[^>]*>','g');
 const hits=[...html.matchAll(rx)];if(hits.length!==1)throw Error('Footer target count '+selector+' '+hits.length);
 const start=hits[0].index,token=new RegExp('<\\/?'+tag+'\\b[^>]*>','g');token.lastIndex=start;let depth=0;
 for(let q;(q=token.exec(html));){if(q[0].startsWith('</'))depth--;else depth++;if(depth===0)return{start,end:token.lastIndex}}
 throw Error('Unclosed footer target '+selector);
}
function removeElement(html,selector){const b=elementBounds(html,selector);return html.slice(0,b.start)+html.slice(b.end)}
function layoutCss(recipe){
 let css='';
 for(const [name,grids]of Object.entries(recipe.views)){
  let rules='';for(const g of grids){if(g.auto)throw Error('Unclassified automatic footer grid');if(g.remaining===0){rules+=g.selector+'{display:none!important}';continue}
   const count=g.lastContentRow-1;if(!Number.isInteger(count)||count<1)throw Error('Footer row boundary');
   // Preserve all authored content row/column positions. Only the trailing rows
   // formerly occupied by the removed footer are discarded.
   const row=name==='mobile'?'24px':'calc(var(--container-width) * var(--row-height-scaling-factor))';
   const rows=g.selector==='.fe-6976d08c21f9967c4819c354'?'repeat('+(count-1)+',minmax('+row+',auto)) auto':'repeat('+count+',minmax('+row+',auto))';
   rules+=g.selector+'{grid-template-rows:'+rows+'!important}';
  }css+='@media('+(name==='mobile'?'max-width:767px':'min-width:768px')+'){'+rules+'}';
 }return css;
}
function withSharedFooter(html,route,root){
 if(!route||!html.includes('id="footer-sections"'))return html;
 if(html.includes('id="site-shared-footer"'))throw Error('Shared footer duplicate');
 const {layout,css}=read(root),recipe=layout.routes[route];if(!recipe)throw Error('Unclassified footer route '+route);
 for(const selector of recipe.remove)html=removeElement(html,selector);
 const start=html.lastIndexOf('<footer class="sections" id="footer-sections"'),openEnd=html.indexOf('>',start),end=html.indexOf('</footer>',openEnd);
 if(start<0||openEnd<start||end<openEnd)throw Error('Footer landmark boundary');
 const shared='<div id="site-shared-footer" data-reference="archive"><a class="site-footer-wordmark" href="/" aria-label="Effacer mon existence — Home"><img src="/s/wordmark-original-6d82985cb5f1.png" width="5000" height="700" alt="Effacer mon existence" loading="lazy" decoding="async"></a><div class="site-footer-copy"><div><p>© <a href="https://omaragi.com" target="_blank" rel="noopener noreferrer">OmarAGI</a> — Exiled from the rendered world. Designed to disintegrate so the system can feel.</p><p class="site-footer-spacer" aria-hidden="true"></p><p class="site-footer-rights">Copyright. All rights reserved.</p></div></div><div class="site-footer-bottom-space" aria-hidden="true"></div></div>';
 html=html.slice(0,openEnd+1)+shared+html.slice(end);
 if(html.split('</head>').length!==2)throw Error('Footer head boundary');
 return html.replace('</head>','<style id="site-shared-footer-style">'+css+layoutCss(recipe)+'</style></head>');
}
function footerRouteForFile(siteDir,file){
 const rel=path.relative(siteDir,file).replaceAll(path.sep,'/');
 if(rel==='index.html')return'/';if(rel==='404.html')return'/404';
 if(rel.startsWith('pages/')&&rel.endsWith('.html'))return'/'+rel.slice(6,-5);
 return null;
}
module.exports={withSharedFooter,layoutCss,elementBounds,footerRouteForFile};
