'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ORIGINAL='/s/wordmark-original-6d82985cb5f1.png';
const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
function parse(html) {
  const nodes=[],stack=[],rx=/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g;
  for(let m;(m=rx.exec(html));) {
    const token=m[0];if(token.startsWith('<!--'))continue;
    const tag=token.match(/^<\/?([A-Za-z][\w:-]*)/)[1].toLowerCase();
    if(token.startsWith('</')) {
      const i=stack.map(n=>n.tag).lastIndexOf(tag);
      if(i>=0){for(const n of stack.slice(i))n.end=rx.lastIndex;stack.length=i;}
      continue;
    }
    const attrs={};
    const tail=token.replace(/^<[A-Za-z][\w:-]*/,''),ar=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    for(let a;(a=ar.exec(tail));)attrs[a[1].toLowerCase()]=a[2]??a[3]??a[4]??'';
    const node={tag,attrs,start:m.index,openEnd:rx.lastIndex,end:rx.lastIndex,parent:stack.at(-1)};nodes.push(node);
    if(tag==='script'||tag==='style') {
      const close=new RegExp('</'+tag+'\\s*>','ig');close.lastIndex=rx.lastIndex;
      const end=close.exec(html);if(!end)throw Error('Unclosed raw-text element');rx.lastIndex=close.lastIndex;node.end=close.lastIndex;continue;
    }
    if(!VOID.has(tag)&&!token.endsWith('/>'))stack.push(node);
  }
  return nodes;
}
function closest(node,test){for(let p=node.parent;p;p=p.parent)if(test(p))return p;}
function hasClass(n,name){return(n.attrs.class||'').split(/\s+/).includes(name);}
function addAttribute(html,node,name){const t=html.slice(node.start,node.openEnd);return t.slice(0,-1)+' '+name+'="1">';}
function bodyWordmarks(root) {
  const css=fs.readFileSync(path.join(root,'content/body-wordmarks/style.css'));
  const asset='/s/body-wordmarks-'+crypto.createHash('sha256').update(css).digest('hex').slice(0,16)+'.css';
  const markup='<link id="body-wordmarks-policy" rel="stylesheet" href="'+asset+'">';
  const image='<img class="site-body-wordmark-image" src="'+ORIGINAL+'" width="5000" height="700" alt="effacer mon existence;" decoding="async">';
  const link='<a class="site-body-wordmark-link" href="/" aria-label="Effacer mon existence — Home">'+image+'</a>';
  function transform(html) {
    if(html.includes('id="body-wordmarks-policy"'))throw Error('Body wordmarks already applied');
    // The middle editorial SVG contains three approved word crops. Its own
    // responsive layout must survive global sizing of horizontal home logos.
    // Footer markup and geometry are frozen and excluded from this pass.
    const nodes=parse(html),logos=nodes.filter(n=>n.tag==='img'&&n.attrs.src===ORIGINAL&&!closest(n,p=>p.attrs.id==='header'||p.tag==='footer'||p.attrs.id==='site-shared-footer'));
    const replacements=[],marked=new Map();let native=0,footer=0,editorial=0;
    for(const logo of logos) {
      if(closest(logo,n=>n.tag==='a'))throw Error('Unexpected pre-linked body logo');
      const block=closest(logo,n=>n.attrs.id?.startsWith('block-')&&hasClass(n,'sqs-block-image'));
      if(block) {
        const images=nodes.filter(n=>n.tag==='img'&&closest(n,p=>p===block));
        if(images.length!==1)throw Error('Body logo block contains another image');
        const grid=closest(block,n=>hasClass(n,'fe-block'));if(!grid)throw Error('Missing body logo grid');
        marked.set(grid,{name:'data-body-wordmark-grid'});
        replacements.push({start:block.start,end:block.end,text:'<div id="'+block.attrs.id+'" class="site-body-wordmark" data-body-wordmark="native" data-i18n-ignore="true">'+link+'</div>'});native++;
      } else {
        const heading=closest(logo,n=>hasClass(n,'home-cern-layout-heading'));
        if(!heading)throw Error('Unclassified body logo');marked.set(heading,{name:'data-body-wordmark-heading'});
        replacements.push({start:logo.start,end:logo.end,text:'<span class="site-body-wordmark-inline" data-body-wordmark="editorial" data-i18n-ignore="true">'+link+'</span>'});editorial++;
      }
    }
    for(const[node,{name}]of marked)replacements.push({start:node.start,end:node.openEnd,text:addAttribute(html,node,name)});
    replacements.sort((a,b)=>b.start-a.start);
    for(let i=1;i<replacements.length;i++)if(replacements[i].end>replacements[i-1].start)throw Error('Overlapping body logo replacements');
    let next=html;for(const r of replacements)next=next.slice(0,r.start)+r.text+next.slice(r.end);
    if(logos.length){if(next.split('</head>').length!==2)throw Error('Body wordmark head boundary');next=next.replace('</head>',markup+'</head>');}
    return{html:next,count:logos.length,native,footer,editorial,replacements};
  }
  return{css,asset,markup,transform,render:html=>transform(html).html};
}
module.exports={bodyWordmarks,parse};
