import crypto from 'node:crypto';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const routes=new Set(['/','/exist','/exist-fr']);
const marker='<!--home-link-minimal:';
const style=`<style id="home-link-minimal-v1">
/* Keep the first landing's destination and hit target, without a pill. */
body[data-home-cern-layout="1"] main .sqs-block-button-element {
 background:transparent!important;border:0!important;border-radius:0!important;box-shadow:none!important;
 padding:.35rem .2rem!important;min-height:44px!important;min-width:0!important;color:inherit!important;
}
body[data-home-cern-layout="1"] .home-cern-layout-title-link {
 display:block;color:inherit!important;text-decoration:none!important;background:none!important;border:0!important;
 padding:0!important;box-shadow:none!important;transition:opacity .18s ease;
}
.home-cern-layout-title-link:hover{opacity:.72}
.home-cern-layout-title-link:focus-visible{outline:1px solid currentColor;outline-offset:8px}
</style>\n`;
export function addHomeLinkMinimal(html,root,route){
 if(!routes.has(route))return html;
 if(html.includes(marker)||html.includes('id="home-link-minimal-v1"'))throw Error('Minimal links already applied');
 const prior=hash(html),edits=[];let count=0;
 html=html.replace(/<article class="home-cern-layout-panel"[^>]*>[\s\S]*?<\/article>/g,article=>{
   const action=/<div class="home-cern-layout-action"><a\b([^>]*)>[\s\S]*?<\/a><\/div>/.exec(article);
   const heading=/<header class="home-cern-layout-heading sqs-html-content">([\s\S]*?)<\/header>/.exec(article);
   if(!action||!heading)throw Error('Expected exact editorial heading and action');
   const href=/\bhref="([^"]+)"/.exec(action[1]);if(!href)throw Error('Missing action destination');
   const target=/\btarget="([^"]+)"/.exec(action[1]),rel=/\brel="([^"]+)"/.exec(action[1]);
   const attrs=' href="'+href[1]+'"'+(target?' target="'+target[1]+'"':'')+(rel?' rel="'+rel[1]+'"':'');
   const nextHeading=heading[0].replace(heading[1],'<a class="home-cern-layout-title-link"'+attrs+'>'+heading[1]+'</a>');
   const placeholder='<!--home-minimal-action:'+count+'-->';
   edits.push({headingBefore:heading[0],headingAfter:nextHeading,action:action[0],placeholder,destination:href[1]});count++;
   return article.replace(heading[0],nextHeading).replace(action[0],placeholder);
 });
 if(count!==9)throw Error('Expected nine visible homepage editorial actions, observed '+count);
 if(html.split('</head>').length!==2)throw Error('One HTML head required');
 html=html.replace('</head>',style+'</head>');
 const receipt={version:1,route,priorSha256:prior,adoptedSha256:hash(html),edits};
 return html.replace('</head>',marker+Buffer.from(JSON.stringify(receipt)).toString('base64')+'-->\n</head>');
}
export function removeHomeLinkMinimal(html){
 if(!html.includes(marker))return html;
 const ms=[...html.matchAll(/<!--home-link-minimal:([A-Za-z0-9+/=]+)-->\n/g)];if(ms.length!==1)throw Error('Minimal links receipt count');
 const r=JSON.parse(Buffer.from(ms[0][1],'base64').toString());html=html.replace(ms[0][0],'');if(hash(html)!==r.adoptedSha256)throw Error('Minimal links adopted surface changed');
 if(html.split(style).length!==2)throw Error('Minimal links policy identity');html=html.replace(style,'');
 for(const e of [...r.edits].reverse()){
  if(html.split(e.headingAfter).length!==2||html.split(e.placeholder).length!==2)throw Error('Minimal link inverse cardinality');
  html=html.replace(e.headingAfter,e.headingBefore).replace(e.placeholder,e.action);
 }
 if(hash(html)!==r.priorSha256)throw Error('Minimal links inverse mismatch');return html;
}
