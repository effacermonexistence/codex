import crypto from 'node:crypto';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
export const THEORY_TALEK_ROUTE='/talek-1';
export const THEORY_TALEK_TARGET='/talek';
export const THEORY_TALEK_TITLE_ID='theorytalektitle';
export const THEORY_TALEK_BUTTON_ID='theorytalekentry';
const MARK='<!--effacer-theory-talek-entry:';
const END='<!--effacer-theory-talek-entry-end-->';
const GRID='fe-697ac1b4120eac122a709fbe';
export const THEORY_TALEK_STYLE=`<style id="effacer-theory-talek-style">
/* One native Theory entry. Existing typography, colors and button component stay inherited. */
.${GRID}{grid-template-rows:repeat(61,minmax(24px,auto))!important}
.fe-block-${THEORY_TALEK_TITLE_ID}{grid-area:38/2/40/10!important;z-index:20}
.fe-block-${THEORY_TALEK_BUTTON_ID}{grid-area:40/2/41/10!important;z-index:20}
.fe-block-${THEORY_TALEK_TITLE_ID} .sqs-block{justify-content:flex-start}
.fe-block-${THEORY_TALEK_TITLE_ID} .sqs-block-alignment-wrapper{align-items:flex-start}
.fe-block-${THEORY_TALEK_BUTTON_ID} .sqs-block{justify-content:center}
.fe-block-${THEORY_TALEK_BUTTON_ID} .sqs-block-alignment-wrapper{align-items:center}
.fe-block-c1f86450586501629bfe{grid-area:43/2/45/10!important}
.fe-block-b06314b2337aac58401b{grid-area:45/2/46/10!important}
.fe-block-b9b1a8debcd5cfa61d79{grid-area:54/3/59/9!important}
@media(max-width:767px){#siteWrapper.site-wrapper .fe-block-${THEORY_TALEK_BUTTON_ID} .sqs-block-button-element{font-size:min(16px,3.786vw)}}
@media(min-width:768px){
.${GRID}{grid-template-rows:repeat(87,minmax(calc(var(--container-width)*var(--row-height-scaling-factor)),auto))!important}
.fe-block-${THEORY_TALEK_TITLE_ID}{grid-area:57/10/59/18!important}
.fe-block-${THEORY_TALEK_BUTTON_ID}{grid-area:59/10/60/18!important}
.fe-block-c1f86450586501629bfe{grid-area:65/10/68/18!important}
.fe-block-b06314b2337aac58401b{grid-area:68/10/69/18!important}
.fe-block-b9b1a8debcd5cfa61d79{grid-area:83/11/88/17!important}
}
</style>\n`;
function outerBlock(html,id){
 const needle=`<div class="fe-block fe-block-${id}">`,start=html.indexOf(needle);
 if(start<0||html.indexOf(needle,start+1)!==-1)throw Error('Theory Talek: exact native block missing/duplicate '+id);
 const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=start;let depth=0;
 for(let m;(m=tags.exec(html));){depth+=m[0].startsWith('</')?-1:1;if(depth===0)return{start,end:tags.lastIndex,html:html.slice(start,tags.lastIndex)}}
 throw Error('Theory Talek: unclosed native block');
}
export function addTheoryTalekEntry(html,route){
 if(route!==THEORY_TALEK_ROUTE)return html;
 if(html.includes(MARK)||html.includes('id="effacer-theory-talek-style"'))throw Error('Theory Talek: duplicate adoption');
 if(!html.includes(`class="fluid-engine ${GRID}"`))throw Error('Theory Talek: native Theory grid identity changed');
 const title=outerBlock(html,'891b20b752cfcccc2bba'),button=outerBlock(html,'c92da75c1a3193645690'),cosmology=outerBlock(html,'c1f86450586501629bfe');
 if(!title.html.includes('<strong>ISEI</strong>')||!button.html.includes('href="/isea"')||!button.html.includes('Identity Structure of Embedded Intelligence')||!cosmology.html.includes('Collapse  Cosmology'))throw Error('Theory Talek: template source changed');
 const newTitle=title.html.replaceAll('891b20b752cfcccc2bba',THEORY_TALEK_TITLE_ID).replace('<strong>ISEI</strong>','<strong>TALEK</strong>');
 const newButton=button.html.replaceAll('c92da75c1a3193645690',THEORY_TALEK_BUTTON_ID).replace('href="/isea"',`href="${THEORY_TALEK_TARGET}"`).replace('Identity Structure of Embedded Intelligence','Observer Manifold');
 const inserted=newTitle+newButton;
 const receipt=Buffer.from(JSON.stringify({route,target:THEORY_TALEK_TARGET,insertedSha256:sha(inserted),style:THEORY_TALEK_STYLE,sourceTitleSha256:sha(title.html),sourceButtonSha256:sha(button.html)})).toString('base64');
 const block=MARK+receipt+'-->'+inserted+END;
 const next=html.slice(0,cosmology.start)+block+html.slice(cosmology.start);
 return next.replace('</head>',THEORY_TALEK_STYLE+'</head>');
}
export function removeTheoryTalekEntry(html){
 if(!html.includes(MARK)){if(html.includes('id="effacer-theory-talek-style"'))throw Error('Theory Talek: orphan style');return html;}
 const pattern=/<!--effacer-theory-talek-entry:([A-Za-z0-9+/=]+)-->([\s\S]*?)<!--effacer-theory-talek-entry-end-->/g;
 const matches=[...html.matchAll(pattern)];if(matches.length!==1)throw Error('Theory Talek: invalid receipt count');
 const r=JSON.parse(Buffer.from(matches[0][1],'base64').toString('utf8'));
 if(r.route!==THEORY_TALEK_ROUTE||r.target!==THEORY_TALEK_TARGET||sha(matches[0][2])!==r.insertedSha256||r.style!==THEORY_TALEK_STYLE)throw Error('Theory Talek: adopted entry changed');
 if(html.split(THEORY_TALEK_STYLE).length!==2)throw Error('Theory Talek: style changed');
 return html.replace(matches[0][0],'').replace(THEORY_TALEK_STYLE,'');
}
