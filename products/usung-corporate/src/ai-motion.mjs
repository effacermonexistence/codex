import { brandLogo } from './brand.mjs';

// Small decorative scenes; the surrounding translated panel supplies their meaning.
const logo = brandLogo('ai-motion-verify').replace('<svg class="usung-wordmark"', '<svg x="331" y="199" width="112" height="24" class="usung-wordmark ai-motion-brand"');
const wire = d => `<path class="ai-motion-wire" d="${d}"/>`;
const signal = (d, extra = '') => `<path class="ai-motion-signal ${extra}" d="${d}" pathLength="100"/>`;
const label = (x, y, text, extra = '') => `<text class="ai-motion-label ${extra}" x="${x}" y="${y}" text-anchor="middle">${text}</text>`;

const verify = `
<g class="ai-motion-architecture">
 <rect class="ai-motion-card" x="54" y="96" width="148" height="62" rx="10"/>
 <rect class="ai-motion-card" x="54" y="194" width="148" height="62" rx="10"/>
 <rect class="ai-motion-card" x="54" y="292" width="148" height="62" rx="10"/>
 <path class="ai-motion-ink" d="M78 115H128M78 128H174M78 141H151M78 213H153M78 226H174M78 239H128M78 311H128M78 324H174M78 337H151"/>
 ${wire('M202 127H234Q252 127 252 145V207Q252 225 270 225H306')}
 ${wire('M202 225H306')}
 ${wire('M202 323H234Q252 323 252 305V243Q252 225 270 225H306')}
 ${wire('M387 139V183M468 225H538')}
 <rect class="ai-motion-card" x="337" y="85" width="100" height="54" rx="10"/>
 <rect class="ai-motion-card ai-motion-layer" x="306" y="183" width="162" height="84" rx="12"/>
 <rect class="ai-motion-card" x="538" y="183" width="128" height="84" rx="12"/>
 <circle class="ai-motion-output-ring" cx="602" cy="225" r="21"/>
 <path class="ai-motion-check" d="M592 225L599 232L612 218"/>
</g>
${logo}
${label(387, 119, 'MODEL')}
${label(387, 249, 'VERIFY')}
${label(128, 399, 'SOURCES')}
${label(602, 314, 'OUTPUT')}
<g class="ai-motion-flow">
 ${signal('M202 127H234Q252 127 252 145V207Q252 225 270 225H306', 'ai-motion-evidence ai-motion-evidence-one')}
 ${signal('M202 225H306', 'ai-motion-evidence ai-motion-evidence-two')}
 ${signal('M202 323H234Q252 323 252 305V243Q252 225 270 225H306', 'ai-motion-evidence ai-motion-evidence-three')}
 ${signal('M387 139V183', 'ai-motion-model-signal')}
 ${signal('M468 225H538', 'ai-motion-verified-signal')}
 <path class="ai-motion-scan" d="M323 279H451"/>
 <circle class="ai-motion-confirm" cx="602" cy="225" r="29"/>
</g>`;

const control = `
<g class="ai-motion-architecture">
 ${wire('M180 230H290M358 230H548')}
 ${wire('M324 198V149Q324 133 340 133H391')}
 <circle class="ai-motion-terminal" cx="397" cy="133" r="5"/>
 <rect class="ai-motion-card" x="58" y="183" width="122" height="94" rx="12"/>
 <path class="ai-motion-ink" d="M84 207H153M84 230H153M84 253H153"/>
 <circle class="ai-motion-card" cx="324" cy="230" r="34"/>
 <path class="ai-motion-ink" d="M312 239V222H336V239M324 222V214"/>
 <circle class="ai-motion-terminal" cx="312" cy="239" r="3"/>
 <circle class="ai-motion-terminal" cx="324" cy="214" r="3"/>
 <circle class="ai-motion-terminal" cx="336" cy="239" r="3"/>
 <rect class="ai-motion-card" x="427" y="183" width="66" height="94" rx="12"/>
 <path class="ai-motion-wire" d="M440 202V258M480 202V258"/>
 <rect class="ai-motion-card" x="548" y="183" width="114" height="94" rx="12"/>
 <circle class="ai-motion-output-ring" cx="605" cy="230" r="21"/>
 <path class="ai-motion-ink" d="M595 230L602 237L615 223"/>
</g>
${label(119, 320, 'MODEL')}
${label(324, 320, 'ROUTE')}
${label(460, 320, 'GATE')}
${label(605, 320, 'EXECUTE')}
<g class="ai-motion-flow">
 <rect class="ai-motion-gate" x="456" y="201" width="8" height="58" rx="4"/>
 <circle class="ai-motion-gate-ring" cx="460" cy="230" r="22"/>
 <circle class="ai-motion-route-token" cx="195" cy="230" r="7"/>
 <circle class="ai-motion-control-confirm" cx="605" cy="230" r="29"/>
</g>`;

const observe = `
<g class="ai-motion-architecture">
 <rect class="ai-motion-card" x="54" y="106" width="384" height="246" rx="12"/>
 <path class="ai-motion-grid" d="M82 153H410M82 207H410M82 261H410M82 315H410M137 135V315M192 135V315M247 135V315M302 135V315M357 135V315"/>
 <path class="ai-motion-wire" d="M82 279L111 267L139 278L165 235L192 242L218 208L246 224L273 180L302 195L328 158L355 174L383 143L410 155"/>
 ${wire('M438 230H482')}
 <rect class="ai-motion-card" x="482" y="106" width="184" height="246" rx="12"/>
 <path class="ai-motion-ink" d="M505 131H556"/>
 <path class="ai-motion-log-line" d="M523 172H642M523 183H601M523 223H632M523 234H614M523 274H642M523 285H601"/>
 <circle class="ai-motion-log-base" cx="507" cy="178" r="5"/>
 <circle class="ai-motion-log-base" cx="507" cy="229" r="5"/>
 <circle class="ai-motion-log-base" cx="507" cy="280" r="5"/>
</g>
${label(246, 397, 'TRACE')}
${label(574, 397, 'LOG')}
<g class="ai-motion-flow">
 <path class="ai-motion-trace" d="M82 279L111 267L139 278L165 235L192 242L218 208L246 224L273 180L302 195L328 158L355 174L383 143L410 155" pathLength="100"/>
 <path class="ai-motion-cursor" d="M82 135V315"/>
 <circle class="ai-motion-log-marker ai-motion-log-one" cx="507" cy="178" r="5"/>
 <circle class="ai-motion-log-marker ai-motion-log-two" cx="507" cy="229" r="5"/>
 <circle class="ai-motion-log-marker ai-motion-log-three" cx="507" cy="280" r="5"/>
</g>`;

const scenes = [verify, control, observe];

export function aiMotionDiagram(index) {
  if (!Number.isInteger(index) || index < 0 || index >= scenes.length) throw new RangeError('AI scene index must be 0, 1 or 2');
  return `<div class="ai-motion-scene" data-ai-scene="${index}" aria-hidden="true"><svg class="ai-motion-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 460" width="720" height="460" focusable="false">${scenes[index]}</svg></div>`;
}
