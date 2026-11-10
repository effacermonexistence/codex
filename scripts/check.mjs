import {removeHomeCernLayout,homeCernLayoutAssets} from './home-cern-layout.mjs';
import {checkCosmologySerif} from './check-cosmology-serif.mjs';
import {removeHomeCernType,homeCernAssets,HOME_CERN_ROUTES} from './home-cern-type.mjs';
import {removeArchiveViewport,archiveViewportAssets} from './archive-viewport.mjs';
import {checkArchiveViewport} from './check-archive-viewport.mjs';
import {removeMuseumTypography} from './museum-typography.mjs';
import {removeSiteSerif} from './site-serif.mjs';
import {checkSiteSerif} from './check-site-serif.mjs';
import crypto from 'node:crypto';
import {checkContinuous} from './check-continuous-render.mjs';
import './check-site-presentation.mjs';
// Verifies site/ against snapshot/ and content/chapters.json.
//   node scripts/check.mjs                 static checks only
//   node scripts/check.mjs http://host:p   static checks + HTTP checks against a running server
//   --allow-incomplete-locales is an explicit local/staging-only check mode.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {readArchiveWork,renderArchiveWork,removeArchiveWorkForComparison,ARCHIVE_STYLE} from './archive-work.mjs';
import {rewriteWordmarkReferences,SITE_LINE_STYLE,WORDMARK_REFERENCE,WORDMARK_ASSET,WORDMARK_SHA256} from './site-presentation.mjs';
import {removeArchiveSpacing,spacingMarkup,readArchiveSpacing} from './archive-spacing.mjs';
import {addSiteI18n,removeSiteI18n,createCatalog,createI18nRuntime,localeReadiness,languages,runtimeAsset} from './site-i18n.mjs';
import {collectFormUi} from './form-ui-i18n.mjs';
import {checkReviewedEntries} from './reviewed-i18n.mjs';
import {addHomeHero,removeHomeHero,heroConfig} from './home-hero.mjs';
import {addHomeCircles,removeHomeCircles,circlesConfig} from './home-circles.mjs';
import {addHomeArtworkMotion,removeHomeArtworkMotion,artworkMotionConfig} from './home-artwork-motion.mjs';
import {removeHomeFullfield} from './home-fullfield.mjs';
import {removeTheoryTalekEntry} from './theory-talek-entry.mjs';
import {removeContinuousCta,readContinuousWorks,continuousRoutes,buildContinuousRender} from './continuous-render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const snap = path.join(root, 'snapshot');
const manifest = JSON.parse(fs.readFileSync(path.join(snap, 'manifest.json'), 'utf8'));
const chapters = JSON.parse(fs.readFileSync(path.join(root, 'content', 'chapters.json'), 'utf8')).chapters;
const args = process.argv.slice(2);
const allowIncompleteLocales = args.includes('--allow-incomplete-locales');
const unknownFlags = args.filter(x => x.startsWith('--') && x !== '--allow-incomplete-locales');
const urlArgs = args.filter(x => !x.startsWith('--'));
if (unknownFlags.length || urlArgs.length > 1) throw Error('usage: node scripts/check.mjs [http://host:port] [--allow-incomplete-locales]');
const baseUrl = urlArgs[0];
console.log('Continuous Render:',JSON.stringify(checkContinuous(root)));

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};
// Validate the serif layer independently above, then compare every older
// presentation contract against its exact reversible input, not a new wrapper.
const read = (file) => file.endsWith('.html') ? removeSiteSerif(removeArchiveViewport(removeHomeCernType(removeHomeCernLayout(fs.readFileSync(file, 'utf8'))))) : fs.readFileSync(file, 'utf8');
const preservedHtml = (file) => {
  const html = removeSiteSerif(read(file));
  try { return removeHomeHero(removeHomeCircles(removeHomeArtworkMotion(removeHomeFullfield(removeContinuousCta(removeTheoryTalekEntry(removeMuseumTypography(removeSiteI18n(html)))))))); }
  catch (error) { fail(`${path.relative(site,file)}: ${error.message}`); return html; }
};
const fileFor = (route) => path.join(site, route === '/' ? 'index.html' : `pages/${route.slice(1)}.html`);
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

const chapterSlugs = new Set(chapters.map((c) => `/${c.slug}`));
const cosmologyManifest = JSON.parse(read(path.join(root, 'content/cosmology-manifest.json')));
console.log('Cosmology serif:',JSON.stringify(checkCosmologySerif(root)));
const cosmologyRoutes = new Set(['/talek-1-2', '/cosmology-source-index', ...cosmologyManifest.chapters.map(c => '/'+c.slug)]);
const tattooRoutes = continuousRoutes(root);
const routes = new Set(['/', ...Object.keys(manifest.pages), ...chapterSlugs, ...cosmologyRoutes, ...tattooRoutes]);
for(const route of [...routes,'404']){const p=route==='404'?path.join(site,'404.html'):fileFor(route),h=fs.readFileSync(p,'utf8');if(/data-museum-type=|data-site-serif=|data-archive-viewport=|id="(?:museum-typography-css|site-serif-policy|archive-viewport-runtime)"/.test(h))throw Error('Owner-rejected redesign re-entered '+route);}
// New homepage-only type policy is verified independently, then removed from
// legacy comparison input through its strict exact-inverse receipt.
let homeCernCount=0;
for(const route of [...routes,'404']){
 const p=route==='404'?path.join(site,'404.html'):fileFor(route),h=fs.readFileSync(p,'utf8');
 const adopted=h.includes('data-home-cern-type=');
 if(adopted!==HOME_CERN_ROUTES.has(route))throw Error('home-cern scope '+route);
 if(adopted){removeHomeCernType(removeHomeCernLayout(h));homeCernCount++;}
}
if(homeCernCount!==3)throw Error('home-cern expected exactly three homepage aliases');
const ca=homeCernAssets(root);
if(fs.readFileSync(path.join(site,ca.asset.slice(1)),'utf8')!==ca.css)throw Error('home-cern delivered CSS differs');
for(const f of ca.manifest.faces)if(crypto.createHash('sha256').update(fs.readFileSync(site+'/s/'+f.file)).digest('hex')!==f.sha256)throw Error('home-cern delivered font differs');
console.log('Homepage CERN typography: three exact-inverse aliases, self-hosted canonical Gilda family; other routes untouched');

