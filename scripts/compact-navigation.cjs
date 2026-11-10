'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const destinations = [['Code','/code'], ['Archive','/archive'], ['Theory','/talek-1'], ['Cosmology','/talek-1-2']];
function compactNavigation(root) {
  const dir = path.join(root, 'content/compact-navigation');
  const assets = ['style.css', 'runtime.js'].map(file => {
    const bytes = fs.readFileSync(path.join(dir, file));
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16);
    return {bytes, asset:'/s/compact-navigation-' + hash + path.extname(file)};
  });
  const head = '<!--compact-navigation-assets--><link id="compact-navigation-policy" rel="stylesheet" href="' + assets[0].asset + '"><!--compact-navigation-assets-end-->';
  return {
    assets,
    render(html, route) {
      if (!html.includes('id="header"')) return html;
      if (html.includes('id="compact-navigation"')) throw Error('Compact navigation duplicate');
      if (html.split('</head>').length !== 2 || html.split('</body>').length !== 2 || (html.match(/<body\b/g)||[]).length !== 1) throw Error('Compact navigation document boundary');
      // Only header email-icon anchors change destination; footer/contact addresses stay intact.
      const header=/<header\b[^>]*\bid="header"[^>]*>[\s\S]*?<\/header>/.exec(html);
      if(!header)throw Error('Header email navigation boundary');
      const routed=header[0].replace(/<a\b[^>]*>[\s\S]*?<\/a>/g,anchor=>{
        // The owner-selected primary action is Apply; keep external credits in the footer.
        if(/<use\b[^>]*(?:xlink:href|href)="#url-icon"/.test(anchor)&&/\shref="https:\/\/omaragi\.com\/?"/.test(anchor))return '';
        if(!/<use\b[^>]*(?:xlink:href|href)="#email-icon"/.test(anchor))return anchor;
        if(!/\shref="mailto:[^"]*"/.test(anchor))throw Error('Unexpected header email destination');
        return anchor.replace(/\shref="mailto:[^"]*"/,' href="/apply" data-header-apply-link="1"').replace(/\starget="[^"]*"/,'');
      });
      html=html.slice(0,header.index)+routed+html.slice(header.index+header[0].length);
      const items = destinations.map(([label, href], i) => '<span class="compact-menu-item" style="--menu-index:' + i + '"><a href="' + href + '" tabindex="-1"' + (route === href ? ' aria-current="page"' : '') + '>' + label + '</a></span>').join('');
      const markup = '<!--compact-navigation-start--><div id="compact-navigation"><button type="button" class="compact-menu-toggle" aria-label="Open Menu" aria-expanded="false" aria-controls="compact-primary-nav"><span class="compact-menu-icon" aria-hidden="true"><span class="compact-menu-line"></span><span class="compact-menu-line"></span></span></button><nav id="compact-primary-nav" aria-label="Primary" aria-hidden="true" inert>' + items + '</nav></div><script src="' + assets[1].asset + '"></script><!--compact-navigation-end-->';
      return html.replace(/<body\b/, '<body data-compact-navigation="1"').replace('</head>', head + '</head>').replace(/(<body\b[^>]*>)/, '$1' + markup);
    }
  };
}
module.exports = {compactNavigation};
