(() => {
  'use strict';
  const start = () => document.querySelectorAll('[data-effacer-hero="recursive-soft-no11"]').forEach(host => {
    const video = host.querySelector('video');
    if (!video || host.dataset.heroBound) return;
    host.dataset.heroBound = 'true';
    // Anchor the actual source convergence point, not the video rectangle's center.
    // The smallest uniform cover scale prevents exposed edges at any aspect ratio.
    const focalX = Number(host.dataset.heroFocalX);
    const focalY = Number(host.dataset.heroFocalY);
    if (focalX > 0 && focalX < 1 && focalY > 0 && focalY < 1) {
      const align = () => {
        const box = host.getBoundingClientRect();
        if (!(box.width > 0 && box.height > 0)) return;
        const scale = Math.max(box.width / (1920 * 2 * Math.min(focalX, 1 - focalX)), box.height / (1080 * 2 * Math.min(focalY, 1 - focalY)));
        const width = 1920 * scale, height = 1080 * scale;
        for (const media of host.querySelectorAll(':scope > img, :scope > video')) {
          Object.assign(media.style, { inset: 'auto', width: width + 'px', height: height + 'px', left: (box.width / 2 - focalX * width) + 'px', top: (box.height / 2 - focalY * height) + 'px', objectFit: 'fill', objectPosition: '50% 50%' });
        }
        host.dataset.heroAlignment = 'source-point-centered-v1';
      };
      align();
      if (window.ResizeObserver) new ResizeObserver(align).observe(host);
      else window.addEventListener('resize', align, { passive: true });
      window.addEventListener('pageshow', align);
    }
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    const poster = () => host.classList.remove('is-playing');
    const ready = () => { if (!still.matches && !video.error && !video.paused && video.readyState >= 2) host.classList.add('is-playing'); };
    const paint = () => {
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(ready);
      else ready();
    };
    video.addEventListener('playing', paint);
    video.addEventListener('error', poster);
    video.addEventListener('emptied', poster);
    const play = () => { if (still.matches) { video.pause(); poster(); } else video.play().then(paint).catch(poster); };
    still.addEventListener?.('change', play);
    play();
  });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, {once:true}) : start();
})();
