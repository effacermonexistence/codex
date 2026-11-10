(() => {
  'use strict';
  const start = () => document.querySelectorAll('[data-effacer-hero="recursive-soft-no11"]').forEach(host => {
    const video = host.querySelector('video');
    if (!video || host.dataset.heroBound) return;
    host.dataset.heroBound = 'true';
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