const cl=homeCernLayoutAssets(root);let clCount=0;
for(const route of [...routes,'404']){
 const p=route==='404'?path.join(site,'404.html'):fileFor(route),h=fs.readFileSync(p,'utf8');
 const adopted=h.includes('data-home-cern-layout="1"');
 if(adopted!==HOME_CERN_ROUTES.has(route))throw Error('CERN editorial layout scope '+route);
 if(adopted){removeHomeCernLayout(h);if((h.match(/<article class="home-cern-layout-panel"/g)||[]).length!==9)throw Error('CERN editorial panel coverage');const source=cl.config.routes.find(x=>x.route===route),id=source.protectedLanding.sectionId;if(h.includes('data-home-cern-layout-section="'+id+'"')||h.includes('data-home-cern-layout-content="'+id+'"'))throw Error('Protected first landing was adapted');clCount++;}
}
if(clCount!==3||fs.readFileSync(site+cl.asset,'utf8')!==cl.css)throw Error('CERN editorial layout assets');
console.log('Homepage CERN composition: nine middle panels x three aliases; original first landing excluded; exact inverse preserved');

const files = new Set([...Object.keys(manifest.files), ...fs.readdirSync(path.join(site,'s')).filter(f=>f.startsWith('cosmology-')).map(f=>'/s/'+f)]);
const tattooWorks=readContinuousWorks(root).works;
for(const w of tattooWorks) files.add(w.image.url);
const archiveWork = readArchiveWork(root);
for (const image of archiveWork.images) files.add('/s/'+image.file);
files.add('/s/failed-rendering-manifest.json');
files.add(WORDMARK_ASSET);
files.add('/s/archive-spacing.js');
files.add(runtimeAsset);
const homeHero = heroConfig(root);
const homeHeroRoutes = new Set(['/','/exist','/exist-fr']);
files.add(homeHero.posterAsset);
files.add(homeHero.runtimeAsset);

// The accepted moving background is one exact reversible transformation on
// three homepage aliases, not authority to alter any other page or content.
let homeHeroPages = 0;
for (const route of [...routes,'404']) {
  const html = read(route==='404'?path.join(site,'404.html'):fileFor(route));
  const owned = /effacer-home-hero-original:|data-effacer-hero=|id="effacer-home-hero-(?:soft-v1|runtime)"/.test(html);
  if (!homeHeroRoutes.has(route)) {
    if (owned) fail(`${route}: homepage-only background leaked onto a non-homepage route`);
    continue;
  }
  try {
    const native = removeHomeCircles(removeHomeArtworkMotion(removeHomeFullfield(removeMuseumTypography(removeSiteI18n(html)))));
    const original = removeHomeHero(native);
    if (!owned || original===native || addHomeHero(original,root,route)!==native) fail(`${route}: homepage background is missing, changed, duplicated or not exactly reversible`);
    else homeHeroPages++;
  } catch(error) { fail(`${route}: ${error.message}`); }
}
if (homeHeroPages!==3) fail(`hero: expected exactly3 adopted homepage routes, found ${homeHeroPages}`);
for (const [asset,expected] of [[homeHero.posterAsset,homeHero.poster],[homeHero.runtimeAsset,homeHero.runtime]]) {
  const delivered=path.join(site,asset.slice(1));
  if (!fs.existsSync(delivered) || !expected.equals(fs.readFileSync(delivered))) fail(`hero: built asset differs from authoritative source ${asset}`);
}
console.log(`hero: exact reversible approved background on ${homeHeroPages} homepage routes; non-homepage routes excluded; pinned video source and local asset bytes checked`);

// Each circle has its own pinned source and retains the original clipped image.
const homeCircles=circlesConfig(root);
files.add(homeCircles.runtimeAsset);
let homeCirclePages=0;
for(const route of [...routes,'404']) {
  const html=read(route==='404'?path.join(site,'404.html'):fileFor(route));
  const owned=/effacer-home-circle-original:|data-effacer-circle=|id="effacer-home-circles-/.test(html);
  if(!homeHeroRoutes.has(route)) {
    if(owned)fail(`${route}: homepage-only circular videos leaked onto a non-homepage route`);
    continue;
  }
  try {
    const native=removeHomeArtworkMotion(removeHomeFullfield(removeMuseumTypography(removeSiteI18n(html)))),original=removeHomeCircles(native);
    if(!owned||original===native||addHomeCircles(original,root,route)!==native)fail(`${route}: circular videos are missing, changed, duplicated or not exactly reversible`);
    else homeCirclePages++;
  }catch(error){fail(`${route}: ${error.message}`);}
}
if(homeCirclePages!==3)fail(`circles: expected exactly3 adopted homepage routes, found ${homeCirclePages}`);
const circleRuntimeFile=path.join(site,homeCircles.runtimeAsset.slice(1));
if(!fs.existsSync(circleRuntimeFile)||!homeCircles.runtime.equals(fs.readFileSync(circleRuntimeFile)))fail('circles: built runtime differs from source');
console.log(`circles: two independent pinned videos on ${homeCirclePages} homepage routes; native source reversal and runtime bytes checked`);

// Additive remaining-artwork motion is restricted to three native circles on
// each homepage alias. Native images/links/masks remain the reversible floor.
const homeArtwork=artworkMotionConfig(root);
files.add(homeArtwork.runtimeAsset);
let homeArtworkPages=0;
for(const route of [...routes,'404']) {
  const html=read(route==='404'?path.join(site,'404.html'):fileFor(route));
  const owned=/effacer-home-artwork-original:|data-effacer-artwork=|id="effacer-home-artwork-/.test(html);
  if(!homeHeroRoutes.has(route)) {
    if(owned)fail(`${route}: remaining-artwork motion leaked onto a non-homepage route`);
    continue;
  }
  try {
    const native=removeHomeFullfield(removeMuseumTypography(removeSiteI18n(html))),original=removeHomeArtworkMotion(native);
    if(!owned||original===native||addHomeArtworkMotion(original,root,route)!==native)fail(`${route}: artwork motion missing, changed, duplicated or not exactly reversible`);
    else homeArtworkPages++;
  }catch(error){fail(`${route}: ${error.message}`);}
}
if(homeArtworkPages!==3)fail(`artwork motion: expected exactly3 adopted homepage routes, found ${homeArtworkPages}`);
const artworkRuntimeFile=path.join(site,homeArtwork.runtimeAsset.slice(1));
if(!fs.existsSync(artworkRuntimeFile)||!homeArtwork.runtime.equals(fs.readFileSync(artworkRuntimeFile)))fail('artwork motion: built runtime differs from source');
console.log(`artwork motion: three independent pinned sources on ${homeArtworkPages} homepage aliases; native source reversal and exact runtime checked`);

