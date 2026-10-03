(() => {
const toggle = document.querySelector('.corp-menu-toggle');
const navigation = document.querySelector('.corp-nav');
const header = document.querySelector('.corp-header');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let menuOpen = false;
let userPaused = false;
const setOpen = (open, restoreFocus = false) => {
  menuOpen = open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? '사업 메뉴 닫기' : '사업 메뉴 열기');
  navigation.classList.toggle('is-open', open);
  header.classList.toggle('menu-open', open);
  document.querySelector('main').inert = open;
  const footer = document.querySelector('.corp-footer') || document.querySelector('.site-footer');
  if (footer) footer.inert = open;
  if (open) navigation.querySelector('a').focus();
  else if (restoreFocus) toggle.focus();
  updateMedia();
};
toggle.addEventListener('click', () => setOpen(!menuOpen));
navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
document.addEventListener('click', event => { if (menuOpen && !event.target.closest('.corp-header')) setOpen(false); });
document.addEventListener('keydown', event => {
  if (!menuOpen) return;
  if (event.key === 'Escape') { event.preventDefault(); setOpen(false, true); }
  if (event.key === 'Tab') {
    const items = [document.querySelector('.corp-brand'), toggle, ...navigation.querySelectorAll('a')];
    const current = items.indexOf(document.activeElement);
    event.preventDefault();
    items[(current + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
  }
});
matchMedia('(min-width: 761px)').addEventListener('change', () => { if (menuOpen) setOpen(false); });
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
  const blocked = userPaused || reduced.matches || document.hidden || menuOpen;
  videos.forEach(video => { if (!blocked && visibleVideos.has(video)) video.play().catch(() => {}); else video.pause(); });
  if (motionButton) {
    const paused = userPaused || reduced.matches;
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.setAttribute('aria-label', paused ? '배경 움직임 재생' : '배경 움직임 일시정지');
    motionButton.querySelector('span').textContent = paused ? 'PLAY MOTION' : 'PAUSE MOTION';
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
 const select = (index, focus = false) => {
  tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; });
  panels.forEach((panel, i) => { panel.hidden = i !== index; });
  if (focus) tabs[index].focus();
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
});
})();
