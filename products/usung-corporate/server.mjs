import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { languageCodes } from './src/languages.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const faviconRevision = createHash('sha256').update(await readFile(path.join(root, 'favicon.png'))).digest('hex').slice(0, 12);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webp': 'image/webp', '.png': 'image/png', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  let pathname, url;
  try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
  catch { res.writeHead(400); res.end(); return; }
  if (pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(req.method === 'HEAD' ? '' : JSON.stringify({ status: 'ok', site: 'usung-corporate', release: '2026-10-05-helmet-surface-v35', languages: languageCodes.size })); return; }
  if (['/ai', '/smart-construction', '/physical-ai'].includes(pathname)) { res.writeHead(308, { Location: pathname + '/' + url.search }); res.end(); return; }
  const cookieLanguage = /(?:^|;\s*)usung_lang=([^;]*)/.exec(req.headers.cookie || '')?.[1];
  const requestedLanguage = url.searchParams.get('lang');
  const language = languageCodes.has(requestedLanguage) ? requestedLanguage : languageCodes.has(cookieLanguage) ? cookieLanguage : 'en';
  const isPage = ['/', '/ai/', '/smart-construction/', '/physical-ai/'].includes(pathname);
  if (isPage) {
    res.setHeader('Vary', 'Cookie, User-Agent');
    res.setHeader('Content-Language', language);
    if (languageCodes.has(requestedLanguage)) res.setHeader('Set-Cookie', `usung_lang=${language}; Path=/; Max-Age=31536000; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  }
  // Safari can retain a different old icon for each previously visited page URL.
  // Give the four pages a fresh URL for this icon revision without changing routes.
  const agent = req.headers['user-agent'] || '';
  const isSafari = /Safari\//.test(agent) && !/(?:Chrome|Chromium|CriOS|Edg|OPR|FxiOS)\//.test(agent);
  if (isPage && isSafari && url.searchParams.get('icon') !== faviconRevision) {
    url.searchParams.set('icon', faviconRevision);
    res.writeHead(302, { Location: pathname + url.search, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  const file = path.resolve(root, isPage ? `./locales/${language}${pathname}index.html` : '.' + pathname, !isPage && pathname.endsWith('/') ? 'index.html' : '');
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    const isIcon = pathname.startsWith('/assets/brand/icons/') || /^\/(?:favicon(?:-32)?\.(?:png|ico|svg)|apple-touch-icon\.png|icon-(?:192|512)\.png|site\.webmanifest)$/.test(pathname);
    res.setHeader('Cache-Control', isIcon ? 'no-store' : file.endsWith('.html') ? 'private, no-cache' : 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
        if (start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return; }
        status = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
      }
    }
    res.setHeader('Content-Length', end - start + 1);
    res.writeHead(status);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(req.method === 'HEAD' ? '' : '페이지를 찾을 수 없습니다.'); }
});
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () => console.log('U-SUNG corporate site is listening'));
