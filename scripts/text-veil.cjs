'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parse}=require('./body-wordmarks.cjs');
const HOME=new Set(['/','/exist','/exist-fr']);
const cls=(n,c)=>(n.attrs.class||'').split(/\s+/).includes(c);
function ancestor(n,fn){for(let p=n.parent;p;p=p.parent)if(fn(p))return p;}
const isSection=n=>cls(n,'page-section');
function textVeil(root){
 const assets=['style.css','runtime.js'].map(file=>{const bytes=fs.readFileSync(path.join(root,'content/text-veil',file));return{asset:'/s/text-veil-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16)+path.extname(file),bytes};});
 const markup='<link id="text-veil-policy" rel="stylesheet" href="'+assets[0].asset+'">';
 const runtime='<script id="text-veil-runtime" defer src="'+assets[1].asset+'"></script>';
 function transform(html,route){
  if(HOME.has(route))return{html,groups:0,sections:0,replacements:[]};
  if(html.includes('id="text-veil-policy"'))throw Error('Text veil duplicate');
  const nodes=parse(html),sections=nodes.filter(n=>isSection(n)&&ancestor(n,p=>p.tag==='main'));
  const painted=new Set();
  for(const section of sections){
   const backgrounds=nodes.filter(n=>cls(n,'section-background')&&ancestor(n,isSection)===section);
   for(const bg of backgrounds){
    if(/background(?:-image)?\s*:[^;]*url\(/i.test(bg.attrs.style||'')||nodes.some(n=>n.start>bg.start&&n.end<bg.end&&(['img','video','canvas'].includes(n.tag)||/background(?:-image)?\s*:[^;]*url\(/i.test(n.attrs.style||'')))){painted.add(section);break;}
   }
  }
  const candidates=new Map();
  for(const n of nodes){
   const section=ancestor(n,isSection);if(!painted.has(section))continue;
   if(n.attrs['data-body-wordmark']==='native'){candidates.set(n,'wordmark');continue;}
   if(cls(n,'sqs-block-content')){
    const block=ancestor(n,p=>cls(p,'sqs-block'));
    // CODE actions already have the accepted main/Theory fill inversion.
    // Do not turn their temporary black hover text into a white glow halo.
    if(route==='/code'&&block&&cls(block,'sqs-block-button'))continue;
    if(block&&['sqs-block-html','sqs-block-form','sqs-block-button','sqs-block-markdown','sqs-block-accordion'].some(c=>cls(block,c)))candidates.set(n,cls(block,'sqs-block-form')?'form':'text');
   }
  }
  const replacements=[];
  for(const[n,kind]of candidates){
   if(ancestor(n,p=>candidates.has(p)))continue;
   if(kind!=='wordmark'&&!html.slice(n.openEnd,n.end).replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim())continue;
   replacements.push({start:n.start,end:n.openEnd,text:html.slice(n.start,n.openEnd-1)+' data-text-veil="'+kind+'">'});
  }
  let next=html;for(const r of [...replacements].reverse())next=next.slice(0,r.start)+r.text+next.slice(r.end);
  if(replacements.length){if(next.split('</head>').length!==2||next.split('</body>').length!==2)throw Error('Text veil document boundary');next=next.replace('</head>',markup+'</head>').replace('</body>',runtime+'</body>');}
  return{html:next,groups:replacements.length,sections:painted.size,replacements};
 }
 return{assets,markup,runtime,transform,render:(html,route)=>transform(html,route).html};
}
module.exports={textVeil};
