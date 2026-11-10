'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parse}=require('./body-wordmarks.cjs');
const LABELS=new Map([['/code','CODE'],['/archive','ARCHIVE'],['/talek-1','THEORY'],['/talek-1-2','COSMOLOGY']]);
const cls=(n,c)=>(n.attrs.class||'').split(/\s+/).includes(c);
function ancestor(n,test){for(let p=n.parent;p;p=p.parent)if(test(p))return p;}
function sectionIdentity(root,wordmarks){
 const reference=JSON.parse(fs.readFileSync(path.join(root,'content/section-identity/apply-reference.json'),'utf8'));
 if(reference.referenceRoute!=='/apply'||reference.reference.firstHeadingRow!==7)throw Error('APPLY reference identity');
 const css=Buffer.concat([fs.readFileSync(path.join(root,'content/section-identity/style.css')),fs.readFileSync(path.join(root,'content/section-identity/apply-mobile-rows.css'))]);
 const asset='/s/section-identity-'+crypto.createHash('sha256').update(css).digest('hex').slice(0,16)+'.css';
 const markup='<link id="section-identity-policy" rel="stylesheet" href="'+asset+'">';
 function transform(html,route){
  const label=LABELS.get(route);if(!label)return{html,actions:0,acronyms:0};
  if(html.includes('id="section-identity-policy"'))throw Error('Section identity duplicate');
  const nodes=parse(html),replacements=[];
  const logo='<a class="site-body-wordmark-link" href="/" aria-label="Effacer mon existence — Home"><img class="site-body-wordmark-image" src="/s/wordmark-original-6d82985cb5f1.png" width="5000" height="700" alt="effacer mon existence;" decoding="async"></a>';
  // Keep route identity in navigation/accessibility, not as a repeated body title.
  const heading='<header class="site-section-heading" aria-label="'+label+'">'+logo+'</header>';
  if(route==='/talek-1-2'){
   const container=nodes.find(n=>cls(n,'cosmology')&&ancestor(n,p=>p.tag==='main'));
   if(!container||nodes.some(n=>n.attrs['data-body-wordmark']))throw Error('Cosmology heading boundary');
   replacements.push({start:container.start,end:container.openEnd,text:html.slice(container.start,container.openEnd-1)+' data-section-entrance="cosmology" data-apply-mobile-cosmology="1">'});
   replacements.push({start:container.openEnd,end:container.openEnd,text:heading});
   // Category names stay in navigation, not as a repeated body label.
   const eyebrows=nodes.filter(n=>cls(n,'eyebrow')&&ancestor(n,p=>p===container)&&cls(n.parent,'hero'));
   if(eyebrows.length!==1||html.slice(eyebrows[0].openEnd,eyebrows[0].end).replace(/<[^>]*>/g,'').trim()!=='Cosmology · research record')throw Error('Cosmology category label boundary');
   replacements.push({start:eyebrows[0].start,end:eyebrows[0].end,text:''});
  }else{
   const logos=nodes.filter(n=>n.attrs['data-body-wordmark']==='native'&&ancestor(n,p=>p.tag==='main'));
   if(logos.length!==1)throw Error('Section logo coverage '+route);
   const native=logos[0],grid=ancestor(native,n=>'data-body-wordmark-grid' in n.attrs);
   if(!grid)throw Error('Section logo grid boundary');
   const engine=ancestor(grid,n=>cls(n,'fluid-engine'));
   if(!engine)throw Error('Section content grid boundary');
   const entrance=route==='/talek-1'?'theory':route.slice(1);
   const layout=reference.routes.find(p=>p.route===route);
   if(!layout||!cls(grid,layout.logoClass)||!cls(engine,layout.grid))throw Error('APPLY reference native grid '+route);
   const section=ancestor(engine,n=>n.tag==='section');if(!section)throw Error('APPLY reference section');
   replacements.push({start:section.start,end:section.openEnd,text:html.slice(section.start,section.openEnd-1)+' data-apply-mobile-section="1">'});
   replacements.push({start:engine.start,end:engine.openEnd,text:html.slice(engine.start,engine.openEnd-1)+' data-section-rise="'+entrance+'" data-apply-mobile-grid="1" data-section-entry-flow="'+entrance+'">'});
   for(const block of nodes.filter(n=>n.parent===engine&&cls(n,'fe-block')&&n!==grid)){
    if(nodes.some(n=>n.attrs.id==='site-shared-footer'&&ancestor(n,p=>p===block)))throw Error('Footer inside section content grid');
    const content=html.slice(block.openEnd,block.end).replace(/<(?:style|script)\b[^>]*>[\s\S]*?<\/(?:style|script)>/g,'').replace(/<[^>]*>/g,'').trim();
    if(content){
     const placement=layout.blocks.find(p=>cls(block,p.class));if(!placement)throw Error('APPLY reference block '+route);
     replacements.push({start:block.start,end:block.openEnd,text:html.slice(block.start,block.openEnd-1)+' data-section-content-rise="1" data-apply-mobile-content="1"'+(placement.action?' data-apply-mobile-action="1"':'')+' data-index-role="'+(route==='/archive'?(placement===layout.blocks[0]?'heading':'support'):(placement.action?'action':'heading'))+'"'+(placement===layout.blocks[0]?' data-index-first="1"':'')+'>'});
    }
   }
   const nativeHeading=native.attrs['data-text-veil']?heading.replace('<header ','<header data-text-veil="'+native.attrs['data-text-veil']+'" '):heading;
   replacements.push({start:native.start,end:native.end,text:nativeHeading});
   replacements.push({start:grid.start,end:grid.openEnd,text:html.slice(grid.start,grid.openEnd-1)+' data-section-heading-grid="1">'});
  }
  for(const node of nodes){
   if(!ancestor(node,n=>n.tag==='main')||ancestor(node,n=>n.tag==='footer'||n.attrs.id==='site-shared-footer'))continue;
   if(cls(node,'sqs-html-content')||(route==='/talek-1-2'&&cls(node,'hero'))){
    replacements.push({start:node.start,end:node.openEnd,text:html.slice(node.start,node.openEnd-1)+' data-apply-mobile-type="1"'+(route==='/archive'&&nodes.some(n=>n.tag==='h2'&&ancestor(n,p=>p===node)&&/text-align\s*:\s*center/.test(n.attrs.style||''))?' data-archive-intro-type="1"':'')+'>'});
   }
  }
  for(const n of nodes){
   if(!/^(h[1-6]|p)$/.test(n.tag))continue;
   const engine=ancestor(n,p=>cls(p,'fluid-engine'));
   const block=ancestor(n,p=>cls(p,'sqs-html-content'));
   const archiveIntro=route==='/archive'&&block&&nodes.some(h=>h.tag==='h2'&&ancestor(h,p=>p===block)&&/text-align\s*:\s*center/.test(h.attrs.style||'')&&html.slice(h.openEnd,h.end).replace(/<[^>]*>/g,'').trim());
   if(!engine||(!archiveIntro&&!reference.routes.some(r=>r.route===route&&cls(engine,r.grid))))continue;
   if(nodes.some(x=>['img','video','iframe','math','svg'].includes(x.tag)&&x.start>n.start&&x.end<n.end))continue;
   const text=html.slice(n.openEnd,n.end).replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;|\u00a0/g,'').trim();
   if(!text)replacements.push({start:n.start,end:n.openEnd,text:html.slice(n.start,n.openEnd-1)+' data-index-empty="1">'});
  }
  if(route==='/archive'){
   let count=0;
   for(const engine of nodes.filter(n=>cls(n,'fluid-engine')&&ancestor(n,p=>p.tag==='main'))){
    const children=nodes.filter(n=>n.parent===engine&&cls(n,'fe-block'));
    if(children.length!==2||nodes.some(n=>['img','video','iframe','math'].includes(n.tag)&&ancestor(n,p=>p===engine)))continue;
    const heading=nodes.find(n=>n.tag==='h2'&&ancestor(n,p=>p===engine)&&/text-align\s*:\s*center/.test(n.attrs.style||'')&&html.slice(n.openEnd,n.end).replace(/<[^>]*>/g,'').trim());
    if(!heading)continue;
    const titleBlock=ancestor(heading,n=>n.parent===engine);
    replacements.push({start:engine.start,end:engine.openEnd,text:html.slice(engine.start,engine.openEnd-1)+' data-archive-intro-flow="1">'});
    for(const child of children)replacements.push({start:child.start,end:child.openEnd,text:html.slice(child.start,child.openEnd-1)+' data-archive-intro-block="'+(child===titleBlock?'heading':'support')+'">'});
    count++;
   }
   if(count!==3)throw Error('Archive text-only intro coverage');
  }
  let actions=0,acronyms=0;
  if(route==='/talek-1'){
   for(const n of nodes){
    if(!ancestor(n,p=>p.tag==='main'))continue;
    let attr;
    if(n.tag==='a'&&cls(n,'sqs-block-button-element')){attr='data-theory-action';actions++;}
    else if(n.tag==='h2'&&/^\s*(?:RCC|DLCA-U|UCEQ|UCT|OUFT|TDR|ISEI|TALEK)\s*$/.test(html.slice(n.openEnd,n.end).replace(/<[^>]*>/g,''))){attr='data-theory-acronym';acronyms++;}
    if(attr)replacements.push({start:n.start,end:n.openEnd,text:html.slice(n.start,n.openEnd-1)+' '+attr+'="1">'});
   }
   if(actions!==9||acronyms!==8)throw Error('Theory single-line coverage');
  }
  let next=html;
  for(const r of replacements.sort((a,b)=>b.start-a.start||b.end-a.end))next=next.slice(0,r.start)+r.text+next.slice(r.end);
  if(next.split('</head>').length!==2)throw Error('Section identity head boundary');
  const bodyLogoCss=next.includes('id="body-wordmarks-policy"')?'':wordmarks.markup;
  next=next.replace('</head>',bodyLogoCss+markup+'</head>');
  return{html:next,actions,acronyms};
 }
 return{css,asset,markup,reference,transform,render:(html,route)=>transform(html,route).html};
}
module.exports={sectionIdentity};
