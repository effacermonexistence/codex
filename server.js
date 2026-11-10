const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const { createMotionStatic } = require('./scripts/motion-static.cjs');
const { withRootCanvas } = require('./scripts/root-canvas.cjs');
const { withHistoryFooter, routeForFile, releaseDate } = require('./scripts/site-history-footer.cjs');
const { withSharedFooter } = require('./scripts/site-shared-footer.cjs');
const { createSiteHistory } = require('./scripts/site-history-api.cjs');
const { withApplyEmail, ApplyEmailValidationError } = require('./scripts/apply-email-submission.cjs');
const applyUpload = require('./scripts/apply-upload.cjs').createApplyUpload();
const root = __dirname;
const paintPolicy = require('./scripts/site-paint.cjs').createSitePaint(root);
const {homepageMotion,tattooShapePolicy}=paintPolicy;
const siteHistory = createSiteHistory(root);
const historyDate = releaseDate(root);
const serveMotionAsset = createMotionStatic(root);
const serveTattooMotionAsset = require('./scripts/tattoo-motion-static.cjs').createTattooMotionStatic(root);
const siteDir = path.join(root, 'site');
const port = Number(process.env.PORT || process.argv[2] || 4177);
const host = process.env.HOST || (process.env.RAILWAY_ENVIRONMENT_ID ? '0.0.0.0' : '127.0.0.1');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.xml': 'text/xml; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

// Explicit route table built by scripts/build.mjs: "/" plus one file per page.
// Paths are case-sensitive and anything unknown gets the site's own 404 page,
// exactly like the live Squarespace site.
const routes = new Map([['/', path.join(siteDir, 'index.html')]]);
for (const file of fs.readdirSync(path.join(siteDir, 'pages'))) {
  if (file.endsWith('.html')) routes.set(`/${file.slice(0, -5)}`, path.join(siteDir, 'pages', file));
}
// Files the live site serves under /s/ (PDFs, images linked from pages).
for (const file of fs.readdirSync(path.join(siteDir, 's'))) {
  routes.set(`/s/${file}`, path.join(siteDir, 's', file));
}
// Its crawler files at the root, and the paths it answers with a redirect
// (/favicon.ico goes to the icon on the Squarespace CDN).
for (const file of ['robots.txt', 'sitemap.xml']) routes.set(`/${file}`, path.join(siteDir, file));
const redirects = new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(siteDir, 'redirects.json'), 'utf8'))));
routes.set('/os1-delivery-proof.txt', path.join(root, 'os1-delivery-proof.txt'));
const notFoundPage = path.join(siteDir, '404.html');

// Pages are large and whitespace-heavy; gzip them once and keep them in memory
// until the file changes on disk (a rebuild).
let localeRuntime;
const localeReady=import('./scripts/site-i18n.mjs').then(m=>{localeRuntime=m.createI18nRuntime(root);routes.set(m.runtimeAsset,path.join(root,'content/i18n/site-language.js'));}).catch(error=>{console.error('Localization initialization unavailable:',error.message);});
const localizedCache=new Map();let localizedBytes=0;
function localized(entry,file,req){
 const key=file+':'+entry.mtimeMs+':'+req.siteLanguage;
 if(localizedCache.has(key)){const hit=localizedCache.get(key);localizedCache.delete(key);localizedCache.set(key,hit);return hit;}
 let rendered;
 try{rendered=localeRuntime.render(entry.body.toString('utf8'),req.siteRoute||'/',req.siteLanguage||'en');}
 catch(error){
  // A display-only translation fault must not replace an existing page with 404.
  console.error('Locale rendering fallback:',req.siteRoute,req.siteLanguage,error.message);
  rendered=localeRuntime.render(entry.body.toString('utf8'),req.siteRoute||'/','en');
  rendered={...rendered,requestedLanguage:req.siteLanguage,status:'translation-error-english-fallback',missing:'unknown',html:rendered.html.replace(/(<body\b[^>]*>)/i,'$1<aside class="site-language-fallback" role="status">The original English page is shown while this translation is unavailable.</aside>')};
 }
 const body=Buffer.from(rendered.html),value={...entry,body,gzip:zlib.gzipSync(body,{level:9}),locale:Object.fromEntries(Object.entries(rendered).filter(([key])=>key!=='html'))};
 localizedCache.set(key,value);localizedBytes+=body.length+value.gzip.length;
 while(localizedCache.size>24||localizedBytes>32*1024*1024){const k=localizedCache.keys().next().value;if(k===undefined)break;const old=localizedCache.get(k);localizedBytes-=old.body.length+old.gzip.length;localizedCache.delete(k);}return value;
}
const cache = new Map(); let cacheBytes=0;
function load(file) {
  const stat = fs.statSync(file);
  let entry = cache.get(file);
  if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.sourceSize !== stat.size) {
    const raw = fs.readFileSync(file);
    const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const body = type.startsWith('text/html') ? Buffer.from(paintPolicy.render(raw.toString('utf8'),routeForFile(siteDir,file))) : raw;
    const compressible = type.startsWith('text/');
    entry = { body, type, sourceSize: stat.size, mtimeMs: stat.mtimeMs, gzip: compressible ? zlib.gzipSync(body, { level: 9 }) : null };
    if(cache.has(file)){const old=cache.get(file);cacheBytes-=old.body.length+(old.gzip?.length||0);cache.delete(file);}
    cache.set(file, entry);cacheBytes+=entry.body.length+(entry.gzip?.length||0);
    while(cache.size>64||cacheBytes>64*1024*1024){const key=cache.keys().next().value;if(key===undefined)break;const old=cache.get(key);cacheBytes-=old.body.length+(old.gzip?.length||0);cache.delete(key);}
  }
  return entry;
}

