'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function interactionMotion(root) {
  const css = fs.readFileSync(path.join(root, 'content/interaction-motion/style.css'));
  const hash = crypto.createHash('sha256').update(css).digest('hex');
  const asset = '/s/interaction-motion-' + hash.slice(0,16) + '.css';
  const markup = '<link id="interaction-motion-policy" rel="stylesheet" href="' + asset + '">';
  const buttonCss = fs.readFileSync(path.join(root, 'content/interaction-motion/button-style.css'));
  const buttonAsset = '/s/action-button-' + crypto.createHash('sha256').update(buttonCss).digest('hex').slice(0,16) + '.css';
  const buttonMarkup = '<link id="site-action-button-style" rel="stylesheet" href="' + buttonAsset + '">';
  return {
    css, asset, markup, buttonCss, buttonAsset, buttonMarkup,
    render(html) {
      if (html.includes('id="interaction-motion-policy"')) throw Error('Interaction policy duplicate');
      if (html.includes('id="site-action-button-style"')) throw Error('Action button style duplicate');
      if (html.split('</head>').length !== 2) throw Error('Interaction policy head boundary');
      // Section recovery replaces only `markup`; the shared button link survives.
      return html.replace('</head>', markup + buttonMarkup + '</head>');
    }
  };
}
module.exports = {interactionMotion};
