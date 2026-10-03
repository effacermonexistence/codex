import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { nav, footer, home, ai, physical } from './src/pages.mjs';
import { languages, languageSelector } from './src/languages.mjs';
import { loadDictionary, localizeHtml } from './src/localize.mjs';

const assetVersion = createHash('sha256').update(await readFile(new URL('./public/corporate.css', import.meta.url))).update(await readFile(new URL('./public/corporate.js', import.meta.url))).update(await readFile(new URL('./public/locale.js', import.meta.url))).update(await readFile(new URL('./src/pages.mjs', import.meta.url))).update(await readFile(new URL('./src/languages.mjs', import.meta.url))).update(await readFile(new URL('./references.json', import.meta.url))).update(await readFile(new URL('./build.mjs', import.meta.url))).update(await readFile(new URL('./baseline/app.js', import.meta.url))).digest('hex').slice(0, 12);
const pageSources = [];
const head = (title, description, route = '/') => `<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${description}"><meta name="theme-color" content="#090a0a"><link rel="canonical" href="https://usungcorp.com${route}"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:type" content="website"><meta property="og:url" content="https://usungcorp.com${route}"><link rel="icon" href="/favicon.svg?v=20261003-q2" type="image/svg+xml"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/corporate.css?v=20261003-q2"><script src="/corporate.js?v=20261003-q2" defer></script></head>`;
for (const page of [
  { directory: '', active: '', title: 'U-SUNG — Build What’s Next.', description: '유성건설 주식회사. AI·AX, 스마트 건설, Physical AI. 현장의 경험과 신뢰할 수 있는 지능을 연결합니다.', content: home },
  { directory: 'ai', active: 'ai', title: 'AI & AX — U-SUNG', description: '유성과 OmarAGI의 AI 신뢰·실행 인프라. 결과 검증, 에이전트 실행 제어, 운영과 거버넌스를 실제 업무에 연결합니다.', content: ai },
  { directory: 'physical-ai', active: 'physical', title: 'Physical AI — U-SUNG', description: '현장 인식, 판단 검증, 실제 실행. 유성의 현장 경험과 AI 기술을 연결하는 Physical AI 사업.', content: physical }
]) {
  const directory = new URL(`./public/${page.directory}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  const route = page.directory ? `/${page.directory}/` : '/';
  pageSources.push({ route, directory: page.directory, html: `<!doctype html><html lang="ko">${head(page.title, page.description, route)}<body class="corp-page"><a class="corp-skip" href="#main-content">본문으로 이동</a>${nav(page.active)}${page.content}${footer}</body></html>`.replaceAll('20261003-q2', assetVersion).replace(/(src|poster)="(\/assets\/references\/[^"]+)"/g, (_, attr, url) => `${attr}="${url}?v=${assetVersion}"`) });
}

let original = await readFile(new URL('./baseline/index.html', import.meta.url), 'utf8');
original = original.replace('<title>U-SUNG — Build Beyond</title>', '<title>스마트 건설 — U-SUNG · Build Beyond</title>');
original = original.replace('content="U-SUNG construction and physical AI visual demo"', 'content="유성 스마트 건설. 건설 현장의 경험과 디지털 기술을 연결합니다."');
original = original.replace('href="styles.css"', 'href="/smart-construction/styles.css"');
original = original.replace('src="app.js"', `src="/smart-construction/app.js?v=${assetVersion}"`);
original = original.replaceAll('"assets/media/', '"/assets/media/');
original = original.replace('</head>', '<link rel="canonical" href="https://usungcorp.com/smart-construction/"><link rel="icon" href="/favicon.svg?v=20261003-q2" type="image/svg+xml"><link rel="stylesheet" href="/corporate.css?v=20261003-q2"><script src="/corporate.js?v=20261003-q2" defer></script></head>');
original = original.replace('<body>', `<body class="corp-construction">${nav('construction')}`);
original = original.replace('aria-label="U-SUNG home"', 'aria-label="스마트 건설 페이지 처음으로"');
pageSources.push({ route: '/smart-construction/', directory: 'smart-construction', html: original.replaceAll('20261003-q2', assetVersion) });
let legacyJs = await readFile(new URL('./baseline/app.js', import.meta.url), 'utf8');
legacyJs = legacyJs.replace('`assets/media/${p.image}`', '`/assets/media/${p.image}`');
legacyJs = "const t = (...args) => window.UsungI18n.t(...args);\n" + legacyJs;
legacyJs = legacyJs.replace("$$('dialog')", () => "$$('dialog:not(.corp-language-dialog)')");
legacyJs = legacyJs.replace("paused?'영상 재생 <span aria-hidden=\"true\">▷</span>':'영상 일시정지 <span aria-hidden=\"true\">Ⅱ</span>'", "t(paused ? '영상 재생' : '영상 일시정지') + (paused ? ' <span aria-hidden=\"true\">▷</span>' : ' <span aria-hidden=\"true\">Ⅱ</span>')");
legacyJs = legacyJs.replace("textContent='동작 줄이기 설정 적용 중'", "textContent=t('동작 줄이기 설정 적용 중')");
legacyJs = legacyJs.replace('`${count}개의 레퍼런스 프로젝트`', "t('{count}개의 레퍼런스 프로젝트', { count })");
for (const field of ['title', 'source', 'description']) legacyJs = legacyJs.replaceAll(`textContent=p.${field}`, `textContent=t(p.${field})`);
legacyJs = legacyJs.replace("$('#project-dialog-image').alt=p.title", "$('#project-dialog-image').alt=t(p.title)");
legacyJs = legacyJs.replace("frame.title='Built Robotics — RPD 35 field film'", "frame.title=t('Built Robotics — RPD 35 field film')");
legacyJs = legacyJs.replace("const text=`U-SUNG — PROJECT BRIEF\\n\\n이름 / 회사: ${values.name}\\n이메일: ${values.email}\\n관심 분야: ${values.sector}\\n\\n${values.message}\\n\\n로컬 데모에서 작성한 브리프입니다. 전송되지 않았습니다.\\n`;", "const text=`${t('U-SUNG — PROJECT BRIEF')}\\n\\n${t('이름 / 회사')}: ${values.name}\\n${t('이메일')}: ${values.email}\\n${t('관심 분야')}: ${values.sector}\\n\\n${values.message}\\n\\n${t('로컬 데모에서 작성한 브리프입니다. 전송되지 않았습니다.')}\\n`;");
legacyJs = legacyJs.replace("textContent='브리프 파일을 만들었습니다. 외부로 전송하거나 이 브라우저에 저장하지 않았습니다.'", "textContent=t('브리프 파일을 만들었습니다. 외부로 전송하거나 이 브라우저에 저장하지 않았습니다.')");
await writeFile(new URL('./public/smart-construction/app.js', import.meta.url), legacyJs);
for (const language of languages) {
  const dictionary = await loadDictionary(language.code);
  for (const page of pageSources) {
    let html = localizeHtml(page.html, dictionary, language.code);
    html = html.replace('<usung-language></usung-language>', languageSelector(page.route, language.code, dictionary));
    html = html.replace(/href="(\/(?:ai\/|smart-construction\/|physical-ai\/)?)(#[^"]*)?"/g, (_, route, hash = '') => `href="${route}?lang=${language.code}${hash}"`);
    html = html.replace('src="/locale.js"', `src="/locale.js?v=${assetVersion}"`);
    const directory = new URL(`./public/locales/${language.code}/${page.directory}/`, import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL('index.html', directory), html);
    if (language.code === 'en') await writeFile(new URL(`./public/${page.directory}/index.html`, import.meta.url), html);
  }
}
await writeFile(new URL('./public/favicon.svg', import.meta.url), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="7" fill="#090a0a"/><g fill="#eeede7" transform="skewX(-17)"><path d="M15 19h6v14h-6zM24 10h6v23h-6zM33 16h6v17h-6z"/></g></svg>');
await writeFile(new URL('./public/robots.txt', import.meta.url), 'User-agent: *\nAllow: /\nSitemap: https://usungcorp.com/sitemap.xml\n');
await writeFile(new URL('./public/sitemap.xml', import.meta.url), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ['/', '/ai/', '/smart-construction/', '/physical-ai/'].map(route => `<url><loc>https://usungcorp.com${route}</loc></url>`).join('') + '</urlset>');
console.log(`Built all four corporate pages in ${languages.length} languages. Default: English.`);
