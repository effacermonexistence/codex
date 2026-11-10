import {createRequire} from 'node:module';
// Source-preserving locale catalogs. No translation provider or network calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createFormUiRuntime} from './form-ui-i18n.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const languages = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/i18n/languages.json'), 'utf8'));
export const languageCodes = new Set(languages.map(x => x.code));
const cartEmptyLabels=JSON.parse(fs.readFileSync(path.join(ROOT,'content/i18n/cart-empty-labels.json'),'utf8'));
if(cartEmptyLabels.schemaVersion!==1||JSON.stringify(cartEmptyLabels.source)!==JSON.stringify({title:'Shopping Cart',empty:'You have nothing in your shopping cart.',continue:'Continue Shopping'}))throw Error('i18n: native empty-cart source identity changed');
for(const language of languageCodes)for(const key of ['title','empty','continue'])if(typeof cartEmptyLabels.translations[language]?.[key]!=='string'||!cartEmptyLabels.translations[language][key])throw Error('i18n: missing native empty-cart UI '+language+':'+key);
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const escape = x => String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',mdash:'—',ndash:'–',hellip:'…',copy:'©',reg:'®',trade:'™',rsquo:'’',lsquo:'‘',rdquo:'”',ldquo:'“',bull:'•',middot:'·',ensp:'\u2002',emsp:'\u2003',thinsp:'\u2009',minus:'−'};
const decode = x => x.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(all,n)=>n[0]==='#'?String.fromCodePoint(n[1].toLowerCase()==='x'?parseInt(n.slice(2),16):parseInt(n.slice(1),10)):(entities[n]??all));
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const SKIP = new Set('script style template noscript svg math code pre textarea'.split(' '));
const BLOCK = new Set('address article aside blockquote div dl dt dd fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p section table tbody td th thead tr ul'.split(' '));
const SEMANTIC = new Set('p h1 h2 h3 h4 h5 h6 li dt dd td th figcaption blockquote button a label legend option summary title'.split(' '));
const PROTECTED = /(?:https?:\/\/|mailto:)[^\s<>]+|\b[0-9a-f]{12,64}\b|\b(?:OmarAGI|Omar AGI|effacermonexistence|REVAS|RCC|ICC|BBEH|KaTeX|MathJax|GitHub|API|LLM|AGI|TAC|accepted_[A-Z])\b|\b(?:[IVXLCDM]{1,10})\b|(?:\$\$[\s\S]*?\$\$|\$[^\n$]+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])|\b\d+(?:[.,:/−–-]\d+)*(?:%|°)?/g;
const TOKEN = /⟦P\d{4,}⟧/g;
export const runtimeAsset = '/s/site-language-'+hash(fs.readFileSync(path.join(ROOT,'content/i18n/site-language.js'))).slice(0,12)+'.js';
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(m=>[m[1].toLowerCase(),m[2]??m[3]??m[4]]));

