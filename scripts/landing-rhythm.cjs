'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parse}=require('./body-wordmarks.cjs');
const HOME=new Set(['/','/exist','/exist-fr']);
const cls=(n,c)=>(n.attrs.class||'').split(/\s+/).includes(c);
const plain=s=>s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function ancestor(n,test){for(let p=n.parent;p;p=p.parent)if(test(p))return p;}
function landingRhythm(root){
 const assets=['style.css','runtime.js'].map(file=>{const bytes=fs.readFileSync(path.join(root,'content/landing-rhythm',file));return{asset:'/s/landing-rhythm-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16)+path.extname(file),bytes};});
 const markup='<link id="landing-rhythm-policy" rel="stylesheet" href="'+assets[0].asset+'">';
 const runtime='<script id="landing-rhythm-runtime" defer src="'+assets[1].asset+'"></script>';
 function transform(html,route){
  if(!HOME.has(route))return{html,hero:false};
  if(html.includes('id="landing-rhythm-policy"'))throw Error('Landing rhythm duplicate');
  const nodes=parse(html),native=nodes.find(n=>n.attrs['data-body-wordmark']==='native'&&ancestor(n,p=>p.tag==='main'));
  const hero=native&&ancestor(native,n=>n.tag==='section');if(!hero)throw Error('Landing brand boundary '+route);
  const inside=nodes.filter(n=>n.start>hero.start&&n.end<hero.end),brand=inside.find(n=>n.tag==='img'&&ancestor(n,p=>p===native));
  const titles=inside.filter(n=>n.tag==='p'&&cls(n,'sqsrte-large'));
  const logics=inside.filter(n=>n.tag==='p'&&/Logic of Rendering|Logique du Rendu/.test(plain(html.slice(n.openEnd,n.end))));
  const actions=inside.filter(n=>n.tag==='a'&&cls(n,'sqs-block-button-element')&&/^(SEE MORE|VOIR PLUS)$/.test(plain(html.slice(n.openEnd,n.end))));
  if(!brand||titles.length!==1||logics.length!==1||actions.length!==1)throw Error('Landing copy coverage '+route);
  const title=titles[0],logic=logics[0],action=actions[0],copy=ancestor(title,n=>cls(n,'fe-block')),actionGrid=ancestor(action,n=>cls(n,'fe-block'));
  if(!copy||!actionGrid||ancestor(logic,n=>cls(n,'fe-block'))!==copy||actionGrid===copy)throw Error('Landing native grid boundary');
  const marks=[[hero,'data-landing-rhythm'],[brand,'data-landing-brand'],[copy,'data-landing-copy'],[title,'data-landing-title'],[logic,'data-landing-logic'],[actionGrid,'data-landing-action'],[action,'data-landing-action-link']];
  let next=html;
  for(const[n,attr]of marks.sort((a,b)=>b[0].start-a[0].start))next=next.slice(0,n.start)+html.slice(n.start,n.openEnd-1)+' '+attr+'="1">'+next.slice(n.openEnd);
  if(next.split('</head>').length!==2||next.split('</body>').length!==2)throw Error('Landing rhythm document boundary');
  return{html:next.replace('</head>',markup+'</head>').replace('</body>',runtime+'</body>'),hero:true};
 }
 return{assets,markup,runtime,transform,render:(html,route)=>transform(html,route).html};
}
module.exports={landingRhythm};
