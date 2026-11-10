'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function applyAppearance(root) {
  const css = fs.readFileSync(path.join(root, 'content/apply-appearance/style.css'));
  const original = fs.readFileSync(path.join(root,'content/home-fullfield/runtime.js'),'utf8');
  const vertex = original.match(/const vertex = '([^']+)';/)?.[1];
  const fragment = original.match(/const fragment = `([\s\S]*?)`;/)?.[1];
  const source = JSON.parse(fs.readFileSync(path.join(root,'content/home-fullfield/config.json'),'utf8')).sources.axiom;
  if (!vertex || !fragment || source.url !== '/s/fullfield-axiom-b9404bf108de.png') throw Error('AXIOM background source identity');
  const js = Buffer.from(fs.readFileSync(path.join(root,'content/apply-appearance/background.js'),'utf8')
    .replace('__AXIOM_SOURCE__',JSON.stringify(source)).replace('__AXIOM_VERTEX__',JSON.stringify(vertex)).replace('__AXIOM_FRAGMENT__',JSON.stringify(fragment)));
  const asset = '/s/apply-appearance-' + crypto.createHash('sha256').update(css).digest('hex').slice(0, 16) + '.css';
  const script = '/s/apply-background-' + crypto.createHash('sha256').update(js).digest('hex').slice(0,16) + '.js';
  const markup = '<link id="apply-appearance" rel="stylesheet" href="' + asset + '">';
  const runtime = '<script id="apply-background-runtime" defer src="' + script + '"></script>';
  const artwork = '<div id="apply-artwork" aria-hidden="true"><img src="' + source.url + '" alt="" decoding="async"><canvas></canvas></div>';
  return { css, asset, markup, runtime, artwork, assets:[{asset,bytes:css},{asset:script,bytes:js}], render(html, route) {
    if (route !== '/apply') return html;
    if (!html.includes('id="block-61b1bd79481c34f2f1bb"') || html.includes('id="apply-appearance"') || html.split('</head>').length !== 2 || html.split('</body>').length !== 2) throw Error('Unexpected application page identity');
    const anchor = /(<section\b[^>]*data-section-id="68656582e759892761381cbf"[\s\S]*?<div class="section-background">)/g;
    if ([...html.matchAll(anchor)].length !== 1) throw Error('Application background boundary');
    return html.replace(anchor,'$1'+artwork).replace('</head>',markup+'</head>').replace('</body>',runtime+'</body>');
  }};
}
module.exports = { applyAppearance };
