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
if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
  entries.forEach(entry => entry.isIntersecting ? visibleVideos.add(entry.target) : visibleVideos.delete(entry.target));
  updateMedia();
}, { threshold: .05 }).observe(videos[0] || document.querySelector('main'));
reduced.addEventListener('change', updateMedia);
document.addEventListener('visibilitychange', updateMedia);
updateMedia();

// A procedural point sculpture expresses model-independent paths through one infrastructure.
const canvases = [...document.querySelectorAll('.corp-neural')];
const sculptures = [];
const curve = t => {
  const radius = 1.8 + .55 * Math.cos(3 * t);
  return [radius * Math.cos(2 * t), radius * Math.sin(2 * t), .68 * Math.sin(3 * t)];
};
canvases.forEach(canvas => {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;
  const rings = 160, circumference = innerWidth < 761 ? 15 : 30, points = [];
  for (let ring = 0; ring < rings; ring++) {
    const u = ring / rings * Math.PI * 2, p = curve(u), a = curve(u - .001), b = curve(u + .001);
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const length = Math.hypot(tx, ty, tz); tx /= length; ty /= length; tz /= length;
    let nx = -ty, ny = tx, nz = 0; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    for (let j = 0; j < circumference; j++) {
      const v = j / circumference * Math.PI * 2, r = .19 + .025 * Math.sin(u * 5);
      const cn = Math.cos(v) * r, sn = Math.sin(v) * r;
      points.push({ x: p[0] + nx * cn + bx * sn, y: p[1] + ny * cn + by * sn, z: p[2] + nz * cn + bz * sn, u, v, ring, j });
    }
  }
  const item = { canvas, ctx, points, visible: true, width: 0, height: 0 };
  const resize = () => {
    const box = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 1.5);
    item.width = box.width; item.height = box.height;
    canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(item, 0);
  };
  sculptures.push(item);
  new ResizeObserver(resize).observe(canvas);
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { item.visible = entries[0].isIntersecting; }, { threshold: .01 }).observe(canvas);
  resize();
});
function render(item, time) {
  const { ctx, width: w, height: h, points, canvas } = item;
  if (!w || !h) return;
  ctx.clearRect(0, 0, w, h);
  const card = canvas.dataset.neural === 'card';
  const centerX = w * (card ? .51 : w < 761 ? .63 : .73), centerY = h * (card ? .32 : .40);
  const scale = Math.min(w, h) * (card ? .21 : .24);
  const yaw = .55 + Math.sin(time * .12) * .25, pitch = -.5, roll = -.32 + time * .027;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.min(w, h) * .57);
  glow.addColorStop(0, 'rgba(53, 94, 113, .16)'); glow.addColorStop(1, 'rgba(12, 20, 24, 0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  for (const point of points) {
    const x1 = point.x * cy + point.z * sy, z1 = -point.x * sy + point.z * cy;
    const y1 = point.y * cp - z1 * sp, z2 = point.y * sp + z1 * cp;
    const x2 = x1 * cr - y1 * sr, y2 = x1 * sr + y1 * cr, perspective = 8 / (8 - z2);
    const px = centerX + x2 * scale * perspective, py = centerY + y2 * scale * perspective;
    const pulse = Math.sin(point.u * 3 - time * .7);
    const alpha = Math.max(.1, Math.min(.85, .43 + z2 * .13 + Math.cos(point.v) * .13));
    const orange = pulse > .975;
    ctx.fillStyle = orange ? 'rgba(255,102,57,' + alpha + ')' : 'rgba(214,229,237,' + alpha + ')';
    const radius = (orange ? 1.7 : 1.1) * perspective;
    ctx.fillRect(px, py, radius, radius);
  }
}
let lastFrame = 0;
const animate = now => {
  if (now - lastFrame > 33) {
    lastFrame = now;
    if (!userPaused && !reduced.matches && !document.hidden && !menuOpen) sculptures.forEach(item => { if (item.visible) render(item, now * .001); });
  }
  if (sculptures.length) requestAnimationFrame(animate);
};
if (sculptures.length) requestAnimationFrame(animate);

const fieldTabs = [...document.querySelectorAll('[data-field-tab]')];
const selectField = (index, focus = false) => {
  fieldTabs.forEach((tab, i) => {
    tab.classList.toggle('is-active', i === index);
    tab.setAttribute('aria-selected', String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
    document.getElementById('field-panel-' + i).hidden = i !== index;
    document.querySelector('[data-field-image="' + i + '"]').classList.toggle('is-active', i === index);
  });
  if (focus) fieldTabs[index].focus();
};
fieldTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectField(index));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % fieldTabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + fieldTabs.length - 1) % fieldTabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = fieldTabs.length - 1;
    if (next !== undefined) { event.preventDefault(); selectField(next, true); }
  });
});


})();
