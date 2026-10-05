// A distinct, decorative signal field for the corporate overview.
// The AI division uses its own sculptural hero rather than repeating this scene.
export function homeAiArt() {
  const curves = Array.from({ length: 29 }, (_, i) => {
    const y = 100 + i * 24;
    const d = `M-100 ${y + 110} C240 ${y + 250} 340 ${y - 180} 650 ${y - 20} S1010 ${y + 250} 1540 ${y - 190}`;
    return `<path d="${d}"/>`;
  }).join('');
  return `<div class="home-ai-signal-field" data-ai-hero-motion aria-hidden="true"><svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" focusable="false"><defs><linearGradient id="home-ai-line" x1="0" x2="1"><stop stop-color="#b6bab5" stop-opacity=".12"/><stop offset=".5" stop-color="#575f5a" stop-opacity=".56"/><stop offset="1" stop-color="#8b968e" stop-opacity=".24"/></linearGradient></defs><g class="home-ai-waves" fill="none" stroke="url(#home-ai-line)" stroke-width="1.2">${curves}</g><g class="home-ai-signals" fill="none" stroke="#FF0F6F" stroke-width="2"><path d="M-100 450C240 590 340 160 650 320S1010 590 1540 150" pathLength="100"/><path d="M-100 594C240 734 340 304 650 464S1010 734 1540 294" pathLength="100"/></g></svg></div>`;
}