function send(req, res, file, status) {
  let entry;
  try {
    entry = load(file);
    if(entry.type.startsWith('text/html')&&localeRuntime)entry=localized(entry,file,req);
  } catch {
    if (file === notFoundPage) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    return send(req, res, notFoundPage, 404);
  }
  const headers = {
    'content-type': entry.type,
    'cache-control': entry.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
    vary: 'accept-encoding'
  };
  if(entry.locale){headers['cache-control']='private, no-cache';headers.vary='accept-encoding, cookie';headers['content-language']=entry.locale.language;headers['x-site-language-requested']=entry.locale.requestedLanguage;headers['x-site-translation']=entry.locale.status;headers['x-site-translation-missing']=String(entry.locale.missing);if(req.siteLanguageExplicit)headers['set-cookie']='effacer_lang='+req.siteLanguage+'; Path=/; Max-Age=31536000; SameSite=Lax'+(req.socket.encrypted||req.headers['x-forwarded-proto']==='https'?'; Secure':'');}
  let body = entry.body;
  if (entry.gzip && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['content-encoding'] = 'gzip';
    body = entry.gzip;
  }
  headers['content-length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

// Squarespace page scripts call the site's own API under /api/: the form blocks
// on /contact and /apply submit through it (a key from
// /api/form/FormSubmissionKey, then the entry to /api/form/SaveFormSubmission),
// and the cart page and template schema read from it. These calls go on to the
// same site on its Squarespace domain, so each gets the answer the live site
// gives and form entries keep arriving where they always have. Cookies
// Squarespace sets there (the crumb a form submission needs) are handed back to
// the browser for this host.
const SQUARESPACE = 'https://effacermonexistence.squarespace.com';
const API_HEADERS = ['accept', 'accept-language', 'content-type', 'cookie', 'user-agent', 'x-csrf-token', 'x-requested-with'];
const API_MAX_BODY = 1024 * 1024;
const API_ERROR = '{"message":"Unable to submit form. Please try again later."}';

async function proxyApi(req, res, url) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > API_MAX_BODY) {
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8', connection: 'close' });
      return res.end(API_ERROR);
    }
    chunks.push(chunk);
  }
  // Squarespace sees the call as coming from its own page, as on the live site.
  let page = '/';
  try {
    page = new URL(req.headers.referer).pathname;
  } catch {}
  const headers = { origin: SQUARESPACE, referer: SQUARESPACE + page };
  for (const name of API_HEADERS) if (req.headers[name]) headers[name] = req.headers[name];
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  let outboundBody=hasBody?Buffer.concat(chunks):undefined;
  if(req.method==='POST'&&url.pathname==='/api/form/SaveFormSubmission'){
    try{
      outboundBody=withApplyEmail(outboundBody,req.headers['content-type']||'');
      outboundBody=await applyUpload.attach(outboundBody,req.headers['content-type']||'');
    }
    catch(error){
      if(!(error instanceof ApplyEmailValidationError)&&!Number.isInteger(error.status))throw error;
      res.writeHead(error.status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      return res.end(JSON.stringify(error.body||{error:error.message}));
    }
  }
  let upstream;
  let body;
  try {
    upstream = await fetch(SQUARESPACE + url.pathname + url.search, {
      method: req.method,
      headers,
      body: outboundBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000)
    });
    body = Buffer.from(await upstream.arrayBuffer());
  } catch {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(API_ERROR);
  }
  const out = { 'cache-control': 'no-store', 'content-length': body.length };
  const type = upstream.headers.get('content-type');
  if (type) out['content-type'] = type;
  const location = upstream.headers.get('location');
  if (location) out.location = location.startsWith(SQUARESPACE) ? location.slice(SQUARESPACE.length) || '/' : location;
  const cookies = upstream.headers.getSetCookie().map((cookie) => cookie.replace(/;\s*domain=[^;]*/gi, ''));
  if (cookies.length) out['set-cookie'] = cookies;
  res.writeHead(upstream.status, out);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (req, res) => {
  let url;
  let pathname;
  try {
    url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(req, res, notFoundPage, 404);
  }
  // Squarespace page scripts post analytics beacons to /api/census/*; this copy
  // keeps no analytics, so accept and drop them. Every other API call is passed
  // on to Squarespace (above).
  if(pathname==='/api/site-language/status'){
    await localeReady;const c=localeRuntime?.coverage();res.writeHead(c?200:503,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});return res.end(JSON.stringify(c?{ready:Object.values(c.languages).every(x=>x.complete)&&c.formUi.ready,languageChoices:Object.keys(c.languages).length+1,sourceCatalogHash:c.sourceCatalogHash,formUi:c.formUi.ready}: {ready:false}));
  }
  if (pathname.startsWith('/api/')) {
    if(pathname==='/api/site-history/index')return siteHistory.indexResponse(req,res,url);
    if(pathname==='/api/site-history/page')return siteHistory.pageResponse(req,res,url);
    if(pathname==='/api/site-history/asset')return siteHistory.assetResponse(req,res,url);
    if(pathname==='/api/apply/upload')return applyUpload.upload(req,res).catch(()=>{
      if(!res.headersSent)res.writeHead(502,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      res.end('{"error":"upload_unavailable"}');
    });
    if(pathname.startsWith('/api/apply/file/'))return (req.method==='DELETE'?applyUpload.remove(req,res,pathname.slice('/api/apply/file/'.length)):applyUpload.read(req,res,pathname.slice('/api/apply/file/'.length))).catch(()=>{
      if(!res.headersSent)res.writeHead(502,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
      res.end('{"error":"download_unavailable"}');
    });
    if (req.method === 'POST' && pathname.startsWith('/api/census/')) {
      req.resume();
      res.writeHead(204);
      return res.end();
    }
    return proxyApi(req, res, url).catch(() => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(API_ERROR);
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.resume();
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }
  if (tattooShapePolicy.serve(req, res, pathname)) return;
  if (homepageMotion.serve(req, res, pathname)) return;
  if (serveMotionAsset(req, res, pathname)) return;
  if (serveTattooMotionAsset(req, res, pathname)) return;
  if (pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true }));
  }
  // The live site answers "/archive/" the same as "/archive".
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

  await localeReady;
  req.siteLanguage=localeRuntime?localeRuntime.resolve(url,req.headers.cookie||''):'en';
  req.siteLanguageExplicit=!!localeRuntime&&new Set(require('./content/i18n/languages.json').map(x=>x.code)).has(url.searchParams.get('lang'));
  req.siteRoute=routes.has(pathname)?pathname:'/404';
  const homes=new Set(['/','/exist','/exist-fr']);
  if(homes.has(pathname)&&((req.siteLanguage==='fr'&&pathname!=='/exist-fr')||(req.siteLanguage!=='fr'&&pathname==='/exist-fr'))){
    url.pathname=req.siteLanguage==='fr'?'/exist-fr':'/';url.searchParams.set('lang',req.siteLanguage);res.writeHead(302,{location:url.pathname+url.search,'cache-control':'private, no-cache','set-cookie':'effacer_lang='+req.siteLanguage+'; Path=/; Max-Age=31536000; SameSite=Lax'+(req.headers['x-forwarded-proto']==='https'?'; Secure':'')});return res.end();
  }
  const redirect = redirects.get(pathname);
  if (redirect) {
    res.writeHead(redirect.status, { location: redirect.location });
    return res.end();
  }
  const file = routes.get(pathname);
  if (file) return send(req, res, file, 200);
  return send(req, res, notFoundPage, 404);
});

server.listen(port, host, () => {
  console.log(`effacermonexistence copy listening on http://${host}:${port} (${routes.size} routes)`);
});