// Token ranges retain original bytes; translated strings never author HTML.
function parse(html) {
  const root={tag:'#root',children:[],start:0,openEnd:0,endStart:html.length,end:html.length,parent:null};
  const stack=[root], nodes=[], texts=[];
  const re=/<!--[\s\S]*?-->|<!(?:[^>]*?)>|<\/?[A-Za-z][\w:-]*(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g;
  for(const m of html.matchAll(re)) {
    const raw=m[0],at=m.index;
    if(raw.startsWith('<!--')||raw.startsWith('<!'))continue;
    if(/^<\//.test(raw)) {
      const tag=/^<\/([\w:-]+)/.exec(raw)[1].toLowerCase();
      let i=stack.length-1;while(i>0&&stack[i].tag!==tag)i--;
      if(i){for(let j=stack.length-1;j>=i;j--){stack[j].endStart=at;stack[j].end=at+raw.length;}stack.length=i;}
    } else if(/^<[A-Za-z]/.test(raw)) {
      const tag=/^<([\w:-]+)/.exec(raw)[1].toLowerCase();
      const node={tag,attrs:attrs(raw),raw,start:at,openEnd:at+raw.length,endStart:at+raw.length,end:at+raw.length,children:[],parent:stack.at(-1)};
      node.parent.children.push(node);nodes.push(node);
      if(!VOID.has(tag)&&!raw.endsWith('/>'))stack.push(node);
    } else {const n={tag:'#text',start:at,end:at+raw.length,parent:stack.at(-1)};n.parent.children.push(n);texts.push(n);}
  }
  for(const n of stack.slice(1)){n.endStart=html.length;n.end=html.length;}
  return {root,nodes,texts};
}
function excluded(node) {
  for(let n=node;n&&n.tag!=='#root';n=n.parent) {
    if(SKIP.has(n.tag)||n.attrs?.translate==='no'||n.attrs?.['data-i18n-ignore']!==undefined||/(?:^|\s)(?:katex\S*|MathJax\S*|site-language-list)(?:\s|$)/.test(n.attrs?.class||''))return true;
  }
  return false;
}
function hasBlock(node) {return node.children.some(x=>x.tag!=='#text'&&(BLOCK.has(x.tag)||hasBlock(x)));}
function protect(raw) {
  const pieces=[],protectedItems=[];
  const put=(value,kind)=>{const token=`⟦P${String(protectedItems.length).padStart(4,'0')}⟧`;protectedItems.push({token,value,kind});return token;};
  const {nodes}=parse(raw),opaque=nodes.filter(n=>excluded(n)&&!excluded(n.parent)).sort((a,b)=>a.start-b.start);
  let at=0;
  const plain=x=>{
    for(const m of x.matchAll(/<(?:(?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</g)){
      if(m[0].startsWith('<'))pieces.push(put(m[0],'markup'));
      else pieces.push(decode(m[0]).replace(PROTECTED,s=>put(s,'literal')).replace(/&[a-z][a-z0-9]+;/gi,s=>put(s,'entity')));
    }
  };
  for(const n of opaque){if(n.start<at)continue;plain(raw.slice(at,n.start));pieces.push(put(raw.slice(n.start,n.end),'opaque'));at=n.end;}
  plain(raw.slice(at));
  return {source:pieces.join(''),protected:protectedItems};
}
function segment(raw,kind,context) {
  const p=protect(raw),meaning=p.source.replace(TOKEN,'').trim();
  if(!/[\p{L}]/u.test(meaning))return null;
  const stable={kind,source:p.source,protected:p.protected};
  return {id:'s_'+hash(JSON.stringify(stable)).slice(0,20),...stable,context};
}
export function extractPage(html,route='/') {
  const tree=parse(html),slots=[],ranges=[];
  const context=n=>{let at=n;while(at&&!/^h[1-6]$/.test(at.tag))at=at.parent;return {tag:n.tag,route,nearby:decode(html.slice(Math.max(0,n.start-160),Math.min(html.length,n.end+160)).replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').slice(0,340)};};
  for(const n of tree.nodes){
    if(!SEMANTIC.has(n.tag)||excluded(n)||hasBlock(n))continue;
    let parent=n.parent,covered=false;
    while(parent){if(SEMANTIC.has(parent.tag)&&!excluded(parent)&&!hasBlock(parent)){covered=true;break;}parent=parent.parent;}
    if(covered)continue;
    const s=segment(html.slice(n.openEnd,n.endStart),'html',context(n));
    if(s){slots.push({start:n.openEnd,end:n.endStart,segment:s});ranges.push([n.openEnd,n.endStart]);}
  }
  for(const n of tree.texts){
    if(excluded(n)||ranges.some(([s,e])=>n.start>=s&&n.end<=e))continue;
    const s=segment(html.slice(n.start,n.end),'text',context(n));
    if(s)slots.push({start:n.start,end:n.end,segment:s});
  }
  for(const n of tree.nodes){
    if(excluded(n))continue;
    const names=['alt','aria-label','placeholder','title'];
    if(n.tag==='meta'&&/^(?:description|og:title|og:description|twitter:title|twitter:description)$/i.test(n.attrs.name||n.attrs.property||''))names.push('content');
    for(const m of n.raw.matchAll(/\b([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)){
      if(!names.includes(m[1].toLowerCase()))continue;
      const value=m[3]??m[4],s=segment(value,'attribute',{...context(n),attribute:m[1]});
      if(!s)continue;
      const start=n.start+m.index+m[0].indexOf(m[2])+1;
      if(ranges.some(([a,b])=>start>=a&&start+value.length<=b))continue;
      slots.push({start,end:start+value.length,segment:s});
    }
  }
  return slots.sort((a,b)=>a.start-b.start||a.end-b.end);
}

// These are source-grounded literal characters, not translator-authored HTML.
// In particular '<' in an inequality must not be mistaken for an opening tag.
export const literalComparisonSequence = value => value.match(/(?:[<>]=?|!=|={1,3}|[≤≥≠≈≃≡])/g) || [];
const htmlLikeLiteralSequence = value => value.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z][\w:-]*(?:\s+(?:[^<>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g) || [];
export function validateEntry(s,translated) {
  if(typeof translated!=='string'||!translated.trim())throw Error(`${s.id}: missing translation`);
  const actual=translated.match(TOKEN)||[],expected=s.protected.map(p=>p.token);
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`${s.id}: protected tokens missing, duplicated, added, or reordered`);
  if(JSON.stringify(htmlLikeLiteralSequence(translated))!==JSON.stringify(htmlLikeLiteralSequence(s.source)))throw Error(`${s.id}: raw HTML-like tags differ from source; preserve protected markup tokens`);
  if(JSON.stringify(literalComparisonSequence(translated))!==JSON.stringify(literalComparisonSequence(s.source)))throw Error(`${s.id}: literal comparison operators missing, added, reversed or changed`);
  if(/⟦|⟧/.test(translated.replace(TOKEN,'')))throw Error(`${s.id}: malformed protected token`);
  return true;
}
function restore(s,translated) {
  validateEntry(s,translated);
  const map=new Map(s.protected.map(p=>[p.token,p]));
  return translated.split(/(⟦P\d{4,}⟧)/).map(x=>{const p=map.get(x);return p?(p.kind==='literal'?escape(p.value):p.value):escape(x);}).join('');
}
export function translateHtml(html,route,entries={},requireComplete=true) {
  html=prepareTranslationSource(html,route);
  const slots=extractPage(html,route),missing=[...new Set(slots.filter(s=>entries[s.segment.id]===undefined).map(s=>s.segment.id))];
  if(requireComplete&&missing.length)return {html,missing,translated:0,required:slots.length};
  let out=html,translated=0;
  for(const slot of [...slots].reverse()){
    if(entries[slot.segment.id]===undefined)continue;
    const value=restore(slot.segment,entries[slot.segment.id]);
    out=out.slice(0,slot.start)+value+out.slice(slot.end);translated++;
  }
  return {html:out,missing,translated,required:slots.length};
}
export function preserveLocaleLinks(html,language,route='/') {
  const changes=[];
  for(const n of parse(html).nodes){
    if(n.tag!=='a'||excluded(n)||n.attrs['data-site-language-option']!==undefined||n.attrs.download!==undefined)continue;
    const raw=n.attrs.href;
    if(!raw||raw.startsWith('#')||/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw))continue;
    const url=new URL(decode(raw),'https://locale.invalid'+(route.startsWith('/')?route:'/'));
    if(url.pathname.startsWith('/s/')||url.pathname.startsWith('/api/')||/\.[a-z0-9]{1,8}$/i.test(url.pathname))continue;
    url.searchParams.set('lang',language);
    const replacement=url.pathname+url.search+url.hash;
    const m=/\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(n.raw);
    if(m){const start=n.start+m.index+m[0].indexOf(m[1])+1;changes.push({start,end:start+(m[2]??m[3]).length,value:escape(replacement)});}
  }
  for(const c of changes.reverse())html=html.slice(0,c.start)+c.value+html.slice(c.end);
  return html;
}

export const LOCALIZED_TYPOGRAPHY_STYLE='<style id="site-language-typography-v1">'+fs.readFileSync(path.join(ROOT,'content/i18n/typography/fonts.css'),'utf8')+'\n'+fs.readFileSync(path.join(ROOT,'content/i18n/typography/policy.css'),'utf8')+'</style>';

const UI_STYLE=`<style id="site-language-style-v1">
/* The homepage is the visual reference: original wordmark, Gilda Display
   display token, PT Serif actions, black canvas and the same quiet white actions. */
.site-language-footer{text-align:center;padding:0 20px 30px;background:#000;color:rgba(255,246,250,.78);font:400 16px/1.5 "PT Serif",Georgia,serif}
.site-language-trigger[data-site-language-original]{display:none!important}
.site-language-trigger{display:inline-flex;align-items:center;justify-content:center;min-height:44px;box-sizing:border-box;border:1px solid rgba(255,246,250,.46);border-radius:300px;background:transparent;color:inherit;font:inherit;font-weight:400;padding:6px 24px;cursor:pointer;text-decoration:none}
.site-language-trigger:hover{color:#fff;border-color:rgba(255,246,250,.8)}
.site-language-trigger:focus-visible,.site-language-close:focus-visible{outline:1px solid currentColor;outline-offset:5px}
.site-language-dialog{box-sizing:border-box;width:100vw;max-width:none;height:100dvh;max-height:100dvh;margin:0;padding:clamp(68px,7vh,92px) max(28px,calc((100vw - 1040px)/2)) 64px;border:0;border-radius:0;background:#000;color:rgba(255,246,250,.92);font:400 16px/1.5 "PT Serif",Georgia,serif;overflow:auto;overscroll-behavior:contain;direction:ltr}
.site-language-dialog::backdrop{background:#000}
.site-language-dialog *{box-sizing:border-box}
.site-language-heading{display:flex;flex-direction:column;align-items:center;text-align:center;gap:clamp(22px,3vw,34px);margin:0 0 32px}
.site-language-heading::before{content:"";display:block;width:min(540px,100%);aspect-ratio:50/7;flex:none;background:url('/s/wordmark-original-6d82985cb5f1.png') center/contain no-repeat}
.site-language-heading h2{color:inherit;font-family:var(--heading-font-font-family,"Gilda Display",Georgia,serif);font-size:clamp(28px,3.4vw,44px);font-style:normal;font-weight:400;line-height:1.2;letter-spacing:var(--heading-font-letter-spacing,-.02em);margin:0;padding:0;max-width:100%;overflow-wrap:anywhere}
.site-language-close{position:fixed;z-index:1;top:max(18px,env(safe-area-inset-top));right:max(20px,env(safe-area-inset-right));display:flex;align-items:center;justify-content:center;width:44px;height:44px;min-width:44px;min-height:44px;padding:0;border:1px solid rgba(255,246,250,.46);border-radius:50%;background:#000;color:inherit;font:400 25px/1 Georgia,serif;cursor:pointer}
.site-language-dialog .site-language-search{display:block;box-sizing:border-box!important;min-width:0!important;width:100%!important;max-width:520px!important;min-height:48px;margin:0 auto 34px;padding:10px 0;border:0;border-bottom:1px solid rgba(255,246,250,.36);border-radius:0;background:transparent;color:inherit;font:400 16px/1.5 "PT Serif",Georgia,serif;box-shadow:none;outline:none}
.site-language-search::placeholder{color:rgba(255,246,250,.48);opacity:1}
.site-language-dialog .site-language-search:focus{border-bottom-color:rgba(255,246,250,.9)}
.site-language-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px 40px;margin:0;padding:0;list-style:none;direction:ltr}
.site-language-list li{min-width:0;margin:0;padding:0}
.site-language-list li[hidden]{display:none}
.site-language-list a{position:relative;display:flex;flex-direction:column;align-items:stretch;justify-content:center;min-height:68px;margin:0;padding:10px 24px 10px 0;border:0;background:transparent;color:rgba(255,246,250,.82);text-decoration:none;font-family:var(--heading-font-font-family,"Gilda Display",Georgia,serif);font-size:clamp(20px,1.7vw,24px);font-weight:400;line-height:1.3;overflow-wrap:anywhere}
.site-language-list a:hover,.site-language-list a:focus-visible,.site-language-list a[aria-current="true"]{color:#fff;text-decoration:none}
.site-language-list a:focus-visible{outline:1px solid rgba(255,246,250,.65);outline-offset:4px}
.site-language-list small{margin-top:5px;color:rgba(255,246,250,.48);font:400 12px/1.4 "PT Serif",Georgia,serif;letter-spacing:.02em}
.site-language-list a[aria-current="true"]::after{content:'✓';position:absolute;inset:50% 2px auto auto;transform:translateY(-50%);margin:0;color:#fff;font:400 16px/1 Georgia,serif}
.site-language-empty{margin:28px 0;text-align:center;color:rgba(255,246,250,.65)}
.site-language-fallback{padding:12px 24px;background:#202020;color:#eee;font:14px/1.5 "PT Serif",Georgia,serif;text-align:center}
.site-language-dialog [dir=auto]{text-align:start}
html[data-site-language="ar"] .site-language-search{direction:rtl;text-align:right}
html[data-site-language="ar"] main :is(p,h1,h2,h3,h4,h5,h6,li,td,th){direction:rtl}html[data-site-language="ar"] :is(.katex,.katex *,pre,code,math){direction:ltr}html[data-site-language="ar"] .cosmology :is(pre,code,.cosmology-equation,.cosmology-inline-equation){direction:ltr;text-align:left}
@media(max-width:700px){.site-language-dialog{padding:78px 24px 44px}.site-language-heading{gap:24px;margin-bottom:24px}.site-language-heading::before{width:min(360px,100%)}.site-language-heading h2{font-size:28px}.site-language-dialog .site-language-search{margin-bottom:24px}.site-language-list{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 20px}.site-language-list a{min-height:64px;font-size:19px;padding-right:20px}.site-language-close{right:max(18px,env(safe-area-inset-right))}}
@media(prefers-reduced-motion:reduce){.site-language-dialog *{transition:none!important}}
</style>`;
const UI_DIALOG=`<dialog id="site-language-dialog" class="site-language-dialog" aria-labelledby="site-language-title"><div class="site-language-heading"><h2 id="site-language-title">Choose your language</h2><button type="button" class="site-language-close" aria-label="Close language selector"><span translate="no" aria-hidden="true">×</span></button></div><input id="site-language-search" class="site-language-search" type="search" autocomplete="off" placeholder="Search languages" aria-label="Search languages"><ul class="site-language-list" translate="no">${languages.map(l=>`<li data-language-name="${escape(l.nativeName+' '+l.englishName+' '+l.code)}"><a href="?lang=${l.code}" data-site-language-option="${l.code}" hreflang="${l.htmlLang}" lang="${l.htmlLang}"><span dir="auto">${escape(l.nativeName)}</span><small lang="en">${escape(l.englishName)}</small></a></li>`).join('')}</ul><p class="site-language-empty" hidden>No languages found</p></dialog>`;
export const UI_MARKER='site-language-dialog';
const FOOTER_TRIGGER='<div class="site-language-footer" translate="no"><button type="button" class="site-language-trigger" aria-haspopup="dialog" aria-controls="site-language-dialog">Language</button></div>';
const LEGACY_ANCHOR=/<a\b[^>]*>[\s\n]*English · Français[\s\n]*<\/a>/g;
function convertLegacyAnchor(original){
  const encoded=Buffer.from(original,'utf8').toString('base64');
  let button=original.replace(/^<a\b/,'<button type="button" hidden translate="no"').replace(/\s+href="[^"]*"/,'').replace('English · Français','Language').replace(/<\/a>$/,'</button>');
  if(/\bclass="/.test(button))button=button.replace('class="','class="site-language-trigger ');
  else button=button.replace('<button type="button"','<button type="button" class="site-language-trigger"');
  return button.replace('<button type="button"',`<button type="button" data-site-language-original="${encoded}"`);
}
// Only adopted non-English rendering may relax text constraints. Canonical
// English grids, media dimensions/crops and mathematical layout stay untouched.
export const LOCALIZED_LAYOUT_STYLE=`<style id="site-localized-layout-v1">
html[data-site-language]:not([data-site-language="en"]) main .sqs-html-content :is(p,h1,h2,h3,h4,h5,h6,li){overflow-wrap:anywhere;hyphens:auto}
html[data-site-language]:not([data-site-language="en"]) main .sqs-block-button-element{max-inline-size:100%!important;box-sizing:border-box!important;white-space:normal!important;overflow-wrap:anywhere!important;text-align:center}
/* The original theme uses physical right margins: its final Arabic item
   touches its neighbor. Keep the observed1.6vw spacing on the correct axis. */
html[dir="rtl"][data-site-language]:not([data-site-language="en"]) .header-nav-list{column-gap:1.6vw}
html[dir="rtl"][data-site-language]:not([data-site-language="en"]) .header-nav-list>.header-nav-item{margin-left:0!important;margin-right:0!important}
</style>`;
let reflowRules;
export function prepareTranslationSource(html,route){
  if(!reflowRules)reflowRules=JSON.parse(fs.readFileSync(path.join(ROOT,'content/i18n/reflow-rules.json'),'utf8')).rules;
  const byId=new Map(reflowRules.filter(r=>r.route===route).map(r=>[r.id,r]));if(!byId.size)return html;
  const edits=extractPage(html,route).filter(s=>byId.has(s.segment.id));
  for(const slot of edits.reverse()){const r=byId.get(slot.segment.id),raw=html.slice(slot.start,slot.end);if(hash(raw)!==r.sourceRawSha256||raw!==r.raw)throw Error('Localized layout source changed');html=html.slice(0,slot.start)+r.after+html.slice(slot.end)}return html;
}
export function prepareForI18n(html){
  html=html.replace('<div id="site-history-footnote">','<div id="site-history-footnote" translate="no" data-site-fixed-language="1">');
  return html.replace(/<img\b[^>]*\bsrc="[^"]*wordmark-original-[^"]*"[^>]*>/g,tag=>/\btranslate=/.test(tag)?tag:tag.replace(/>$/,' translate="no" data-site-fixed-language="1">'));
}
export function addSiteI18n(html) {
  if(html.includes('id="site-language-dialog"'))return html;
  html=prepareForI18n(html);
  html=html.replace(LEGACY_ANCHOR,tag=>convertLegacyAnchor(tag));
  const trigger=FOOTER_TRIGGER;
  if(!html.includes('</head>')||!html.includes('</body>'))throw Error('i18n: expected complete HTML document');
  const footer=html.lastIndexOf('</footer>');
  html=footer<0?html.replace('</body>',trigger+'</body>'):html.slice(0,footer)+trigger+html.slice(footer);
  return html.replace('</head>',UI_STYLE+'\n'+LOCALIZED_TYPOGRAPHY_STYLE+'\n</head>').replace('</body>',UI_DIALOG+`<script src="${runtimeAsset}" defer></script>\n</body>`);
}
// Exact inverse of the owned static injection, not a broad HTML sanitizer.
// Any unexpected change to an owned component blocks preservation comparison.
export function removeSiteI18n(html){
  if(!html.includes('id="site-language-dialog"'))return html;
  const removeExact=(needle,label)=>{if(html.split(needle).length!==2)throw Error(`i18n preservation: missing, changed or duplicate ${label}`);html=html.replace(needle,'');};
  removeExact(UI_STYLE+'\n','selector style');
  removeExact(LOCALIZED_TYPOGRAPHY_STYLE+'\n','localized typography style');
  removeExact(UI_DIALOG,'selector dialog');
  removeExact(`<script src="${runtimeAsset}" defer></script>\n`,'selector runtime');
  let restored=0;
  html=html.replace(/<button\b[^>]*\bdata-site-language-original="([A-Za-z0-9+/]+={0,2})"[^>]*>[\s\n]*Language[\s\n]*<\/button>/g,(button,encoded)=>{
    const bytes=Buffer.from(encoded,'base64');
    if(bytes.toString('base64')!==encoded)throw Error('i18n preservation: noncanonical original-anchor encoding');
    const original=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    LEGACY_ANCHOR.lastIndex=0;const matches=[...original.matchAll(LEGACY_ANCHOR)];
    if(matches.length!==1||matches[0][0]!==original||convertLegacyAnchor(original)!==button)throw Error('i18n preservation: changed legacy language button');
    restored++;return original;
  });
  removeExact(FOOTER_TRIGGER,'footer trigger');
  if(/\bdata-site-language-original=|id="site-language-(?:dialog|style-v1)"|class="site-language-footer"/.test(html))throw Error('i18n preservation: unrecognized owned markup remains');
  return html.replace(/ translate="no" data-site-fixed-language="1"/g,'');
}
export function copyI18nAssets(root,out) {
  fs.copyFileSync(path.join(root,'content/i18n/site-language.js'),path.join(out,runtimeAsset.slice(1)));
}
export function createCatalog(root=ROOT) {
  const files=[['/',path.join(root,'site/index.html')],...fs.readdirSync(path.join(root,'site/pages')).filter(x=>x.endsWith('.html')&&x!=='exist-fr.html').sort().map(x=>['/'+x.slice(0,-5),path.join(root,'site/pages',x)]),['/404',path.join(root,'site/404.html')]];
  const paint=createRequire(import.meta.url)('./site-paint.cjs').createSitePaint(root);
  const map=new Map(),routes={};
  for(const [route,file] of files){
    const html=prepareTranslationSource(addSiteI18n(paint.render(fs.readFileSync(file,'utf8'),route)),route),ids=[];
    for(const {segment:s}of extractPage(html,route)){
      ids.push(s.id);
      if(!map.has(s.id))map.set(s.id,{...s,routes:[]});
      if(!map.get(s.id).routes.includes(route))map.get(s.id).routes.push(route);
    }
    routes[route]={file:path.relative(root,file),segmentIds:[...new Set(ids)],sourceSha256:hash(html)};
  }
  const segments=[...map.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const sourceCatalogHash=hash(JSON.stringify(segments.map(({id,kind,source,protected:p})=>({id,kind,source,protected:p}))));
  return {schemaVersion:1,sourceLanguage:'en',sourceCatalogHash,scope:'All English website HTML including CODE, Theory, Cosmology and 404; authored French home preserved separately',languages:languages.map(x=>x.code),segmentCount:segments.length,sourceCharacterCount:segments.reduce((n,s)=>n+s.source.length,0),routes,segments};
}
export function writeCatalog(root=ROOT) {
  const catalog=createCatalog(root),dest=path.join(root,'content/i18n/source-catalog.json');
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(catalog,null,2)+'\n');return catalog;
}
export function validateLocale(catalog,data,{allowPartial=false}={}) {
  if(data.schemaVersion!==1||!languageCodes.has(data.locale)||data.locale==='en')throw Error('i18n: invalid locale schema/code');
  if(data.sourceCatalogHash!==catalog.sourceCatalogHash)throw Error('i18n: sourceCatalogHash mismatch; translations need explicit reconciliation');
  if(!data.entries||typeof data.entries!=='object'||Array.isArray(data.entries))throw Error('i18n: entries must be an ID-to-string object');
  const known=new Map(catalog.segments.map(s=>[s.id,s]));
  for(const [id,value]of Object.entries(data.entries)){if(!known.has(id))throw Error('i18n: unknown segment '+id);validateEntry(known.get(id),value);}
  const missing=catalog.segments.filter(s=>data.entries[s.id]===undefined).map(s=>s.id);
  if(missing.length&&!allowPartial)throw Error(`i18n: ${data.locale} missing ${missing.length}/${catalog.segmentCount} segments`);
  return {locale:data.locale,translated:Object.keys(data.entries).length,required:catalog.segmentCount,missing,complete:missing.length===0};
}
export function localeReadiness(root=ROOT,catalog=JSON.parse(fs.readFileSync(path.join(root,'content/i18n/source-catalog.json'),'utf8'))){
  const reports=languages.filter(l=>l.code!=='en').map(l=>{
    const file=path.join(root,'content/i18n/locales',l.code+'.json');
    if(!fs.existsSync(file))return{locale:l.code,status:'missing',translated:0,required:catalog.segmentCount,missing:catalog.segmentCount,complete:false};
    try{
      const data=JSON.parse(fs.readFileSync(file,'utf8')),r=validateLocale(catalog,data,{allowPartial:true});
      const identical=catalog.segments.filter(s=>data.entries[s.id]===s.source).length;
      const unchangedOnly=r.complete&&identical===catalog.segmentCount;
      return{locale:l.code,status:unchangedOnly?'untranslated-source-copy':r.complete?'complete':'partial',translated:r.translated,required:r.required,missing:r.missing.length,identicalSourceEntries:identical,complete:r.complete&&!unchangedOnly};
    }catch(error){return{locale:l.code,status:'invalid',translated:0,required:catalog.segmentCount,missing:catalog.segmentCount,complete:false,error:error.message};}
  });
  const formUi=createFormUiRuntime(root,languageCodes,validateEntry,catalog.sourceCatalogHash).coverage();
  return{sourceCatalogHash:catalog.sourceCatalogHash,requiredLocales:reports.length,completeLocales:reports.filter(x=>x.complete).length,totalEntries:reports.reduce((n,x)=>n+x.translated,0),expectedEntries:catalog.segmentCount*reports.length,locales:reports,formUi,ready:reports.every(x=>x.complete)&&formUi.ready};
}
export function createI18nRuntime(root=ROOT) {
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'content/i18n/source-catalog.json'),'utf8'));
  const knownEnglishIds=new Set(catalog.segments.map(s=>s.id));
  const formUi=createFormUiRuntime(root,languageCodes,validateEntry,catalog.sourceCatalogHash);
  const controlLabels=JSON.parse(fs.readFileSync(path.join(root,'content/i18n/control-labels.json'),'utf8'));
  const dictionaries=new Map(),reports={};
  for(const l of languages.filter(x=>x.code!=='en')){
    const file=path.join(root,'content/i18n/locales',l.code+'.json');
    if(!fs.existsSync(file)){reports[l.code]={complete:false,translated:0,required:catalog.segmentCount};continue;}
    const data=JSON.parse(fs.readFileSync(file,'utf8'));reports[l.code]=validateLocale(catalog,data,{allowPartial:true});dictionaries.set(l.code,data.entries);
  }
  return {
    coverage:()=>({sourceCatalogHash:catalog.sourceCatalogHash,languages:reports,formUi:formUi.coverage()}),
    resolve(url,cookie=''){
      const wanted=url.searchParams.get('lang'),saved=/(?:^|;\s*)effacer_lang=([^;]*)/.exec(cookie)?.[1];
      const pathname=url.pathname.length>1?url.pathname.replace(/\/+$/,''):url.pathname;
      return languageCodes.has(wanted)?wanted:languageCodes.has(saved)?saved:pathname==='/exist-fr'?'fr':'en';
    },
    render(html,route,language){
      html=addSiteI18n(html);let result,status='original',actual='en';
      if(language==='fr'&&route==='/exist-fr'){
        result=translateHtml(html,route,dictionaries.get('fr')||{},false);
        // Native French paragraphs are not missing English translations. Known
        // English interface IDs still require their French dictionary entries.
        result.missing=result.missing.filter(id=>knownEnglishIds.has(id));
        status=result.missing.length?'authored-french-ui-incomplete':'authored-french';actual='fr';
      }else {
        if(language==='en')result={html,missing:[],translated:0};
        else{result=translateHtml(html,route,dictionaries.get(language)||{});if(!result.missing.length){status='translated';actual=language;}else status='unavailable';}
      }
      html=result.html;
      const ui=formUi.localize(html,route,actual);
      html=ui.html;
      if(ui.missing.length&&status!=='unavailable')status+=(status.includes('ui-incomplete')?'-form-pending':'-ui-incomplete');
      const l=languages.find(x=>x.code===actual);
      html=html.replace(/<html\b([^>]*)>/i,(m,a)=>'<html'+a.replace(/\s(?:lang|dir|data-site-language|data-site-requested-language)=(?:"[^"]*"|'[^']*')/gi,'')+` lang="${actual==='en'?'en-US':l.htmlLang}" dir="${l.direction}" data-site-language="${actual}" data-site-requested-language="${language}">`);
      html=html.replace(/(<a\b[^>]*data-site-language-option=")([^"]+)("[^>]*)(>)/g,(m,a,c,b,e)=>a+c+b+(c===language?' aria-current="true"':'')+e);
      if(actual!=='en'){
        const payload={schemaVersion:1,locale:actual,labels:controlLabels.translations[actual]||{}};
        html=html.replace('</body>','<script id="site-language-controls" type="application/json">'+JSON.stringify(payload).replaceAll('<','\\u003c')+'</script></body>');
        html=useLocalizedChapterLinkNames(html,catalog);
        if(route==='/cart')html=html.replace('</body>',`<script type="application/json" id="site-cart-empty-ui-i18n">${JSON.stringify({schemaVersion:1,locale:actual,source:cartEmptyLabels.source,labels:cartEmptyLabels.translations[actual]}).replaceAll('<','\\u003c')}</script>\n</body>`);
        html=html.replace('</head>',LOCALIZED_LAYOUT_STYLE+'\n</head>');
      }
      if(status==='unavailable')html=html.replace(/(<body\b[^>]*>)/i,`$1<aside class="site-language-fallback" role="status">This page is shown in English because its ${escape(languages.find(x=>x.code===language).englishName)} translation is not ready.</aside>`);
      else if(result.missing.length||ui.missing.length)html=html.replace(/(<body\b[^>]*>)/i,'$1<aside class="site-language-fallback" role="status">Original content is preserved. Some interface controls remain in English because their translation is not ready.</aside>');
      // Ordinary links retain their exact hrefs; the first-party cookie carries the choice.
      return {html,language:actual,requestedLanguage:language,status,missing:result.missing.length+ui.missing.length,mainMissing:result.missing.length,formUiMissing:ui.missing.length,formUiStatus:ui.status};
    }
  };
}

// Fourteen source-owned chapter title links redundantly override their visible
// title with an English aria-label inside protected inline markup. On a fully
// localized page the translated visible title is the correct accessible name.
// Match exact known source openings and never alter icon-only or code examples.
export function useLocalizedChapterLinkNames(html,catalog){
  const openings=new Set(catalog.segments.flatMap(s=>s.protected).filter(p=>p.kind==='markup'&&/^<a\b/.test(p.value)&&/\bclass="chapter-title-link"/.test(p.value)&&/\baria-label="Read chapter [IVXLCDM]+"/.test(p.value)).map(p=>p.value));
  const edits=parse(html).nodes.filter(n=>n.tag==='a'&&!excluded(n)&&openings.has(n.raw)&&/[\p{L}]/u.test(decode(html.slice(n.openEnd,n.endStart).replace(/<[^>]*>/g,''))));
  for(const n of edits.reverse())html=html.slice(0,n.start)+n.raw.replace(/\saria-label="Read chapter [IVXLCDM]+"/,'')+html.slice(n.openEnd);
  return html;
}

function cli(){
  const [command,arg,...extra]=process.argv.slice(2);
  if(command==='extract') {const c=writeCatalog();console.log(JSON.stringify({sourceCatalogHash:c.sourceCatalogHash,segments:c.segmentCount,sourceCharacters:c.sourceCharacterCount,routes:Object.keys(c.routes).length}));}
  else if(command==='validate') {const c=JSON.parse(fs.readFileSync(path.join(ROOT,'content/i18n/source-catalog.json'),'utf8')),d=JSON.parse(fs.readFileSync(path.resolve(arg),'utf8'));console.log(JSON.stringify(validateLocale(c,d,{allowPartial:extra.includes('--allow-partial')})));}
  else if(command==='batches') {
    const c=JSON.parse(fs.readFileSync(path.join(ROOT,'content/i18n/source-catalog.json'),'utf8')),dir=path.resolve(arg),max=Number(extra[0]||18000);fs.mkdirSync(dir,{recursive:true});let batch=[],size=0,n=0;
    const flush=()=>{if(!batch.length)return;fs.writeFileSync(path.join(dir,`batch-${String(++n).padStart(3,'0')}.json`),JSON.stringify({schemaVersion:1,sourceCatalogHash:c.sourceCatalogHash,instructions:'Translate each source naturally in paragraph context. Return entries keyed by id. Preserve every ⟦P0000⟧ token exactly once in its original order. No raw HTML, invented claims, omitted sentences, or changed proof labels. Technical glossary: downlift means performance degradation relative to baseline; no downlift means no performance degradation, NOT no improvement or no reduction of error. Protected tokens include markup, math, code, identifiers and numbers.',segments:batch},null,2)+'\n');batch=[];size=0;};
    for(const s of c.segments){if(size+s.source.length>max)flush();batch.push(s);size+=s.source.length;}flush();console.log(JSON.stringify({batches:n,directory:dir,sourceCatalogHash:c.sourceCatalogHash}));
  } else if(command==='merge') {
    const c=JSON.parse(fs.readFileSync(path.join(ROOT,'content/i18n/source-catalog.json'),'utf8')),locale=arg,dest=path.join(ROOT,'content/i18n/locales',locale+'.json');
    const previous=fs.existsSync(dest)?JSON.parse(fs.readFileSync(dest,'utf8')):null;
    if(previous&&(previous.sourceCatalogHash!==c.sourceCatalogHash||previous.locale!==locale))throw Error('existing locale provenance mismatch; reconcile explicitly before merge');
    let entries=previous?previous.entries:{};
    for(const file of extra){const d=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));if(d.sourceCatalogHash!==c.sourceCatalogHash)throw Error('batch sourceCatalogHash mismatch');if(d.locale!==locale)throw Error('batch locale mismatch');for(const [id,value]of Object.entries(d.entries||{})){if(entries[id]!==undefined&&entries[id]!==value)throw Error('conflicting translation '+id);entries[id]=value;}}
    const d={schemaVersion:1,locale,sourceCatalogHash:c.sourceCatalogHash,method:'Codex included quota; saved translation catalog',entries};const report=validateLocale(c,d,{allowPartial:true});fs.writeFileSync(dest,JSON.stringify(d,null,2)+'\n');console.log(JSON.stringify(report));
  } else if(command==='coverage') {console.log(JSON.stringify(createI18nRuntime().coverage(),null,2));}
  else throw Error('Usage: node scripts/site-i18n.mjs extract | batches DIR [CHAR_LIMIT] | validate FILE [--allow-partial] | merge LOCALE FILE... | coverage');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))cli();
