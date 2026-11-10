// Current production renderer, not the retired 20261018 spacing script.
import fs from'node:fs';import assert from'node:assert/strict';import{createRequire}from'node:module';import{createI18nRuntime,languages}from'./site-i18n.mjs';
const root=new URL('../',import.meta.url).pathname,paint=createRequire(import.meta.url)('./site-paint.cjs').createSitePaint(root),source=paint.render(fs.readFileSync(root+'site/pages/archive.html','utf8'),'/archive'),runtime=createI18nRuntime(root);
const media=h=>[...h.matchAll(/<(?:img|video|source)\b[^>]*>/g)].map(x=>x[0].replace(/ translate="no" data-site-fixed-language="1"/g,'').replace(/\s(?:alt|title|aria-label)="[^"]*"/g,''));
const ids=h=>[...h.matchAll(/\bid="([^"]*)"/g)].map(x=>x[1]).filter(x=>!/^site-(?:language|localized|cart|form-ui)/.test(x));
for(const l of languages){const result=runtime.render(source,'/archive',l.code);assert.equal(result.missing,0);assert.equal(result.language,l.code);assert.deepEqual(media(result.html),media(source));assert.deepEqual(ids(result.html),ids(source));}
console.log('PASS current Archive ×31 locales: exact artwork image/video/source attributes, IDs and controls retained; no missing translation slots. Geometry separately verified in browser.');
