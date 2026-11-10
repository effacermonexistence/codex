(() => {
  'use strict';
  const configNode = document.getElementById('home-ambient-audio-config');
  const root = document.getElementById('home-ambient-audio');
  if (!configNode || !root || root.dataset.mounted === 'true') return;
  const config = JSON.parse(configNode.textContent);
  const route = location.pathname.replace(/\/$/, '') || '/';
  if (!config.routes.includes(route)) { root.remove(); return; }
  root.dataset.mounted = 'true';
  const toggle = root.querySelector('[data-audio-toggle]');
  const label = toggle.querySelector('[data-audio-label]');
  const volume = root.querySelector('input[type="range"]');
  const output = root.querySelector('output');
  const summary = root.querySelector('summary');
  const fr = route === '/exist-fr' || document.documentElement.lang.startsWith('fr');
  const words = fr ? {
    on: 'Son activé', off: 'Son coupé', waiting: 'Activer le son', loading: 'Chargement du son',
    error: 'Son indisponible — réessayer', mute: 'Couper le son', volume: 'Volume'
  } : {
    on: 'Sound on', off: 'Sound off', waiting: 'Enable sound', loading: 'Loading sound',
    error: 'Sound unavailable — retry', mute: 'Turn sound off', volume: 'Volume'
  };
  let ctx, gain, source, bufferPromise;
  let enabled = true, level = 1, lastNonzero = 1, pageLive = true, failed = false;
  let pauseTimer = 0;

  function state() {
    if (!pageLive || !enabled || level === 0) return 'off';
    if (failed) return 'error';
    if (!ctx || ctx.state !== 'running') return 'waiting';
    return source ? 'playing' : 'loading';
  }
  function render() {
    const s = state();
    root.dataset.state = s;
    root.dataset.enabled = String(enabled);
    root.dataset.volume = String(Math.round(level * 100));
    const text = s === 'playing' ? words.on : s === 'off' ? words.off : words[s];
    label.textContent = text;
    toggle.title = s === 'playing' || s === 'loading' ? words.mute : text;
    toggle.setAttribute('aria-label', toggle.title);
    toggle.setAttribute('aria-pressed', String(s === 'playing'));
    volume.value = String(Math.round(level * 100));
    volume.setAttribute('aria-label', words.volume);
    volume.setAttribute('aria-valuetext', volume.value + '%');
    output.value = output.textContent = volume.value + '%';
    summary.title = words.volume;
    summary.setAttribute('aria-label', words.volume);
  }
  function applyGain(immediate = false) {
    if (!ctx || !gain || ctx.state === 'closed') return;
    const target = enabled && pageLive ? Math.min(1, Math.max(0, level)) : 0;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    if (immediate) gain.gain.setValueAtTime(target, t);
    else gain.gain.linearRampToValueAtTime(target, t + .03);
  }
  function graph() {
    if (ctx && ctx.state !== 'closed') return ctx;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Web Audio is unavailable');
    ctx = new Audio({ latencyHint: 'playback' });
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    ctx.addEventListener('statechange', render);
    source = null;
    bufferPromise = null;
    return ctx;
  }
  function prepare() {
    const c = graph();
    if (source || bufferPromise) return;
    bufferPromise = fetch(config.audio.url, { credentials: 'same-origin', cache: 'force-cache' })
      .then(r => { if (!r.ok) throw new Error('Audio response ' + r.status); return r.arrayBuffer(); })
      .then(bytes => c.decodeAudioData(bytes))
      .then(buffer => {
        // One sample-accurate looping source per page, never one per click.
        if (!source) {
          source = c.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          source.connect(gain);
          source.start();
        }
        applyGain();
        render();
      }).catch(() => {
        bufferPromise = null;
        failed = true;
        render();
      });
  }
  function start() {
    if (!pageLive || !enabled || level === 0 || failed) return;
    clearTimeout(pauseTimer);
    try {
      const c = graph();
      // Call resume synchronously in a genuine click/key handler when present.
      // Outside a gesture the browser may suspend it; do not fake playing state.
      c.resume().then(() => {
        applyGain();
        if (!pageLive || !enabled || level === 0) c.suspend().catch(() => {});
        render();
      }).catch(render);
      prepare();
      applyGain();
    } catch (_) { failed = true; }
    render();
  }
  function silence() {
    clearTimeout(pauseTimer);
    applyGain();
    pauseTimer = setTimeout(() => {
      if (ctx && ctx.state === 'running' && (!enabled || level === 0 || !pageLive)) {
        ctx.suspend().catch(() => {});
      }
    }, 80);
    render();
  }
  toggle.addEventListener('click', () => {
    if (state() === 'playing' || state() === 'loading') {
      enabled = false;
      silence();
    } else {
      enabled = true;
      if (level === 0) level = lastNonzero || 1;
      failed = false;
      start();
    }
  });
  volume.addEventListener('input', () => {
    level = Math.min(1, Math.max(0, Number(volume.value) / 100));
    if (level > 0) lastNonzero = level;
    enabled = level > 0;
    failed = false;
    if (enabled) start(); else silence();
    render();
  });
  summary.addEventListener('click', () => { if (enabled && !failed) start(); });
  function gesture(event) {
    if (!event.isTrusted || root.contains(event.target) || !enabled || failed || !pageLive) return;
    if (event.type === 'keydown' && (event.ctrlKey || event.metaKey || event.key === 'Escape')) return;
    if (state() !== 'playing') start();
  }
  document.addEventListener('click', gesture);
  document.addEventListener('keydown', gesture);
  window.addEventListener('pagehide', () => {
    pageLive = false;
    clearTimeout(pauseTimer);
    applyGain(true);
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    render();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    pageLive = true;
    enabled = true;
    level = lastNonzero = 1;
    failed = false;
    start();
  });
  render();
  start();
})();
