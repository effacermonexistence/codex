import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const MARK = '<!--header-nav-emphasis:';
const END = '<!--header-nav-emphasis-end-->';
const READY = '<!--header-nav-ready--><template id="navigation-transition-ready"></template><!--header-nav-ready-end-->\n';
export function headerNavAssets(root) {
  const css=fs.readFileSync(path.join(root,'content/header-nav-emphasis/style.css'));
  return {css,motion:css.toString().includes('@view-transition'),asset:'/s/header-nav-emphasis-'+hash(css).slice(0,16)+'.css'};
}
export function addHeaderNavEmphasis(html,root) {
  if(!/class="[^"\n]*header-(?:menu-)?nav(?:-list)?[ "\n]/.test(html))return html;
  if(html.includes(MARK)||html.includes('id="header-nav-emphasis-policy"')||html.includes('id="navigation-transition-ready"'))throw Error('HeaderNav: duplicate');
  if(html.split('</head>').length!==2||html.split('</body>').length!==2)throw Error('HeaderNav: one document');
  const a=headerNavAssets(root),link='<link id="header-nav-emphasis-policy" rel="stylesheet" href="'+a.asset+'">\n'+(a.motion?'<link rel="expect" blocking="render" href="#navigation-transition-ready">\n':'');
  const receipt={version:a.motion?2:1,priorHtmlSha256:hash(html),linkSha256:hash(link)};
  if(a.motion)receipt.readySha256=hash(READY);
  let out=html.replace('</head>',MARK+Buffer.from(JSON.stringify(receipt)).toString('base64')+'-->'+link+END+'\n</head>');
  if(a.motion)out=out.replace('</body>',READY+'</body>');
  return out;
}
export function removeHeaderNavEmphasis(html) {
  if(!html.includes(MARK)){if(html.includes('id="header-nav-emphasis-policy"')||html.includes('id="navigation-transition-ready"'))throw Error('HeaderNav: orphan');return html;}
  const matches=[...html.matchAll(/<!--header-nav-emphasis:([A-Za-z0-9+/=]+)-->([\s\S]*?)<!--header-nav-emphasis-end-->\n/g)];
  if(matches.length!==1)throw Error('HeaderNav: receipt count');
  const m=matches[0],r=JSON.parse(Buffer.from(m[1],'base64').toString());
  if(![1,2].includes(r.version)||hash(m[2])!==r.linkSha256)throw Error('HeaderNav: changed policy');
  let original=html.replace(m[0],'');
  if(r.version===2){if(r.readySha256!==hash(READY)||original.split(READY).length!==2)throw Error('HeaderNav: readiness marker changed');original=original.replace(READY,'');}
  if(hash(original)!==r.priorHtmlSha256)throw Error('HeaderNav: original content changed');
  return original;
}
export function copyHeaderNavEmphasis(root,out) {
  const a=headerNavAssets(root);fs.mkdirSync(out+'/s',{recursive:true});fs.writeFileSync(path.join(out,a.asset.slice(1)),a.css);return a;
}