// I18n adds an exact reversible surface. It does not authorize other edits.
if (routes.size !== 140 + tattooRoutes.length) fail(`i18n: expected${140+tattooRoutes.length} page routes, found ${routes.size}`);
const appleLanguages = JSON.parse(read(path.join(root,'content/i18n/apple-language-coverage.json'))).languages_with_chinese_scripts_separate;
if (languages.length !== 31 || [...new Set(languages.map(x=>x.code))].sort().join(',') !== [...appleLanguages].sort().join(',')) fail('i18n:31-language registry differs from verified Apple script-normalized coverage');
for (const route of [...routes,'404']) {
  const file=route==='404'?path.join(site,'404.html'):fileFor(route),html=read(file);
  try {
    const stripped=removeMuseumTypography(removeSiteI18n(html));
    if (stripped===html || addSiteI18n(stripped)!==html) fail(`${route}: missing, changed or non-reversible i18n injection`);
  } catch(error) { fail(`${route}: ${error.message}`); }
  if ([...html.matchAll(/id="site-language-dialog"/g)].length!==1 || [...html.matchAll(/data-site-language-option="/g)].length!==31) fail(`${route}: selector dialog/31choices incomplete or duplicated`);
  if (!html.includes(`<script src="${runtimeAsset}" defer></script>`)) fail(`${route}: language runtime identity mismatch`);
}
if (!fs.existsSync(path.join(site,runtimeAsset.slice(1))) || !fs.readFileSync(path.join(root,'content/i18n/site-language.js')).equals(fs.readFileSync(path.join(site,runtimeAsset.slice(1))))) fail('i18n: built runtime asset differs from authoritative source');
const sourceCatalog = JSON.parse(read(path.join(root,'content/i18n/source-catalog.json')));
const extractedCatalog = createCatalog(root);
if (extractedCatalog.sourceCatalogHash !== sourceCatalog.sourceCatalogHash || extractedCatalog.segmentCount !== sourceCatalog.segmentCount) fail('i18n: source catalog does not match the current canonical HTML segment set');
const readiness = localeReadiness(root,sourceCatalog);
for (const issue of checkReviewedEntries(root,sourceCatalog,languages)) fail(issue);
const formUiSource = JSON.parse(read(path.join(root,'content/i18n/form-ui-source.json')));
const extractedFormUi = collectFormUi(root);
if (extractedFormUi.sourceCatalogHash !== formUiSource.sourceCatalogHash || extractedFormUi.parentSourceCatalogHash !== formUiSource.parentSourceCatalogHash || JSON.stringify(extractedFormUi.scripts) !== JSON.stringify(formUiSource.scripts)) fail('i18n: form UI catalog does not match the current canonical form scripts and parent source');
console.log(`i18n coverage: ${readiness.completeLocales}/${readiness.requiredLocales} non-English dictionaries complete; ${readiness.totalEntries}/${readiness.expectedEntries} entries present`);
console.log(`i18n form UI coverage: ${readiness.formUi.completeLocales}/${readiness.formUi.requiredLocales} non-English sidecars complete; source ${formUiSource.segmentCount} unique UI segments`);
for (const report of readiness.locales) {
  if (!report.complete) console.log(`i18n ${report.locale}: ${report.status}, ${report.translated}/${report.required}, missing ${report.missing}`);
  if (report.status==='invalid' || report.status==='untranslated-source-copy') fail(`i18n ${report.locale}: ${report.error || report.status}`);
}
for (const [locale,report] of Object.entries(readiness.formUi.languages)) if (!report.complete) console.log(`i18n form UI ${locale}: ${report.status}, ${report.translated}/${report.required}`);
if (allowIncompleteLocales) {
  const host=baseUrl?new URL(baseUrl).hostname.toLowerCase():'';
  const publicProduction = /(^|\.)effacermonexistence\.com$/i.test(host) || host==='effacermonexistence-pixel-clone-production.up.railway.app';
  if (publicProduction || /^production$/i.test(process.env.RAILWAY_ENVIRONMENT_NAME || '')) throw Error('--allow-incomplete-locales is forbidden for production verification');
  console.log('i18n mode: LOCAL/STAGING ONLY — incomplete locales are not release readiness');
} else if (!readiness.ready) fail('i18n release readiness: all30 non-English dictionaries and form UI sidecars must cover their complete source catalogs; use --allow-incomplete-locales only for explicit local/staging work');

// 1. Live pages are the live bytes; the only edits allowed are <a href> on site
//    links, the footer text block (see 7) and the small-screen style at the end
//    of the head (see 5).
const dropAnchorHrefs = (html) => html.replace(/<a\b[^>]*>/gi, (tag) => tag.replace(/\shref\s*=\s*(["'])[^"']*\1/i, ''));
const FIT_STYLE = /<style id="small-screen-fit">\n([\s\S]*?)\n<\/style>\n(?=<\/head>)/;
const withoutFit = (html) => html.replace(FIT_STYLE, '');
const APPLY_INTRO_STYLE = /<style id="apply-intro-alignment-v3">[\s\S]*?<\/style>\n/g;
function withoutApplyIntro(html, route) {
  const styles = [...html.matchAll(APPLY_INTRO_STYLE)];
  if (route === '/apply') {
    if (styles.length !== 1 || crypto.createHash('sha256').update(styles[0]?.[0] || '').digest('hex') !== '308a3941ef36977bc7bf1db59105db2068986d661b9423eb29f436236d2241aa') fail('/apply: scoped title/intro alignment CSS changed');
    return html.replace(APPLY_INTRO_STYLE, '');
  }
  if (styles.length) fail(`${route}: /apply-only CSS leaked onto another route`);
  return html;
}

const TEXT_CONTENT = /(<div class="sqs-html-content" data-sqsp-text-block-content>)([\s\S]*?)(<\/div>)/g;
const FOOTER_HINT = /Designed to disintegrate|All rights reserved/i;
const blockText = (inner) => inner.replace(/<\/?(?:span|a|strong|em)\b[^>]*>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const footers = (html) => [...html.matchAll(TEXT_CONTENT)].map((m) => m[2]).filter((inner) => FOOTER_HINT.test(blockText(inner)));
const withoutFooter = (html) => html.replace(TEXT_CONTENT, (m, open, inner, close) => (FOOTER_HINT.test(blockText(inner)) ? `${open}${close}` : m));
let identical = 0;
for (const [route, record] of Object.entries(manifest.pages)) {
  if (route === '/code' || chapterSlugs.has(route) || cosmologyRoutes.has(route)) continue;
  const file = fileFor(route);
  if (!fs.existsSync(file)) {
    fail(`${route}: missing from site/`);
    continue;
  }
  let originalPresentation = route === '/archive' ? removeArchiveWorkForComparison(removeArchiveSpacing(preservedHtml(file), root), root) : preservedHtml(file);
  originalPresentation = originalPresentation.replace(SITE_LINE_STYLE, '');
  const expectedPresentation = rewriteWordmarkReferences(read(path.join(snap, record.file)));
  if (dropAnchorHrefs(withoutFooter(withoutFit(withoutApplyIntro(originalPresentation, route)))) !== dropAnchorHrefs(withoutFooter(expectedPresentation))) fail(`${route}: differs beyond approved archive insertion, wordmark cleanup, link hrefs, footer, scoped styles and exact reversible homepage background/i18n`);
  else identical += 1;
}
// Files (/s/ and the root crawler files) are the live bytes, and the live
// redirects are kept.
for (const [p, record] of Object.entries(manifest.files)) {
  const file = path.join(site, record.file);
  if (!fs.existsSync(file) || !fs.readFileSync(file).equals(fs.readFileSync(path.join(snap, record.file)))) fail(`${p}: differs from the live copy`);
}
for (const p of ['/robots.txt', '/sitemap.xml']) if (!files.has(p)) fail(`${p}: not in the snapshot (npm run sync -- --root-files)`);

// New artwork is additive: all previous Archive content survives byte-for-byte.
const archivePage = read(fileFor('/archive'));
const expectedEntry = renderArchiveWork(root);
if (archivePage.split(expectedEntry).length !== 2 || archivePage.split(ARCHIVE_STYLE).length !== 2) fail('archive: new artwork or scoped stylesheet missing/duplicated/changed');
if (!(archivePage.indexOf('Fractured Vessel / Residual Container') < archivePage.indexOf('data-archive-work="failed-rendering"') && archivePage.indexOf('data-archive-work="failed-rendering"') < archivePage.indexOf('Fractal Spill / Collapse of the Surface'))) fail('archive: Material Collapse placement/order changed');
if (archiveWork.number !== 15 || archiveWork.year !== 2026) fail('archive: series number or capture-year mismatch');
if (archiveWork.dimensions !== 'Approx. 10.4 × 7.8 in' || !archiveWork.medium.startsWith('Damaged iPad display,')) fail('archive: iPad medium/approximate width × height changed');
if (expectedEntry.split('data-controller="GallerySlideshow"').length !== 2 || expectedEntry.split('class="gallery-slideshow-item"').length !== 4) fail('archive: native one-image-at-a-time slideshow shape changed');
if (!expectedEntry.includes('data-previous') || !expectedEntry.includes('data-next') || !expectedEntry.includes('class="sqs-html-content"')) fail('archive: native navigation/text format missing');
if (/To be confirmed|To be assigned|\[.*?\]/.test(text(expectedEntry))) fail('archive: unconfirmed placeholder leaked into public entry');
const archiveMediaManifest=JSON.parse(read(path.join(site,'s/failed-rendering-manifest.json')));
for(const image of archiveWork.images){
 const source=fs.readFileSync(path.join(root,'content/artworks/failed-rendering',image.file));
 const delivered=fs.readFileSync(path.join(site,'s',image.file));
 const receipt=archiveMediaManifest.images.find(x=>x.file==='/s/'+image.file);
 if(!source.equals(delivered) || !receipt || receipt.sha256!==crypto.createHash('sha256').update(source).digest('hex'))fail('archive: image identity mismatch '+image.file);
 if(!(image.width>image.height))fail('archive: non-landscape image '+image.file);
}
for(const route of routes){if(route!=='/archive'&&read(fileFor(route)).includes('data-archive-work="failed-rendering"'))fail('archive: new artwork leaked onto '+route);}
if (archivePage.split(spacingMarkup(root)).length !== 2 || readArchiveSpacing(root).entries.length !== 21) fail('archive: spacing registry/runtime incomplete');
if (!fs.readFileSync(path.join(root,'content/site-presentation/archive-spacing.js')).equals(fs.readFileSync(path.join(site,'s/archive-spacing.js')))) fail('archive: spacing runtime artifact differs');
for(const route of routes){if(route!=='/archive'&&read(fileFor(route)).includes('id="archive-spacing-runtime"'))fail('archive spacing leaked onto '+route);}
console.log('archive: No.15, 2026 capture year, 3 landscape images; previous work content preserved; 21 spacing pairs, No.6 reference');

// Every page uses the same narrowly scoped presentation change, including 404.
for (const route of [...routes, '404']) {
  const html = read(route === '404' ? path.join(site,'404.html') : fileFor(route));
  if (html.split(SITE_LINE_STYLE).length !== 2) fail('presentation: missing/changed/duplicate line rules on '+route);
  WORDMARK_REFERENCE.lastIndex=0;
  if (WORDMARK_REFERENCE.test(html)) fail('presentation: unpinned external wordmark remains on '+route);
  if (html.includes('/s/wordmark-no-strike.png')) fail('presentation: erased logo strike reintroduced on '+route);
}
const wordmarkSource = fs.readFileSync(path.join(root,'content/site-presentation',path.basename(WORDMARK_ASSET)));
const wordmarkDelivered = fs.readFileSync(path.join(site,WORDMARK_ASSET.slice(1)));
if (!wordmarkSource.equals(wordmarkDelivered) || crypto.createHash('sha256').update(wordmarkDelivered).digest('hex') !== WORDMARK_SHA256) fail('presentation: original struck wordmark artifact differs');
console.log('presentation: exact original struck wordmark on all pages; separate decorative-divider/form/math rules preserved');
const redirects = JSON.parse(fs.readFileSync(path.join(site, 'redirects.json'), 'utf8'));
if (JSON.stringify(redirects) !== JSON.stringify(manifest.redirects || {}) || !redirects['/favicon.ico']) fail('redirects.json does not match the live redirects');

// Cosmology is the one intentionally replaced legacy page. Verify its frozen sources and readers.
const cosmologyRender = JSON.parse(read(path.join(site,'s/cosmology-render-manifest.json')));
if (cosmologyRender.source_commit !== cosmologyManifest.commit) fail('cosmology: source revision mismatch');
if (cosmologyRender.rendered_equations < 20) fail('cosmology: equations missing');
for (const c of cosmologyManifest.chapters) {
  const source=fs.readFileSync(path.join(root,'content/cosmology',c.file));
  const hash=crypto.createHash('sha256').update(source).digest('hex');
  if(hash!==c.sha256 || hash!==cosmologyManifest.files[c.file])fail('cosmology: changed source '+c.file);
  const page=read(fileFor('/'+c.slug));
  if (!page.includes('id="cosmology-reader-v2"') || page.includes('katex-error'))fail('cosmology: reader/render failure '+c.slug);
  if (!page.includes('/s/cosmology-source--'+c.file.replaceAll('/','--')))fail('cosmology: source receipt missing '+c.slug);
}
for(const[f,h]of Object.entries(cosmologyManifest.files)){
  const bytes=fs.readFileSync(path.join(site,'s','cosmology-source--'+f.replaceAll('/','--')));
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==h)fail('cosmology: source artifact mismatch '+f);
}
const cosmologyLanding=read(fileFor('/talek-1-2'));
if ([...cosmologyLanding.matchAll(/class="enter" href="([^"]+)"/g)].length!==cosmologyManifest.chapters.length)fail('cosmology: chapter menu incomplete');
if (/href="https:\/\/github.com\/effacermonexistence\/orthogonal-projection-term-benchmarks/.test(cosmologyLanding))fail('cosmology: forced GitHub exit retained');
console.log(`cosmology: ${cosmologyManifest.chapters.length} chapters, ${cosmologyRender.rendered_equations} equations, pinned source ${cosmologyManifest.commit.slice(0,12)}`);

// 2. Links stay on this copy and every internal link resolves.
let internalLinks = 0;
for (const route of routes) {
  const html = read(fileFor(route));
  for (const [, href] of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"']*)["']/gi)) {
    if (/^(?:https?:)?\/\/(?:www\.)?effacermonexistence\.com/i.test(href)) fail(`${route}: link still points at the live domain: ${href}`);
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    internalLinks += 1;
    let target = href.split(/[?#]/)[0];
    if (target.length > 1 && target.endsWith('/')) target = target.slice(0, -1);
    if (!routes.has(target) && !files.has(target)) fail(`${route}: broken internal link ${href}`);
  }
}

// 3. /code: the original card list, continued to the last chapter.
const code = preservedHtml(fileFor('/code'));
const cardTitles = [...text(code.slice(code.indexOf('<main'), code.indexOf('</main>'))).matchAll(/CHAPTER ([IVXL]+) —/g)].map((m) => m[1]);
const buttons = [...code.matchAll(/<a\s+href="([^"]*)"\s+class="[^"]*sqs-block-button-element"[^>]*>\s*([^<]+?)\s*<\/a>/g)].map((m) => ({ href: m[1], label: m[2] }));
const enter = buttons.filter((b) => b.label === 'ENTER');
const expectedCards = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', ...chapters.map((c) => c.roman)];
if (cardTitles.join(',') !== expectedCards.join(',')) fail(`/code: card order ${cardTitles.join(',')}`);
if (code.includes('Not Yet Rendered')) fail('/code: a "Not Yet Rendered" card remains');
if (enter.length !== expectedCards.length) fail(`/code: ${enter.length} ENTER buttons, expected ${expectedCards.length}`);
for (const c of chapters) {
  if (!enter.some((b) => b.href === `/${c.slug}`)) fail(`/code: no ENTER for ${c.slug}`);
  if (c.number > 11 && !code.includes(`<strong>CHAPTER ${c.roman}</strong>`)) fail(`/code: card ${c.roman} missing`);
}
for (const b of enter) if (!routes.has(b.href)) fail(`/code: ENTER goes nowhere: ${b.href}`);
const liveCode = read(path.join(snap, manifest.pages['/code'].file));
for (const line of ['POST-SIMULATION HUMANISM', 'CONTINUE RENDERING', 'Exiled from the rendered world']) {
  if (!text(code).includes(line) || !text(liveCode).includes(line)) fail(`/code: "${line}" missing`);
}
// Every /code button must be clickable: no overlapping block may stack above
// it in the phone or desktop grid (higher z-index, or equal z-index and later
// in the document).
const gridCss = code.match(/<style>\s*\.fe-[0-9a-f]{24} \{\s*--grid-gutter[\s\S]*?<\/style>/)?.[0] || '';
const layout = new Map();
for (const [, id, area, z] of gridCss.matchAll(/\n {2}\.fe-block-([A-Za-z0-9_]+) \{\s*grid-area: ([0-9/]+);\s*z-index: (\d+);/g)) {
  layout.set(id, { phone: { area: area.split('/').map(Number), z: Number(z) } });
}
for (const [, id, area, z] of gridCss.matchAll(/\n {4}\.fe-block-([A-Za-z0-9_]+) \{\s*grid-area: ([0-9/]+);\s*z-index: (\d+);/g)) {
  if (layout.has(id)) layout.get(id).desktop = { area: area.split('/').map(Number), z: Number(z) };
}
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const domOrder = new Map([...code.matchAll(/<div class="fe-block fe-block-([A-Za-z0-9_]+)">/g)].map((m, i) => [m[1], i]));
const above = (other, pos, id, button) => pos.z > button.z || (pos.z === button.z && domOrder.get(other) > domOrder.get(id));
const buttonIds = [...code.matchAll(/data-sqsp-block="button" data-website-component-id="([^"]+)"/g)].map((m) => m[1]);
if (buttonIds.length < enter.length) fail(`/code: found ${buttonIds.length} button blocks`);
for (const id of buttonIds) {
  for (const grid of ['phone', 'desktop']) {
    const button = layout.get(id)?.[grid];
    if (!button) {
      fail(`/code: no ${grid} grid position for button ${id}`);
      continue;
    }
    for (const [other, pos] of layout) {
      if (other !== id && pos[grid] && overlaps(button.area, pos[grid].area) && above(other, pos[grid], id, button)) {
        fail(`/code: button ${id} is covered by ${other} in the ${grid} grid`);
      }
    }
  }
}

// 4. Chapter pages carry their whole source essay, in order, set the way the
//    hand-made chapters I-VII are.
const SEPARATOR = /^(?:[─━—_=⸻\-\s]{3,}|[⸺⸻]+)$/;
// A source line as the page shows it: no leading ★, tab stops as one space.
const shown = (line) => line.replace(/^\s*★\s*/, '').replace(/\s+/g, ' ').trim();
// Inline tags join their text; block tags separate it.
const plain = (html) => html.replace(/<\/?(?:span|strong|em)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const EMPTY_P = /^<p [^>]*><\/p>$/;
let emphasisChecked = 0;
let headingsChecked = 0;
for (const c of chapters) {
  const html = read(fileFor(`/${c.slug}`));
  if (!html.includes(`<title>CHAPTER ${c.roman} &mdash; effacermonexistence;</title>`)) fail(`${c.slug}: title`);
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const block = [...main.matchAll(/<div class="sqs-html-content" data-sqsp-text-block-content>([\s\S]*?)<\/div>/g)]
    .map((m) => m[1]).find((b) => b.includes(`CHAPTER ${c.roman} `)) || '';
  const body = plain(block);
  const rawLines = c.text.split('\n');
  const lines = rawLines.map(shown).filter((l) => l && !SEPARATOR.test(l));
  const head = lines.findIndex((l) => /CHAPTER\s+\S+\s*[—–-]/i.test(l) && l.toUpperCase().includes(c.title.toUpperCase()));
  let at = body.indexOf(`CHAPTER ${c.roman}`);
  if (head < 0 || at < 0) {
    fail(`${c.slug}: heading`);
    continue;
  }
  for (const line of lines.slice(head + 1)) {
    const next = body.indexOf(line, at);
    if (next < 0) {
      fail(`${c.slug}: missing or out of order: "${line.slice(0, 60)}"`);
      break;
    }
    at = next;
  }

  // Headline as on the hand-made chapters: bold CHAPTER heading and title.
  if (!block.startsWith(`<h2 style="text-align: center; ; white-space:pre-wrap;" data-rte-preserve-empty="true"><span class="sqsrte-text-color--white"><strong>CHAPTER ${c.roman} </strong></span></h2>`)) fail(`${c.slug}: CHAPTER heading markup`);
  // No ornaments or tab stops on the page: rules become space, list items read "• text".
  if (/[⸻★]/.test(body) || block.includes('\t')) fail(`${c.slug}: ornament or tab stop shown in the essay`);
  // Emphasis sits inside the white text span, as on CHAPTER II, III, IV and VI.
  if (/<(?:strong|em)>\s*<span/.test(block)) fail(`${c.slug}: emphasis wraps the colour span`);

  // The note's bold and italic survive, from the first line after the subtitle on.
  let bodyLine = rawLines.findIndex((l) => /CHAPTER\s+\S+\s*[—–-]/i.test(l) && l.toUpperCase().includes(c.title.toUpperCase())) + 1;
  while (bodyLine < rawLines.length && !rawLines[bodyLine].trim()) bodyLine += 1;
  if (/^\(.*\)$/.test(rawLines[bodyLine]?.trim() || '')) bodyLine += 1;
  const bodyStart = rawLines.slice(0, bodyLine).reduce((n, l) => n + l.length + 1, 0);
  const inside = (tag) => [...block.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => plain(m[1]));
  const strong = inside('strong');
  const em = inside('em');
  for (const [s, e, style] of c.emphasis) {
    if (s < bodyStart) continue;
    for (const part of c.text.slice(s, e).split('\n').map(shown).filter((p) => p && !SEPARATOR.test(p))) {
      if (style.includes('bold') && !strong.some((t) => t.includes(part))) fail(`${c.slug}: bold lost: "${part.slice(0, 50)}"`);
      if (style.includes('italic') && !em.some((t) => t.includes(part))) fail(`${c.slug}: italic lost: "${part.slice(0, 50)}"`);
      emphasisChecked += 1;
    }
  }

  // Section headings: three empty paragraphs above, two below (CHAPTER VI).
  const els = [...block.matchAll(/<(h2|h3|h4|p)\b[^>]*>[\s\S]*?<\/\1>/g)].map((m) => m[0]);
  els.forEach((el, k) => {
    if (!el.startsWith('<h3')) return;
    headingsChecked += 1;
    let above = 0;
    while (k - above - 1 >= 0 && EMPTY_P.test(els[k - above - 1])) above += 1;
    let below = 0;
    while (k + below + 1 < els.length && EMPTY_P.test(els[k + below + 1])) below += 1;
    if (above !== 3 || below !== 2) fail(`${c.slug}: heading "${plain(el).slice(0, 40)}" has ${above} empty paragraphs above, ${below} below`);
  });
}
console.log(`chapters: ${emphasisChecked} emphasised passages and ${headingsChecked} section headings checked`);

// 5. Phones and tablets (see "phones and tablets" in build.mjs). With the
//    small-screen style applied, no top-aligned text block reaches into the rows
//    of a button below it, on phones and on 768-1199px screens; a sector-map
//    heading sits in rows of its own just above its button; button labels do not
//    wrap; and from 1200px up the pages keep their own placement.
const FIT = {
  phone: { indent: '  ', heading: '(max-width: 767px)', placement: '(max-width: 767px)' },
  wide: { indent: '    ', heading: '(min-width: 768px)', placement: '(min-width: 768px) and (max-width: 1199px)' }
};
const NOWRAP = '.sqs-block-button-container .sqs-block-button-element { white-space: nowrap; }';
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
let fitPages = 0;
let fitPairs = 0;
for (const route of routes) {
  const html = preservedHtml(fileFor(route));
  const style = html.match(FIT_STYLE)?.[1] ?? '';
  const media = new Map([...style.matchAll(/@media ([^{]+?) \{\n([\s\S]*?)\n\}/g)].map((m) => [m[1], m[2].split('\n').map((l) => l.trim())]));
  for (const m of media.keys()) {
    if (![FIT.phone.heading, FIT.wide.heading, FIT.wide.placement].includes(m)) fail(`${route}: small-screen style for ${m}`);
  }
  if ([...(media.get(FIT.wide.heading) || [])].some((r) => /\.fluid-engine \.fe-block-[^ ]+ \{ grid-area/.test(r))) fail(`${route}: moves a block from 1200px up`);
  const pills = [...html.matchAll(/data-sqsp-block="button" data-website-component-id="([^"]+)"/g)].map((m) => m[1]);
  if (pills.length && !style.includes(NOWRAP)) fail(`${route}: buttons without the one-line label rule`);
  if (style) fitPages += 1;
  for (const g of html.matchAll(/<style>\s*\.fe-([0-9a-f]{24}) \{\s*--grid-gutter[\s\S]*?<\/style>/g)) {
    for (const [name, layout] of Object.entries(FIT)) {
      const rules = media.get(layout.placement) || [];
      const headingRules = media.get(layout.heading) || [];
      const blocks = new Map();
      for (const r of g[0].matchAll(new RegExp(`\\n${layout.indent}\\.fe-block-([A-Za-z0-9_]+) \\{\\n${layout.indent}  grid-area: ([0-9/]+);`, 'g'))) {
        const moved = rules.map((x) => x.match(new RegExp(`^\\.fluid-engine \\.fe-block-${r[1]} \\{ grid-area: ([0-9/]+); \\}$`))).find(Boolean);
        blocks.set(r[1], { id: r[1], area: (moved ? moved[1] : r[2]).split('/').map(Number) });
      }
      for (const r of g[0].matchAll(new RegExp(`\\n${layout.indent}\\.fe-block-([A-Za-z0-9_]+) \\.sqs-block \\{\\n${layout.indent}  justify-content: ([a-z-]+);`, 'g'))) {
        if (blocks.has(r[1])) blocks.get(r[1]).align = r[2];
      }
      for (const b of blocks.values()) {
        const at = html.indexOf(`<div class="fe-block fe-block-${b.id}">`);
        const chunk = html.slice(at, html.indexOf('<div class="fe-block fe-block-', at + 1) >>> 0 || undefined);
        b.kind = chunk.match(/data-sqsp-block="([a-z-]+)"/)?.[1];
      }
      const buttons = [...blocks.values()].filter((b) => b.kind === 'button');
      for (const t of blocks.values()) {
        if (t.kind !== 'text' || t.align !== 'flex-start') continue;
        const inside = buttons.filter((b) => b.area[0] > t.area[0] && overlap(b.area, t.area));
        if (!inside.length) continue;
        fitPairs += 1;
        const list = headingRules.filter((x) => x.startsWith(`.fe-block-${t.id} .sqs-html-content > :nth-child(`));
        if (!list.length) {
          fail(`${route}: ${name}: button ${inside[0].id} sits in the rows of text block ${t.id}`);
          continue;
        }
        // A heading list: headings + title, each heading ending on its button's row.
        if (!headingRules.some((x) => x.startsWith(`.fluid-engine .fe-block-${t.id}, `) && x.endsWith('{ display: contents; }'))) fail(`${route}: ${name}: heading list ${t.id} not laid out`);
        const rows = [...new Set(inside.map((b) => b.area[0]))].sort((a, b) => a - b);
        const areas = list.map((x) => x.match(/grid-area: ([0-9/]+);/)[1].split('/').map(Number));
        if (areas.length !== rows.length + 1 || areas.slice(1).some((a, k) => a[2] !== rows[k])) fail(`${route}: ${name}: heading list ${t.id} does not end each heading on its button`);
        if (areas.some((a) => buttons.some((b) => overlap(a, b.area)))) fail(`${route}: ${name}: a heading of ${t.id} shares rows with a button`);
      }
    }
  }
  // Labels too long for a phone are set smaller together on phones.
  for (const [, label] of html.matchAll(/class="sqs-block-button-element[^"]*"[^>]*>([^<]*)<\/a>/g)) {
    if (label.replace(/\s+/g, ' ').trim().length > 22 && !/font-size: min\(16px, [0-9.]+vw\)/.test(style)) fail(`${route}: long button label "${label.trim()}" without a phone size`);
  }
}
console.log(`small screens: ${fitPages} pages with the small-screen style, ${fitPairs} text blocks with a button below checked`);

// 7. Footer: every footer is the home page's, on every page that has one on the
//    live site and on every chapter page. "OmarAGI" is its only link, to
//    omaragi.com, with the theme's link underline switched off.
const GREY = (inner) => `<span class="sqsrte-text-color--custom" style="color: rgb(120, 122, 120);">${inner}</span>`;
const FP = '<p class="" style="text-align: center; ; white-space:pre-wrap;" data-rte-preserve-empty="true">';
const FOOTER = `${FP}${GREY('© ')}<a target="_blank" href="https://omaragi.com" style="text-decoration:none;background-image:none">${GREY('OmarAGI')}</a>`
  + `${GREY(' — Exiled from the rendered world. Designed to disintegrate so the system can feel.')}</p>${FP}</p>${FP}${GREY(' Copyright. All rights reserved.')}</p>`;
const homeFooter = footers(read(path.join(snap, manifest.pages['/'].file)));
if (homeFooter.length !== 1 || homeFooter[0] !== FOOTER.replace(' style="text-decoration:none;background-image:none"', '')) fail('footer: the live home page footer changed');
let footerPages = 0;
for (const route of [...routes, '404']) {
  const html = read(route === '404' ? path.join(site, '404.html') : fileFor(route));
  const live = chapterSlugs.has(route) || cosmologyRoutes.has(route) || tattooRoutes.includes(route) ? [FOOTER] : footers(read(path.join(snap, route === '404' ? manifest.notFound.file : manifest.pages[route].file)));
  const found = footers(html);
  if (found.length !== live.length) fail(`${route}: ${found.length} footer(s), the live page has ${live.length}`);
  for (const inner of found) if (inner !== FOOTER) fail(`${route}: footer is not the home page's: "${blockText(inner).slice(0, 60)}"`);
  if (found.length) footerPages += 1;
}
console.log(`footer: ${footerPages} pages carry the home page footer, linked only to omaragi.com`);

console.log(`static: ${identical} live pages byte-identical apart from link hrefs, the footer and the small-screen style, ${chapters.length} chapter pages, /code ${enter.length} ENTER cards, ${internalLinks} internal links checked`);

// 6. HTTP checks against a running server.
if (baseUrl) {
  const expectedRuntime = createI18nRuntime(root);
  const expectedPage = (route,language='en',notFound=false) => expectedRuntime.render(read(notFound?path.join(site,'404.html'):fileFor(route)),route,language);
  const get = async (p, headers = {}) => {
    const res = await fetch(new URL(p, baseUrl), { headers, redirect: 'manual' });
    return { status: res.status, type: res.headers.get('content-type') || '', encoding: res.headers.get('content-encoding'), location: res.headers.get('location'), language:res.headers.get('content-language'),requested:res.headers.get('x-site-language-requested'),translation:res.headers.get('x-site-translation'),missing:res.headers.get('x-site-translation-missing'),vary:res.headers.get('vary')||'',cache:res.headers.get('cache-control')||'',cookies:res.headers.getSetCookie(),body: Buffer.from(await res.arrayBuffer()) };
  };
  const checkRendered = (r,want,label,status=200) => {
    if (r.status!==status || !r.type.startsWith('text/html')) fail(`HTTP ${label}: ${r.status} ${r.type}`);
    if (!r.body.equals(Buffer.from(want.html))) fail(`HTTP ${label}: body differs from expected source-preserving runtime rendering`);
    if (r.language!==want.language || r.requested!==want.requestedLanguage || r.translation!==want.status || r.missing!==String(want.missing)) fail(`HTTP ${label}: actual/requested language or translation coverage headers differ`);
    if (!r.vary.toLowerCase().includes('cookie') || !r.cache.includes('private')) fail(`HTTP ${label}: localized HTML is not cookie-isolated/private`);
  };
  for (const route of routes) {
    const r = await get(route+'?lang=en');
    checkRendered(r,expectedPage(route),'English '+route);
    if (!r.cookies.some(cookie=>/^effacer_lang=en;/.test(cookie)&&/Path=\//.test(cookie)&&/Max-Age=31536000/.test(cookie)&&/SameSite=Lax/.test(cookie))) fail(`HTTP ${route}: explicit English preference cookie missing/changed`);
  }
  for (const f of files) {
    const r = await get(f);
    const expectedFile=path.join(site, manifest.files[f]?.file || f.slice(1));
    if (!fs.existsSync(expectedFile) || r.status !== 200 || !r.body.equals(fs.readFileSync(expectedFile))) fail(`HTTP ${f}: ${r.status} or artifact byte mismatch`);
  }
  for (const [p, want] of Object.entries(redirects)) {
    const r = await get(p);
    if (r.status !== want.status || r.location !== want.location) fail(`HTTP ${p}: ${r.status} ${r.location}, expected ${want.status} ${want.location}`);
  }
  const health = await get('/healthz');
  if (health.status !== 200 || JSON.parse(health.body).ok !== true) fail('HTTP /healthz');
  for (const p of ['/does-not-exist', '/CODE', '/server.js', '/snapshot/manifest.json', '/chapter-xxxvi', '/redirects.json']) {
    const r = await get(p+'?lang=en');
    checkRendered(r,expectedPage(p,'en',true),p,404);
  }
  // Real catalogs govern these responses. In local/staging partial mode an
  // unavailable translation must stay an explicitly labeled English fallback.
  for (const language of languages.filter(x=>x.code!=='en')) {
    const r=await get('/code?lang='+language.code);
    checkRendered(r,expectedPage('/code',language.code),language.code+' /code');
    if (r.translation==='unavailable' && (!r.body.includes(Buffer.from('class="site-language-fallback"')) || r.language!=='en')) fail(`HTTP ${language.code}: missing data masquerades as translated success`);
  }
  for (const language of ['ko','fr','ar']) for (const route of ['/','/chapter-xxxv','/talek-1','/talek-1-2','/cosmology-overview','/apply']) {
    const r=await get(route+'?lang='+language);
    checkRendered(r,expectedPage(route,language),language+' '+route);
  }
  checkRendered(await get('/exist-fr'),expectedPage('/exist-fr','fr'),'authored French default');
  const cookiePage=await get('/chapter-xxxv',{cookie:'effacer_lang=ar'});
  checkRendered(cookiePage,expectedPage('/chapter-xxxv','ar'),'cross-route cookie');
  if(cookiePage.cookies.some(cookie=>/^effacer_lang=/.test(cookie)))fail('HTTP cookie-only navigation unexpectedly rewrites language cookie');
  const invalidLocale=await get('/code?lang=not-a-language',{cookie:'effacer_lang=ar'});
  checkRendered(invalidLocale,expectedPage('/code','ar'),'invalid query preserves valid cookie');
  const beacon = await fetch(new URL('/api/census/RecordHit', baseUrl), { method: 'POST', body: '{}' });
  if (beacon.status !== 204) fail(`HTTP POST /api/census/RecordHit: ${beacon.status}`);
  // API calls reach the site on Squarespace: the template schema comes back as
  // on the live site, and the first step of a form submission returns a key and
  // the crumb cookie. No entry is submitted.
  const api = await get('/api/template/GetTemplateSchema?type=9');
  let schema = null;
  try {
    schema = JSON.parse(api.body);
  } catch {}
  if (api.status !== 200 || !schema?.formFieldFormats) fail(`HTTP /api/template/GetTemplateSchema: ${api.status} ${api.type}`);
  const formKey = await fetch(new URL('/api/form/FormSubmissionKey', baseUrl), { method: 'POST', headers: { 'content-type': 'application/json', referer: new URL('/contact', baseUrl).href } });
  const keyBody = await formKey.text();
  let key = null;
  try {
    key = JSON.parse(keyBody).key;
  } catch {}
  if (formKey.status !== 200 || typeof key !== 'string' || !key) fail(`HTTP POST /api/form/FormSubmissionKey: ${formKey.status} ${keyBody.slice(0, 80)}`);
  if (!formKey.headers.getSetCookie().some((c) => /^crumb=/.test(c) && !/;\s*domain=/i.test(c))) fail('HTTP POST /api/form/FormSubmissionKey: no crumb cookie for this host');
  const gz = await get('/code', { 'accept-encoding': 'gzip' });
  // fetch() decodes the body itself; the header shows what went over the wire.
  if (gz.encoding !== 'gzip' || !gz.body.equals(Buffer.from(expectedPage('/code').html))) fail('HTTP gzip /code');
  console.log(`http: ${routes.size} English routes,31-language smoke/coverage and cookie persistence, ${files.size} exact-byte files, ${Object.keys(redirects).length} redirect(s),404s,gzip and the unchanged Squarespace API gates checked against ${baseUrl}`);
}

if (failures) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log(allowIncompleteLocales?'all local/staging structural checks passed; incomplete translations are NOT release readiness':'all checks passed;30non-English dictionaries are structurally complete');
