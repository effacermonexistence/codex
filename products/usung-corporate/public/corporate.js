(() => {
const t = (...args) => window.UsungI18n?.t(...args) ?? args[0];
const header = document.querySelector('.corp-header');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let userPaused = false;
let scrollPending = false;
const updateScroll = () => {
  scrollPending = false;
  header.classList.toggle('is-scrolled', scrollY > 50);
  const max = document.documentElement.scrollHeight - innerHeight;
  document.querySelector('.corp-progress i').style.transform = 'scaleX(' + (max > 0 ? Math.min(1, scrollY / max) : 0) + ')';
};
addEventListener('scroll', () => { if (!scrollPending) { scrollPending = true; requestAnimationFrame(updateScroll); } }, { passive: true });
updateScroll();
const videos = [...document.querySelectorAll('.corp-page video')];
const visibleVideos = new Set();
const motionButton = document.querySelector('.corp-motion');
function updateMedia() {
  const blocked = userPaused || reduced.matches || document.hidden;
  videos.forEach(video => { if (!blocked && visibleVideos.has(video)) video.play().catch(() => {}); else video.pause(); });
  if (motionButton) {
    const paused = userPaused || reduced.matches;
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.setAttribute('aria-label', t(paused ? '배경 움직임 재생' : '배경 움직임 일시정지'));
    motionButton.querySelector('span').textContent = t(paused ? 'PLAY MOTION' : 'PAUSE MOTION');
    motionButton.querySelector('i').textContent = paused ? '▷' : 'Ⅱ';
  }
}
if (motionButton) motionButton.addEventListener('click', () => { userPaused = !userPaused; updateMedia(); });
if ('IntersectionObserver' in window) {
 const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => entry.isIntersecting ? visibleVideos.add(entry.target) : visibleVideos.delete(entry.target));
  updateMedia();
 }, { threshold: .05 });
 videos.forEach(video => observer.observe(video));
} else { videos.forEach(video => visibleVideos.add(video)); }
reduced.addEventListener('change', updateMedia);
document.addEventListener('visibilitychange', updateMedia);
updateMedia();

document.querySelectorAll('[data-ref-tabs]').forEach(group => {
 const tabs = [...group.querySelectorAll('[data-ref-tab]')];
 const panels = [...group.querySelectorAll('[data-ref-panel]')];
 const toggle = group.querySelector('[data-ai-motion-toggle]');
 let diagramPaused = false;
 let diagramVisible = !('IntersectionObserver' in window);
 const updateDiagramMotion = () => {
  group.dataset.motionRunning = String(diagramVisible && !diagramPaused && !reduced.matches && !document.hidden);
  if (!toggle) return;
  toggle.hidden = reduced.matches;
  toggle.dataset.paused = String(diagramPaused);
  const label = t(diagramPaused ? 'PLAY ANIMATION' : 'PAUSE ANIMATION');
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
 };
 const select = (index, focus = false) => {
  tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
  panels.forEach((panel, i) => { panel.hidden = i !== index; });
  if (focus) tabs[index].focus();
  updateDiagramMotion();
 };
 tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => select(index));
  tab.addEventListener('keydown', event => {
   let next;
   if (['ArrowRight','ArrowDown'].includes(event.key)) next = (index + 1) % tabs.length;
   if (['ArrowLeft','ArrowUp'].includes(event.key)) next = (index + tabs.length - 1) % tabs.length;
   if (event.key === 'Home') next = 0;
   if (event.key === 'End') next = tabs.length - 1;
   if (next !== undefined) { event.preventDefault(); select(next, true); }
  });
 });
 if (toggle) {
  toggle.addEventListener('click', () => { diagramPaused = !diagramPaused; updateDiagramMotion(); });
  if ('IntersectionObserver' in window) {
   const diagramObserver = new IntersectionObserver(entries => {
    diagramVisible = entries.some(entry => entry.isIntersecting);
    updateDiagramMotion();
   }, { threshold: .08 });
   diagramObserver.observe(group.querySelector('.ref-platform-visual'));
  }
  reduced.addEventListener('change', updateDiagramMotion);
  document.addEventListener('visibilitychange', updateDiagramMotion);
 }
 updateDiagramMotion();
});
})();
