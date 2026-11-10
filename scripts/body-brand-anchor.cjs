'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parse,bodyWordmarks}=require('./body-wordmarks.cjs');
const HOME=new Set(['/','/exist','/exist-fr']);
const cls=(n,c)=>(n.attrs.class||'').split(/\s+/).includes(c);
function ancestor(n,test){for(let p=n.parent;p;p=p.parent)if(test(p))return p;}
function bodyBrandAnchor(root){
 const raw=fs.readFileSync(path.join(root,'site/index.html'),'utf8'),nodes=parse(raw);
 const logo=nodes.find(n=>n.tag==='img'&&n.attrs.src==='/s/wordmark-original-6d82985cb5f1.png'&&ancestor(n,p=>p.tag==='main'));
 if(!logo)throw Error('Desktop brand: home reference logo missing');
 const grid=ancestor(logo,n=>cls(n,'fluid-engine')),block=ancestor(logo,n=>cls(n,'fe-block')),wrapper=ancestor(logo,n=>cls(n,'content-wrapper')),section=ancestor(logo,n=>n.tag==='section');
 if(!grid||!block||!wrapper||!section)throw Error('Desktop brand: home grid boundary');
 const source=raw.slice(section.start,section.end),gridName=grid.attrs.class.split(/\s+/).find(c=>c.startsWith('fe-')),blockName=block.attrs.class.split(/\s+/).find(c=>c.startsWith('fe-block-'));
 const rowScale=Number(/--row-height-scaling-factor:\s*([\d.]+)/.exec(source)?.[1]),gap=Number(/row-gap:\s*([\d.]+)px/.exec(source)?.[1]);
 const areas=[...source.matchAll(new RegExp('\\.'+blockName+'\\s*\\{[^}]*grid-area:\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*\\/\\s*(\\d+)','g'))];
 const area=areas.at(-1),pad=/padding-top:\s*calc\(([\d.]+)vmax\s*\/\s*([\d.]+)\)/.exec(wrapper.attrs.style||'');
 if(!area||!pad||!rowScale||!gap||!source.includes('.'+gridName))throw Error('Desktop brand: incomplete native home reference');
 const start=Number(area[1]),end=Number(area[3]),span=end-start;
 const reference={rowScale,gap,paddingVmax:Number(pad[1])/Number(pad[2]),centerRows:start-1+span/2,centerGaps:start-1+(span-1)/2};
 const mobileArea=areas[0],mobileStart=Number(mobileArea[1]),mobileEnd=Number(mobileArea[3]);
 if(mobileStart!==6||mobileEnd!==7||!source.includes('minmax(24px, auto)'))throw Error('Mobile brand: native home row reference changed');
 reference.mobile={rowHeight:24,gap,paddingVmax:Number(pad[1])/Number(pad[2]),centerRows:mobileStart-1+(mobileEnd-mobileStart)/2,centerGaps:mobileStart-1+(mobileEnd-mobileStart-1)/2,minimumCopyGapRem:2};
 const css=fs.readFileSync(path.join(root,'content/body-brand-anchor/style.css')),asset='/s/body-brand-anchor-'+crypto.createHash('sha256').update(css).digest('hex').slice(0,16)+'.css';
 const runtime=fs.readFileSync(path.join(root,'content/body-brand-anchor/runtime.js'),'utf8');if(runtime.includes('</script'))throw Error('Desktop brand script boundary');
 const head='<link id="body-brand-anchor-policy" rel="stylesheet" href="'+asset+'">';
 const boot='<script id="body-brand-anchor-runtime" data-reference="'+JSON.stringify(reference).replaceAll('"','&quot;')+'">'+runtime+'</script>';
 function transform(html,route){
  if(HOME.has(route))return{html,marked:false};
  if(route==='/continuous-render'){
   const originalNodes=parse(html),intro=originalNodes.find(n=>n.tag==='header'&&cls(n,'cr-motion-intro')&&ancestor(n,p=>p.tag==='main'));
   const labels=originalNodes.filter(n=>cls(n,'cr-eyebrow')&&ancestor(n,p=>p===intro));
   if(!intro||labels.length!==1||html.slice(labels[0].openEnd,labels[0].end).replace(/<[^>]*>/g,'').trim()!=='Tattoo archive')throw Error('Continuous Render entrance boundary');
   const brand='<div class="site-body-wordmark-inline" data-continuous-render-brand="1" data-i18n-ignore="true"><a class="site-body-wordmark-link" href="/" aria-label="Effacer mon existence — Home"><img class="site-body-wordmark-image" src="/s/wordmark-original-6d82985cb5f1.png" width="5000" height="700" alt="effacer mon existence;" decoding="async"></a></div>';
   html=html.slice(0,labels[0].start)+brand+html.slice(labels[0].end);
   const brandCss='<style id="continuous-render-brand-entrance">@media(min-width:768px){html body main .cr-motion-intro[data-desktop-brand-section]{align-items:flex-start!important}html body main .cr-motion-intro>.cr-motion-content[data-desktop-brand-holder]{margin-block:0}}</style>';
   html=html.replace('</head>',(html.includes('id="body-wordmarks-policy"')?'':bodyWordmarks(root).markup)+brandCss+'</head>');
  }
  const ns=parse(html),mark=ns.find(n=>cls(n,'site-body-wordmark-image')&&ancestor(n,p=>p.tag==='main')&&!ancestor(n,p=>p.tag==='footer'||p.attrs.id==='site-shared-footer'));
  if(!mark)return{html,marked:false};
  if(html.includes('id="body-brand-anchor-policy"'))throw Error('Desktop brand duplicate');
  const holder=ancestor(mark,n=>cls(n,'content-wrapper')||cls(n,'cosmology')||cls(n,'cr-motion-content'));
  if(!holder)throw Error('Desktop brand entrance owner '+route);
  const section=ancestor(mark,n=>cls(n,'page-section')||cls(n,'cr-motion-intro'));
  const marks=[[holder,'data-desktop-brand-holder'],[mark,'data-desktop-brand-image']];if(section)marks.push([section,'data-desktop-brand-section']);
  let next=html;for(const[n,key]of marks.sort((a,b)=>b[0].start-a[0].start))next=next.slice(0,n.start)+html.slice(n.start,n.openEnd-1)+' '+key+'="1">'+next.slice(n.openEnd);
  if(next.split('</head>').length!==2||next.split('</body>').length!==2)throw Error('Desktop brand document boundary');
  return{html:next.replace('</head>',head+'</head>').replace('</body>',boot+'</body>'),marked:true};
 }
 return{reference,css,asset,head,boot,transform,render:(html,route)=>transform(html,route).html};
}
module.exports={bodyBrandAnchor};
