import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {extractPage,translateHtml,validateEntry,validateLocale,addSiteI18n,removeSiteI18n,preserveLocaleLinks,createI18nRuntime,localeReadiness,languages,runtimeAsset,useLocalizedChapterLinkNames} from './site-i18n.mjs';

let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
const document=body=>`<!doctype html><html lang="en-US"><head><title>Research page</title></head><body>${body}</body></html>`;
const html=document('<h1>A new frame</h1><p id="essay">The <strong>result</strong> was 42% with <span class="katex"><math><mi>x</mi></math><span>x</span></span> and <code>accepted_B=0</code>.</p><a href="/code" aria-label="Read the essays">Read essays</a><script>const message="Must stay unchanged";</script><style>.x{color:red}</style>');
function entriesFor(source,fn=s=>'Translated '+s.source){return Object.fromEntries(extractPage(source,'/test').map(({segment:s})=>[s.id,fn(s)]));}

test('whole paragraph with protected tags, numeric evidence, math, and code',()=>{
  const s=extractPage(html,'/test').find(x=>x.segment.source.includes('The ')).segment;
  assert(s.source.includes('result'));
  assert(s.protected.some(p=>p.value==='42%'));
  assert(s.protected.some(p=>p.value.includes('class="katex"')));
  assert(s.protected.some(p=>p.value==='<code>accepted_B=0</code>'));
  const out=translateHtml(html,'/test',entriesFor(html)).html;
  assert(out.includes('<strong>result</strong>'));
  assert(out.includes('42%'));
  assert(out.includes('<span class="katex"><math><mi>x</mi></math><span>x</span></span>'));
  assert(out.includes('<code>accepted_B=0</code>'));
  assert(out.includes('<script>const message="Must stay unchanged";</script>'));
  assert(out.includes('<style>.x{color:red}</style>'));
});
test('missing translation atomically preserves source, not a partial success',()=>{
  const result=translateHtml(html,'/test',{});
  assert.equal(result.html,html);assert(result.missing.length>0);assert.equal(result.translated,0);
});
test('duplicate, reordered, omitted tokens and authored HTML rejected',()=>{
  const s=extractPage(html,'/test').find(x=>x.segment.protected.length>2).segment;
  assert.throws(()=>validateEntry(s,s.source.replace(s.protected[0].token,'')),/protected tokens/);
  assert.throws(()=>validateEntry(s,s.source+s.protected[0].token),/protected tokens/);
  assert.throws(()=>validateEntry(s,s.source.replace(s.protected[0].token,'TMP').replace(s.protected[1].token,s.protected[0].token).replace('TMP',s.protected[1].token)),/protected tokens/);
  assert.throws(()=>validateEntry(s,'<script>x</script>'+s.source),/raw HTML/);
});
test('source inequality literals remain valid while comparator mutations fail',()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../content/i18n/source-catalog.json',import.meta.url)));
  const first=catalog.segments.find(s=>s.id==='s_16f5051cde884953afa0');
  const second=catalog.segments.find(s=>s.id==='s_1f56255648de7166b437');
  assert(first&&second);
  assert.equal(validateEntry(first,first.source.replace('slow, cautious formation','느리고 신중한 형성')),true);
  assert.equal(validateEntry(second,second.source.replace('with','다음 조건에서')),true);
  for(const s of catalog.segments.filter(s=>/[<>]/.test(s.source)))assert.equal(validateEntry(s,s.source),true);
  assert.throws(()=>validateEntry(first,first.source.replace('<','>')),/comparison operators/);
  assert.throws(()=>validateEntry(first,first.source.replace('<','')),/comparison operators/);
  assert.throws(()=>validateEntry(first,first.source.replace('<','<=')),/comparison operators/);
  assert.throws(()=>validateEntry(first,first.source+' > extra'),/comparison operators/);
  assert.throws(()=>validateEntry(first,first.source.replace('<','≤')),/comparison operators/);
  const ordinary={id:'comparison-fixture',source:'The result holds.',protected:[]};
  assert.throws(()=>validateEntry(ordinary,'결과 < 한계'),/comparison operators/);
  assert.throws(()=>validateEntry(ordinary,'<em>새 태그</em>'),/raw HTML/);
  assert.throws(()=>validateEntry(first,'<span>'+first.source+'</span>'),/raw HTML/);
});
test('source-authored literal tag text remains escaped, never becomes new markup',()=>{
  const source=document('<p>Print &lt;em&gt;literal&lt;/em&gt; exactly.</p>');
  const slots=extractPage(source),entry=slots.find(x=>x.segment.source.includes('Print')).segment;
  const translated=entry.source.replace('Print','표시').replace('exactly','정확하게');
  assert.equal(validateEntry(entry,translated),true);
  assert.throws(()=>validateEntry(entry,translated.replaceAll('<em>','<strong>').replaceAll('</em>','</strong>')),/raw HTML/);
  const entries=Object.fromEntries(slots.map(x=>[x.segment.id,x.segment.id===entry.id?translated:x.segment.source]));
  const result=translateHtml(source,'/',entries);
  assert(result.html.includes('&lt;em&gt;literal&lt;/em&gt;'));
  assert(!result.html.includes('<em>literal</em>'));
});
test('segment IDs stable across routes and sibling layout changes',()=>{
  const p='<p>One complete paragraph <em>with emphasis</em>.</p>';
  const a=extractPage(document(p),'/one').find(x=>x.segment.source.includes('complete'));
  const b=extractPage(document('<div class="different">'+p+'</div>'),'/two').find(x=>x.segment.source.includes('complete'));
  assert.equal(a.segment.id,b.segment.id);
});
test('translation slots never overlap inline accessibility attributes',()=>{
  const slots=extractPage(document('<p>Visit <a href="/code" title="Read more">the code</a> today.</p>'),'/test');
  for(let i=1;i<slots.length;i++)assert(slots[i].start>=slots[i-1].end);
});
test('native names, SVG, no-translate content, and source files preserved',()=>{
  const h=document('<p translate="no">OmarAGI private identity</p><svg><text>Drawing label</text></svg><pre>verifier(x)</pre><p>Readable prose</p>');
  const sources=extractPage(h).map(x=>x.segment.source).join(' ');
  assert(!sources.includes('private identity'));assert(!sources.includes('Drawing label'));assert(!sources.includes('verifier'));
});
test('selector injected once on any complete route including404',()=>{
  const out=addSiteI18n(document('<p>Not found</p>'));
  assert.equal(addSiteI18n(out),out);
  assert.equal((out.match(/<dialog /g)||[]).length,1);
  assert(out.includes('aria-controls="site-language-dialog"'));
  assert(out.includes('src="'+runtimeAsset+'"'));
  assert.equal((out.match(/data-site-language-option=/g)||[]).length,31);
});
test('legacy French link becomes Language without changing unrelated anchors',()=>{
  const out=addSiteI18n(document('<a class="native" href="/exist-fr">English · Français</a><a href="/code">Code</a>'));
  assert(out.includes('class="site-language-trigger native">Language</button>'));
  assert(out.includes('data-site-language-original="'));
  assert(out.includes('<a href="/code">Code</a>'));assert(!out.includes('English · Français'));
});
test('exact reversible injection restores original anchors and unrelated bytes',()=>{
  for(const source of [document('<p>Unrelated content must survive.</p>'),document('<a class="native" href="/exist-fr">\n English · Français\n</a><p id="keep">Exact &amp; unchanged.</p>'),document('<a href="/">English · Français</a>')])assert.equal(removeSiteI18n(addSiteI18n(source)),source);
  const original=document('<p>Original paragraph.</p>'),added=addSiteI18n(original);
  assert.equal(removeSiteI18n(added.replace('Original paragraph.','An independent edit.')),original.replace('Original paragraph.','An independent edit.'));
  assert.throws(()=>removeSiteI18n(added.replace('.site-language-footer{text-align:center','.site-language-footer{text-align:left')),/changed or duplicate selector style/);
  assert.throws(()=>removeSiteI18n(added.replace('Choose your language','Changed dialog')),/changed or duplicate selector dialog/);
  const withAnchor=addSiteI18n(document('<a href="/exist-fr">English · Français</a>'));
  assert.throws(()=>removeSiteI18n(withAnchor.replace('class="site-language-trigger"','class="tampered"')),/changed legacy language button/);
});
test('release readiness requires all30 real dictionary shapes, not field presence or English copies',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'effacer-i18n-readiness-'));
  try{
    fs.mkdirSync(path.join(tmp,'content/i18n/locales'),{recursive:true});
    const segments=extractPage(document('<p>A complete source sentence.</p>')).map(x=>x.segment),catalog={sourceCatalogHash:'fixture',segments,segmentCount:segments.length};
    fs.writeFileSync(path.join(tmp,'content/i18n/form-ui-source.json'),JSON.stringify({schemaVersion:1,parentSourceCatalogHash:'fixture',sourceCatalogHash:'empty-form-fixture',segments:[],scripts:[],segmentCount:0}));
    assert.equal(localeReadiness(tmp,catalog).ready,false);
    for(const l of languages.filter(x=>x.code!=='en'))fs.writeFileSync(path.join(tmp,'content/i18n/locales',l.code+'.json'),JSON.stringify({schemaVersion:1,locale:l.code,sourceCatalogHash:'fixture',entries:Object.fromEntries(segments.map(s=>[s.id,'SYNTHETIC FIXTURE '+s.source]))}));
    assert.equal(localeReadiness(tmp,catalog).ready,true);
    const copied={schemaVersion:1,locale:'ko',sourceCatalogHash:'fixture',entries:Object.fromEntries(segments.map(s=>[s.id,s.source]))};
    fs.writeFileSync(path.join(tmp,'content/i18n/locales/ko.json'),JSON.stringify(copied));
    assert.equal(localeReadiness(tmp,catalog).ready,false);
    assert.equal(localeReadiness(tmp,catalog).locales.find(x=>x.locale==='ko').status,'untranslated-source-copy');
    fs.writeFileSync(path.join(tmp,'content/i18n/locales/ko.json'),JSON.stringify({...copied,sourceCatalogHash:'stale'}));
    assert.equal(localeReadiness(tmp,catalog).locales.find(x=>x.locale==='ko').status,'invalid');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('locale links retain route/query/hash and exclude API, raw research, external URLs',()=>{
  const h=document('<a href="/code?x=1#section">Code</a><a href="/s/source.md">Source</a><a href="/api/test">API</a><a href="https://example.com">External</a><a href="#math">Jump</a><a href="?lang=ko" data-site-language-option="ko">한국어</a>');
  const out=preserveLocaleLinks(h,'fr','/theory');
  assert(out.includes('href="/code?x=1&amp;lang=fr#section"'));
  for(const href of ['/s/source.md','/api/test','https://example.com','#math','?lang=ko'])assert(out.includes('href="'+href+'"'));
});
test('catalog hash, unknown segment and coverage gates',()=>{
  const segments=extractPage(document('<p>Complete source</p>')).map(x=>x.segment),catalog={sourceCatalogHash:'testhash',segments,segmentCount:segments.length};
  const data={schemaVersion:1,locale:'ko',sourceCatalogHash:'testhash',entries:Object.fromEntries(segments.map(s=>[s.id,'번역 '+s.source]))};
  assert.equal(validateLocale(catalog,data).complete,true);
  assert.throws(()=>validateLocale(catalog,{...data,sourceCatalogHash:'stale'}),/Hash mismatch/);
  assert.throws(()=>validateLocale(catalog,{...data,entries:{unknown:'text'}}),/unknown segment/);
  assert.throws(()=>validateLocale(catalog,{...data,entries:{}}),/missing/);
});
test('31 locales exactly match verified Apple script-normalized coverage',()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../content/i18n/apple-language-coverage.json',import.meta.url)));
  assert.deepEqual(languages.map(x=>x.code).sort(),source.languages_with_chinese_scripts_separate.sort());
});
test('runtime query/cookie/English fallback is explicit; authored French retained',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'effacer-i18n-test-'));
  try{
    fs.mkdirSync(path.join(tmp,'content/i18n/locales'),{recursive:true});fs.mkdirSync(path.join(tmp,'site/pages'),{recursive:true});
    const knownUiSegments=extractPage(addSiteI18n(document(''))).map(x=>x.segment);
    fs.writeFileSync(path.join(tmp,'content/i18n/source-catalog.json'),JSON.stringify({sourceCatalogHash:'fixture',segments:knownUiSegments,segmentCount:knownUiSegments.length}));
    fs.writeFileSync(path.join(tmp,'site/pages/exist-fr.html'),document('<p>Un texte français approuvé.</p>'));
    fs.writeFileSync(path.join(tmp,'site/index.html'),document('<p>The original home.</p>'));
    fs.writeFileSync(path.join(tmp,'content/i18n/control-labels.json'),JSON.stringify({schemaVersion:1,translations:{}}));const runtime=createI18nRuntime(tmp);
    assert.equal(runtime.resolve(new URL('https://example.com/code?lang=ko'),'effacer_lang=fr'),'ko');
    assert.equal(runtime.resolve(new URL('https://example.com/code'),'effacer_lang=fr'),'fr');
    assert.equal(runtime.resolve(new URL('https://example.com/code?lang=../bad'),'effacer_lang=fr'),'fr');
    assert.equal(runtime.resolve(new URL('https://example.com/code')),'en');
    assert.equal(runtime.resolve(new URL('https://example.com/exist-fr')),'fr');
    assert.equal(runtime.resolve(new URL('https://example.com/exist-fr/')),'fr');
    const result=runtime.render(document('<p>Untranslated source</p>'),'/code','ar');
    assert.equal(result.language,'en');assert.equal(result.status,'unavailable');assert(result.missing>0);
    assert(result.html.includes('because its Arabic translation is not ready'));
    assert(result.html.includes('dir="ltr" data-site-language="en" data-site-requested-language="ar"'));
    assert(!result.html.includes('id="site-localized-layout-v1"'));
    const french=runtime.render(document('<p>Un texte français approuvé.</p>'),'/exist-fr','fr');
    assert.equal(french.status,'authored-french-ui-incomplete');assert(french.missing>0);assert.equal(french.language,'fr');assert(french.html.includes('Un texte français approuvé.'));
    assert(french.html.includes('id="site-localized-layout-v1"'));
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('localized chapter link names use translated visible text, not redundant English labels',()=>{
  const opening='<a class="chapter-title-link" href="/cosmology-overview" aria-label="Read chapter I">';
  const catalog={segments:[{protected:[{kind:'markup',value:opening}]}]};
  const source=opening+'제 I장 —</a>';
  assert.equal(useLocalizedChapterLinkNames(source,catalog),'<a class="chapter-title-link" href="/cosmology-overview">제 I장 —</a>');
  const icon='<a href="/elsewhere" aria-label="Read chapter I"><svg></svg></a>';
  assert.equal(useLocalizedChapterLinkNames(icon,catalog),icon);
  const code='<pre>'+source+'</pre>';
  assert.equal(useLocalizedChapterLinkNames(code,catalog),code);
  const blank=opening+'<span></span></a>';
  assert.equal(useLocalizedChapterLinkNames(blank,catalog),blank);
});
test('native empty cart uses scoped display payload without changing native configuration',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'effacer-cart-i18n-test-'));
  try{
    fs.mkdirSync(path.join(tmp,'content/i18n/locales'),{recursive:true});
    const config='<script type="application/json">{"storeCurrency":"USD","shopperLanguage":"en","translationLocale":"en-US"}</script>';
    const html=addSiteI18n(document('<div id="sqs-cart-root">'+config+'<div id="sqs-cart-container"></div></div>'));
    const segments=extractPage(html,'/cart').map(x=>x.segment);
    fs.writeFileSync(path.join(tmp,'content/i18n/source-catalog.json'),JSON.stringify({sourceCatalogHash:'fixture',segments,segmentCount:segments.length}));
    fs.writeFileSync(path.join(tmp,'content/i18n/locales/ko.json'),JSON.stringify({schemaVersion:1,locale:'ko',sourceCatalogHash:'fixture',entries:Object.fromEntries(segments.map(s=>[s.id,'한국어 '+s.source]))}));
    fs.writeFileSync(path.join(tmp,'content/i18n/control-labels.json'),JSON.stringify({schemaVersion:1,translations:{}}));const runtime=createI18nRuntime(tmp),en=runtime.render(html,'/cart','en'),ko=runtime.render(html,'/cart','ko');
    assert(en.html.includes(config));assert(ko.html.includes(config));
    assert(!en.html.includes('id="site-cart-empty-ui-i18n"'));
    assert(ko.html.includes('id="site-cart-empty-ui-i18n"'));
    assert(ko.html.includes('"title":"장바구니"'));
    assert(!runtime.render(html,'/code','ko').html.includes('id="site-cart-empty-ui-i18n"'));
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
console.log(`${passed} source-preserving i18n unit tests passed. No site build, deployment, translation-provider call or customer operation was performed.`);
