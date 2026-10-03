import { readFile } from 'node:fs/promises';

const decode = text => text.replace(/&(amp|lt|gt|quot|apos|#39|#x[0-9a-f]+|#\d+);/gi, (entity, value) => {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  if (named[value]) return named[value];
  return String.fromCodePoint(value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : parseInt(value.slice(1), 10));
});
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const normalize = text => decode(text).replace(/\s+/g, ' ').trim();

export async function loadDictionary(code) {
  return JSON.parse(await readFile(new URL(`./locales/${code}.json`, import.meta.url), 'utf8'));
}

// Translate generated text and accessibility metadata while leaving the
// accepted markup, media, IDs, data values and scripts intact.
export function localizeHtml(html, dictionary, code) {
  let skip = 0;
  const untranslated = new Set();
  const translate = text => {
    const key = normalize(text);
    if (!key) return text;
    if (dictionary[key] === undefined) { if (/[가-힣]/.test(key)) untranslated.add(key); return text; }
    const start = text.match(/^\s*/)[0], end = text.match(/\s*$/)[0];
    return start + escape(dictionary[key]) + end;
  };
  // The source is controlled generated HTML. Quoted attribute values are
  // tokenized together so a greater-than sign in an attribute is preserved.
  html = html.replace(/<!--[\s\S]*?-->|<(?:(?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+/g, token => {
    if (token.startsWith('<!--') || token.startsWith('<!')) return token;
    if (token.startsWith('<')) {
      if (/^<\/(script|style)\b/i.test(token)) skip--;
      if (/^<(script|style)\b/i.test(token)) skip++;
      if (skip) return token;
      return token.replace(/\b(alt|aria-label|placeholder|title|content)="([^"]*)"/g, (all, attribute, value) => {
        if (attribute === 'content' && !dictionary[normalize(value)]) return all;
        return `${attribute}="${translate(value)}"`;
      });
    }
    return skip ? token : translate(token);
  });
  if (untranslated.size) throw new Error(`Unmapped Korean text (${code}): ${[...untranslated].join(' | ')}`);
  html = html.replace(/<html\b[^>]*>/, `<html lang="${code === 'zh-CN' ? 'zh-Hans' : code === 'zh-TW' ? 'zh-Hant' : code}" dir="${code === 'ar' ? 'rtl' : 'ltr'}" data-language="${code}">`);
  if (code !== 'ko') html = html.replace(/(<\/(?:em|strong|span)>)(?=[^\s<])/g, '$1 ');
  const dictionaryJson = JSON.stringify(dictionary).replaceAll('<', '\\u003c');
  html = html.replace(/<meta charset="[^"]+"\s*\/?\>/i, match => `${match}<script id="usung-translations" type="application/json">${dictionaryJson}</script><script src="/locale.js" defer></script>`);
  return html;
}
