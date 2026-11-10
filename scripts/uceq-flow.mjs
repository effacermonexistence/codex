import fs from 'node:fs';
import crypto from 'node:crypto';

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const ROUTE='/uceq-1';
const MARK='<!--uceq-flow:';
const END='<!--uceq-flow-end-->';
const POSITION='<!--uceq-flow-original-image-position-->';
const FIGURE_START='<!--uceq-flow-diagram-start-->';
const FIGURE_END='<!--uceq-flow-diagram-end-->';
const IMAGE_ID='yui_3_17_2_1_1769620323955_21121';
const SOURCE='https://images.squarespace-cdn.com/content/v1/681a1e765491a2330ed19075/a8a24687-8a73-4646-ac3f-9e8f75424074/IMG_7712+2.jpg';

function outerBlock(html,id){
 const needle='<div class="fe-block fe-block-'+id+'">',start=html.indexOf(needle);
 if(start<0||html.indexOf(needle,start+1)!==-1)throw Error('UCEQ exact block identity '+id);
 const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=start;let depth=0;
 for(let m;(m=tags.exec(html));){depth+=m[0].startsWith('</')?-1:1;if(depth===0)return html.slice(start,tags.lastIndex)}
 throw Error('UCEQ unclosed block');
}
export function uceqFlowAssets(root){
 const css=fs.readFileSync(root+'/content/uceq-flow/style.css');
 return {css,url:'/s/uceq-flow-'+sha(css).slice(0,16)+'.css'};
}
export function addUceqFlow(html,root,route){
 if(route!==ROUTE)return html;
 if(html.includes(MARK)||html.includes('id="uceq-flow-style"'))throw Error('UCEQ flow duplicate');
 if(!html.includes('class="fluid-engine fe-6976d08c21f9967c4819c354"'))throw Error('UCEQ native grid identity');
 const original=html,imageBlock=outerBlock(html,IMAGE_ID);
 const img=imageBlock.match(/<img\b[^>]*>/g);
 if(img?.length!==1||!img[0].includes('data-src="'+SOURCE+'"')||!img[0].includes('data-image-dimensions="1020x1531"'))throw Error('UCEQ source image identity');
 const srcset=img[0].match(/\bsrcset="([^"]+)"/)?.[1];if(!srcset)throw Error('UCEQ source srcset');
 const before='<p class="" style="white-space:pre-wrap;"><strong>and the inflation of an entire universe.</strong></p>';
 const after='<h4 style="white-space:pre-wrap;"><strong>2. Meaning of Each Term — Four Worlds in One Equation</strong></h4>';
 const start=html.indexOf(before)+before.length,end=html.indexOf(after,start);
 if(start<before.length||end<start)throw Error('UCEQ semantic diagram anchors');
 const spacer=html.slice(start,end),empty=/<p class="" data-rte-preserve-empty="true" style="white-space:pre-wrap;"><\/p>/g;
 if((spacer.match(empty)||[]).length!==24||spacer.replace(empty,'').trim())throw Error('UCEQ exact spacer contract');
 const figure=FIGURE_START+'<figure class="uceq-flow-figure"><img id="uceq-flow-diagram" class="uceq-flow-image" src="'+SOURCE+'" srcset="'+srcset+'" sizes="(max-width:767px) calc(100vw - 48px), 600px" width="1020" height="1531" alt="" loading="lazy" decoding="async"></figure>'+FIGURE_END;
 html=html.slice(0,start)+figure+html.slice(end);
 html=html.replace(imageBlock,POSITION);
 const assets=uceqFlowAssets(root),link='<link id="uceq-flow-style" rel="stylesheet" href="'+assets.url+'">\n';
 if(html.split('</head>').length!==2)throw Error('UCEQ one document');
 html=html.replace('</head>',link+'</head>');
 const receipt={version:1,route,priorHtmlSha256:sha(original),adoptedHtmlSha256:sha(html),imageBlock,spacer,figure,link};
 return html.replace('</head>',MARK+Buffer.from(JSON.stringify(receipt)).toString('base64')+'-->'+END+'\n</head>');
}
export function removeUceqFlow(html){
 if(!html.includes(MARK))return html;
 const matches=[...html.matchAll(/<!--uceq-flow:([A-Za-z0-9+/=]+)--><!--uceq-flow-end-->\n/g)];
 if(matches.length!==1)throw Error('UCEQ flow receipt count');
 const m=matches[0],r=JSON.parse(Buffer.from(m[1],'base64').toString()),adopted=html.replace(m[0],'');
 if(r.version!==1||r.route!==ROUTE||sha(adopted)!==r.adoptedHtmlSha256)throw Error('UCEQ changed adopted state');
 for(const part of [r.link,r.figure,POSITION])if(adopted.split(part).length!==2)throw Error('UCEQ inverse identity');
 const original=adopted.replace(r.link,'').replace(r.figure,r.spacer).replace(POSITION,r.imageBlock);
 if(sha(original)!==r.priorHtmlSha256)throw Error('UCEQ original identity');
 return original;
}
export function copyUceqFlow(root,out){
 const a=uceqFlowAssets(root);fs.mkdirSync(out+'/s',{recursive:true});fs.writeFileSync(out+a.url,a.css);return a;
}
