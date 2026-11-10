// Shared HTML paint pass. Never changes page content, layout, artwork or controls.
const ROOT_CANVAS_STYLE = '<style id="site-root-canvas-v1">html body{background-color:#000!important}</style>\n';
function withRootCanvas(html) {
  if (typeof html !== 'string') throw new TypeError('Expected HTML text');
  if (html.includes(ROOT_CANVAS_STYLE)) return html;
  if (html.includes('id="site-root-canvas-v1"')) throw new Error('Unexpected root canvas policy');
  if (html.split('</head>').length !== 2) throw new Error('Expected one HTML head');
  return html.replace('</head>', ROOT_CANVAS_STYLE + '</head>');
}
module.exports = { ROOT_CANVAS_STYLE, withRootCanvas };
