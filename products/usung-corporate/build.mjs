import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { nav, footer, home, ai, physical } from './src/pages.mjs';

const head = (title, description, route = '/') => `<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta name="theme-color" content="#f6f7f8"><link rel="canonical" href="https://usungcorp.com${route}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:url" content="https://usungcorp.com${route}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/corporate.css"><script src="/corporate.js" defer></script></head>`;
for (const page of [
  { directory: '', active: '', title: 'U-SUNG — 현실을 짓고. 가능성을 넓히다.', description: '유성건설 주식회사. AI·AX, 스마트 건설, Physical AI. 현장의 경험과 신뢰할 수 있는 지능을 연결합니다.', content: home },
  { directory: 'ai', active: 'ai', title: 'AI & AX — U-SUNG', description: '유성과 OmarAGI의 AI 신뢰·실행 인프라. 결과 검증, 에이전트 실행 제어, 운영과 거버넌스를 실제 업무에 연결합니다.', content: ai },
  { directory: 'physical-ai', active: 'physical', title: 'Physical AI — U-SUNG', description: '현장 인식, 판단 검증, 실제 실행. 유성의 현장 경험과 AI 기술을 연결하는 Physical AI 사업.', content: physical }
]) {
  const directory = new URL(`./public/${page.directory}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  const route = page.directory ? `/${page.directory}/` : '/';
  await writeFile(new URL('index.html', directory), `<!doctype html><html lang="ko">${head(page.title, page.description, route)}<body class="corp-page"><a class="corp-skip" href="#main-content">본문으로 이동</a>${nav(page.active)}${page.content}${footer}</body></html>`);
}

let original = await readFile(new URL('./baseline/index.html', import.meta.url), 'utf8');
original = original.replace('<title>U-SUNG — Build Beyond</title>', '<title>스마트 건설 — U-SUNG · Build Beyond</title>');
original = original.replace('content="U-SUNG construction and physical AI visual demo"', 'content="유성 스마트 건설. 건설 현장의 경험과 디지털 기술을 연결합니다."');
original = original.replace('href="styles.css"', 'href="/smart-construction/styles.css"');
original = original.replace('src="app.js"', 'src="/smart-construction/app.js"');
original = original.replaceAll('"assets/media/', '"/assets/media/');
original = original.replace('</head>', '<link rel="canonical" href="https://usungcorp.com/smart-construction/"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/corporate.css"><script src="/corporate.js" defer></script></head>');
original = original.replace('<body>', `<body class="corp-construction">${nav('construction')}`);
original = original.replace('aria-label="U-SUNG home"', 'aria-label="스마트 건설 페이지 처음으로"');
await writeFile(new URL('./public/smart-construction/index.html', import.meta.url), original);
let legacyJs = await readFile(new URL('./baseline/app.js', import.meta.url), 'utf8');
legacyJs = legacyJs.replace('`assets/media/${p.image}`', '`/assets/media/${p.image}`');
await writeFile(new URL('./public/smart-construction/app.js', import.meta.url), legacyJs);
await writeFile(new URL('./public/favicon.svg', import.meta.url), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#111716"/><path d="M9 10v15c0 6 5 8 11 8s11-2 11-8V10h-5v15c0 2-2 3-6 3s-6-1-6-3V10zM18 8h4v15h-4z" fill="#d2f0df"/></svg>');
await writeFile(new URL('./public/robots.txt', import.meta.url), 'User-agent: *\nAllow: /\nSitemap: https://usungcorp.com/sitemap.xml\n');
await writeFile(new URL('./public/sitemap.xml', import.meta.url), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ['/', '/ai/', '/smart-construction/', '/physical-ai/'].map(route => `<url><loc>https://usungcorp.com${route}</loc></url>`).join('') + '</urlset>');
console.log('Built corporate home, AI, Smart Construction and Physical AI pages.');
