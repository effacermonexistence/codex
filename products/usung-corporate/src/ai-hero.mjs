// An original native illustration: opaque architectural surfaces, not photographic media.
export function aiHeroArt() {
  return `<div class="ai-hero-motion" data-ai-hero-motion aria-hidden="true"><svg class="ai-hero-motion-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="1600" height="1000" preserveAspectRatio="xMidYMid slice" focusable="false">
<defs>
 <linearGradient id="ai-hero-shell" x1="820" y1="260" x2="1370" y2="860" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset=".45" stop-color="#f8f7f2"/><stop offset=".76" stop-color="#e7e7df"/><stop offset="1" stop-color="#c9cdc4"/></linearGradient>
 <linearGradient id="ai-hero-depth" x1="700" y1="420" x2="1380" y2="900" gradientUnits="userSpaceOnUse"><stop stop-color="#e2e3da"/><stop offset=".5" stop-color="#b9bfb4"/><stop offset="1" stop-color="#747c70"/></linearGradient>
 <linearGradient id="ai-hero-plane" x1="1000" y1="360" x2="1240" y2="760" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset=".62" stop-color="#f5f5ef"/><stop offset="1" stop-color="#d9ddd3"/></linearGradient>
 <linearGradient id="ai-hero-plane-edge" x1="830" y1="470" x2="1390" y2="740" gradientUnits="userSpaceOnUse"><stop stop-color="#bdc3b7"/><stop offset=".46" stop-color="#525c4c"/><stop offset="1" stop-color="#d6dbd0"/></linearGradient>
 <radialGradient id="ai-hero-floor-shadow"><stop stop-color="#151616" stop-opacity=".14"/><stop offset=".56" stop-color="#151616" stop-opacity=".055"/><stop offset="1" stop-color="#151616" stop-opacity="0"/></radialGradient>
 <radialGradient id="ai-hero-inner-shadow" cx=".34" cy=".68" r=".8"><stop stop-color="#c3c9ba" stop-opacity=".65"/><stop offset=".75" stop-color="#eeede7" stop-opacity="0"/></radialGradient>
 <clipPath id="ai-hero-window"><path d="M820 540C820 397 943 300 1095 300C1247 300 1370 397 1370 540C1370 683 1247 780 1095 780C943 780 820 683 820 540Z"/></clipPath>
</defs>
<ellipse class="ai-hero-floor" cx="1082" cy="830" rx="518" ry="106" fill="url(#ai-hero-floor-shadow)"/>
<g class="ai-hero-assembly">
 <g transform="rotate(-26 1095 540)">
  <path class="ai-hero-back-rim" transform="translate(7 23)" fill="url(#ai-hero-depth)" fill-rule="evenodd" d="M670 540C670 341 860 180 1095 180C1330 180 1520 341 1520 540C1520 739 1330 900 1095 900C860 900 670 739 670 540ZM820 540C820 397 943 300 1095 300C1247 300 1370 397 1370 540C1370 683 1247 780 1095 780C943 780 820 683 820 540Z"/>
  <g clip-path="url(#ai-hero-window)">
   <ellipse cx="1095" cy="568" rx="288" ry="239" fill="url(#ai-hero-inner-shadow)"/>
   <g class="ai-hero-routing-planes">
    <path fill="url(#ai-hero-plane-edge)" d="M850 422L1118 285L1378 425V444L1118 592L850 441Z"/>
    <path class="ai-hero-plane" fill="url(#ai-hero-plane)" d="M850 422L1118 285L1378 425L1118 572Z"/>
    <path class="ai-hero-plane-contour" d="M922 422L1118 322L1303 422"/>
    <path fill="url(#ai-hero-plane-edge)" d="M830 518L1098 365L1370 520V538L1100 698L830 536Z"/>
    <path class="ai-hero-plane" fill="url(#ai-hero-plane)" d="M830 518L1098 365L1370 520L1100 680Z"/>
    <path class="ai-hero-plane-contour" d="M910 520L1098 412L1286 519"/>
    <path class="ai-hero-routing-trace" d="M910 520L1098 412L1286 519" pathLength="100"/>
    <path fill="url(#ai-hero-plane-edge)" d="M870 630L1130 460L1390 620V638L1130 808L870 648Z"/>
    <path class="ai-hero-plane" fill="url(#ai-hero-plane)" d="M870 630L1130 460L1390 620L1130 790Z"/>
    <path class="ai-hero-plane-contour" d="M947 628L1130 510L1314 625"/>
   </g>
  </g>
  <path class="ai-hero-front-shell" fill="url(#ai-hero-shell)" fill-rule="evenodd" d="M670 540C670 341 860 180 1095 180C1330 180 1520 341 1520 540C1520 739 1330 900 1095 900C860 900 670 739 670 540ZM820 540C820 397 943 300 1095 300C1247 300 1370 397 1370 540C1370 683 1247 780 1095 780C943 780 820 683 820 540Z"/>
  <path class="ai-hero-shell-edge" d="M820 540C820 397 943 300 1095 300C1247 300 1370 397 1370 540C1370 683 1247 780 1095 780C943 780 820 683 820 540Z"/>
  <path class="ai-hero-shell-highlight" d="M715 496C735 330 897 222 1095 222C1293 222 1455 330 1475 496"/>
  <path class="ai-hero-orbit-rail" d="M638 540C638 319 843 139 1095 139C1347 139 1552 319 1552 540C1552 761 1347 941 1095 941C843 941 638 761 638 540Z"/>
  <path class="ai-hero-orbit-signal" d="M638 540C638 319 843 139 1095 139C1347 139 1552 319 1552 540C1552 761 1347 941 1095 941C843 941 638 761 638 540Z" pathLength="100"/>
 </g>
</g>
</svg></div>`;
}
