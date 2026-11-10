'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const romans = 'I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII XIX XX XXI XXII XXIII XXIV XXV XXVI XXVII XXVIII XXIX XXX XXXI XXXII XXXIII XXXIV XXXV'.split(' ');
const plain = html => html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
function actions(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].flatMap(m => {
    const cls = /\bclass="([^"]*)"/.exec(m[1]);
    const href = /\bhref="(\/[a-z0-9-]+)"/.exec(m[1]);
    return cls && href && cls[1].split(/\s+/).includes('sqs-block-button-element') ? [{href:href[1], label:plain(m[2])}] : [];
  });
}
function sectionRecovery(root, priorMarkup) {
  const code = actions(fs.readFileSync(path.join(root, 'site/pages/code.html'), 'utf8'));
  const theory = actions(fs.readFileSync(path.join(root, 'site/pages/talek-1.html'), 'utf8'));
  const chapters = code.filter(a => a.label === 'ENTER');
  if (chapters.length !== 35 || code.length !== 36 || theory.length !== 9) throw Error('Section recovery destination coverage');
  for (const a of [...code, ...theory]) if (!fs.existsSync(path.join(root, 'site/pages', a.href.slice(1)+'.html'))) throw Error('Missing section destination '+a.href);
  const routes = new Set(['/code', '/talek-1', ...code.map(a=>a.href), ...theory.map(a=>a.href)]);
  const css = fs.readFileSync(path.join(root, 'content/section-recovery/motion.css'));
  const asset = '/s/section-motion-' + crypto.createHash('sha256').update(css).digest('hex').slice(0,16) + '.css';
  const markup = '<link id="interaction-motion-policy" rel="stylesheet" href="'+asset+'">';
  return {css, asset, routes, chapters, theory, markup,
    render(html, route) {
      if (!routes.has(route)) return html;
      if (html.split(priorMarkup).length !== 2) throw Error('Section recovery interaction boundary '+route);
      html = html.replace(priorMarkup, markup);
      if (route !== '/code') return html;
      let count = 0;
      html = html.replace(/(<div class="sqs-html-content"[^>]*>)([\s\S]*?)(<\/div>)/g, (all, open, content, close) => {
        const roman = /\bCHAPTER\s+([IVXLCDM]+)\s*[—–-]/.exec(plain(content));
        if (!roman) return all;
        if (roman[1] !== romans[count] || /<a\b/.test(content)) throw Error('Code chapter source boundary '+roman[1]);
        const target = chapters[count++].href;
        const linked = content.replace(/(<(?:h2|p)\b[^>]*>)([\s\S]*?)(<\/(?:h2|p)>)/g, (whole, start, inner, end) => plain(inner) ? start+'<a class="code-chapter-link" href="'+target+'">'+inner+'</a>'+end : whole);
        return open+linked+close;
      });
      if (count !== 35) throw Error('Code chapter title coverage '+count);
      return html;
    }
  };
}
module.exports = {sectionRecovery};
