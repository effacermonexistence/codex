'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parse}=require('./body-wordmarks.cjs');
const HOME=new Set(['/','/exist','/exist-fr']);
const EXCLUDED=new Set(['nav','form','button','label','pre','code','math','mjx-container','table']);
const hasClass=(n,c)=>(n.attrs.class||'').split(/\s+/).includes(c);
function siteTypography(root){
 const chapterRoutes=new Set(require('./section-recovery.cjs').sectionRecovery(root,'').chapters.map(x=>x.href));
 if(chapterRoutes.size!==35)throw Error('Chapter title route coverage');
 const css=fs.readFileSync(path.join(root,'content/site-typography/style.css'));
 const asset='/s/site-typography-'+crypto.createHash('sha256').update(css).digest('hex').slice(0,16)+'.css';
 const markup='<link id="site-typography-policy" rel="stylesheet" href="'+asset+'">';
 function transform(html,route){
  if(HOME.has(route))return{html,replacements:[],titles:0,bodies:0};
  if(html.includes('id="site-typography-policy"'))throw Error('Typography already applied');
  const nodes=parse(html),replacements=[];let titles=0,bodies=0;
  let chapterTitle=null;
  if(chapterRoutes.has(route)){
   const headings=nodes.filter(n=>/^h[1-6]$/.test(n.tag)&&(()=>{for(let p=n;p;p=p.parent)if(p.tag==='main')return true;return false})()&&html.slice(n.openEnd,n.end).replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim());
   if(headings[0]?.tag!=='h2'||!/^CHAPTER\s+[IVXLCDM]+\s*$/.test(html.slice(headings[0].openEnd,headings[0].end).replace(/<[^>]*>/g,'').trim())||headings[1]?.tag!=='h4')throw Error('Chapter cover hierarchy '+route);
   chapterTitle=headings[1];
  }
  for(const node of nodes){
   if(!/^(h[1-6]|p|li)$/.test(node.tag))continue;
   let main=false,excluded=false;
   for(let a=node;a;a=a.parent){
    main||=a.tag==='main';
    excluded||=EXCLUDED.has(a.tag)||a.attrs.id==='header'||'data-body-wordmark' in a.attrs||'data-body-wordmark-heading' in a.attrs||hasClass(a,'katex')||hasClass(a,'MathJax')||hasClass(a,'sqs-block-button');
   }
   if(!main||excluded)continue;
   const content=html.slice(node.openEnd,node.end).replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();
   if(!content)continue;
   // CODE chapter cards use the same native responsive h2 / large-paragraph
   // sizes as the Cosmology TOC, not one shared Apply-sized title override.
   const codeChapter=route==='/code'&&(node.tag==='h2'||(node.tag==='p'&&hasClass(node,'sqsrte-large')))&&nodes.some(n=>n.tag==='a'&&hasClass(n,'code-chapter-link')&&n.start>node.start&&n.end<node.end);
   const role=node===chapterTitle?'chapter-title':codeChapter?'chapter-native':/^h[1-6]$/.test(node.tag)||hasClass(node,'sqsrte-large')||hasClass(node,'cr-subtitle')?'title':'body';
   const text=html.slice(node.start,node.openEnd-1)+' data-site-text-size="'+role+'">';
   replacements.push({start:node.start,end:node.openEnd,text,role});
   role==='body'?bodies++:titles++;
  }
  let next=html;
  for(const edit of [...replacements].reverse())next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);
  if(replacements.length){if(next.split('</head>').length!==2)throw Error('Typography head boundary');next=next.replace('</head>',markup+'</head>');}
  return{html:next,replacements,titles,bodies};
 }
 return{css,asset,markup,transform,render:(html,route)=>transform(html,route).html};
}
module.exports={siteTypography};
