(() => {
  'use strict';
  const configNode = document.getElementById('home-ambient-audio-config');
  const root = document.getElementById('home-ambient-audio');
  if (!configNode || !root || root.dataset.mounted === 'true') return;
  const config = JSON.parse(configNode.textContent);
  const playbackStart = config.audio.playbackStartSeconds;
  const route = location.pathname.replace(/\/$/, '') || '/';
  if (!config.routes.includes(route)) { root.remove(); return; }
  root.dataset.mounted = 'true';
  const toggle = root.querySelector('[data-audio-toggle]');
  const label = toggle.querySelector('[data-audio-label]');
  const volume = root.querySelector('input[type="range"]');
  const output = root.querySelector('output');
  const panel = root.querySelector('[data-audio-panel]');
  const fr = route === '/exist-fr' || document.documentElement.lang.startsWith('fr');
  const words = fr ? {
    on: 'Son activé', off: 'Activer le son', waiting: 'Activer le son', loading: 'Chargement du son',
    error: 'Son indisponible — réessayer', mute: 'Couper le son', adjust: 'Régler le volume', volume: 'Volume'
  } : {
    on: 'Sound on', off: 'Enable sound', waiting: 'Enable sound', loading: 'Loading sound',
    error: 'Sound unavailable — retry', mute: 'Turn sound off', adjust: 'Adjust volume', volume: 'Volume'
  };
  let ctx, gain, source, bufferPromise;
  // Fresh visits are silent until the listener explicitly presses the sound toggle.
  let enabled = false, volumeOpen = false, level = 1, lastNonzero = 1, pageLive = true, failed = false;
  let pauseTimer = 0, clockTimer = 0, generation = 0;
  let clockConfirmed = false, clockBroken = false, decodedBuffer = null;
  let ownedSession = false, priorSessionType = null;
  function session(active) {
    // Optional standard API: playback intent, never microphone/system volume.
    try {
      const a = navigator.audioSession;
      if (!a) return;
      if (active) {
        if (!ownedSession) priorSessionType = a.type;
        a.type = 'playback'; ownedSession = true;
      } else if (ownedSession) {
        if (a.type === 'playback') a.type = priorSessionType || 'auto';
        ownedSession = false;
      }
    } catch (_) { /* Unsupported/restricted API must not disable the player. */ }
  }
  function confirmClock() {
    if (clockTimer || !ctx || ctx.state !== 'running' || !source || !pageLive || document.hidden || !enabled) return;
    const c = ctx, t = c.currentTime, epoch = generation;
    clockTimer = setTimeout(() => {
      clockTimer = 0;
      if (c !== ctx || epoch !== generation || !pageLive || document.hidden || !enabled) return;
      clockConfirmed = c.state === 'running' && c.currentTime > t + .02;
      clockBroken = c.state === 'running' && !clockConfirmed;
      render();
    }, 200);
  }
  function retireGraph() {
    clearTimeout(pauseTimer); pauseTimer = 0;
    clearTimeout(clockTimer); clockTimer = 0;
    const old = ctx;
    try { source?.stop(); source?.disconnect(); gain?.disconnect(); } catch (_) {}
    ctx = gain = source = bufferPromise = null;
    clockConfirmed = clockBroken = false;
    generation++;
    if (old && old.state !== 'closed') old.close().catch(() => {});
  }

  function state() {
    if (!pageLive || document.hidden || !enabled || level === 0) return 'off';
    if (failed) return 'error';
    if (!ctx || ctx.state !== 'running' || clockBroken) return 'waiting';
    return source && clockConfirmed ? 'playing' : 'loading';
  }
  function render() {
    const s = state();
    root.dataset.state = s;
    root.dataset.clock = clockBroken ? 'stalled' : clockConfirmed ? 'advancing' : 'awaiting';
    root.dataset.enabled = String(enabled);
    root.dataset.cycle = !enabled ? 'off' : volumeOpen ? 'volume' : 'playing';
    root.dataset.expanded = String(volumeOpen);
    root.dataset.volume = String(Math.round(level * 100));
    const action = failed ? words.error : !enabled ? words.off : volumeOpen ? words.mute : words.adjust;
    label.textContent = action;
    toggle.title = action;
    toggle.setAttribute('aria-label', action);
    toggle.setAttribute('aria-pressed', String(enabled && !failed));
    toggle.setAttribute('aria-expanded', String(volumeOpen));
    panel.hidden = !volumeOpen;
    volume.value = String(Math.round(level * 100));
    volume.setAttribute('aria-label', words.volume);
    volume.setAttribute('aria-valuetext', volume.value + '%');
    output.value = output.textContent = volume.value + '%';
  }
  function applyGain(immediate = false) {
    if (!ctx || !gain || ctx.state === 'closed') return;
    const target = enabled && pageLive && !document.hidden ? Math.min(1, Math.max(0, level)) : 0;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    if (immediate) gain.gain.setValueAtTime(target, t);
    else gain.gain.linearRampToValueAtTime(target, t + .03);
  }
  function graph() {
    if (ctx && ctx.state !== 'closed') return ctx;
    clearTimeout(clockTimer); clockTimer = 0; clockConfirmed = clockBroken = false;
    generation++;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Web Audio is unavailable');
    ctx = new Audio({ latencyHint: 'playback' });
    gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const c = ctx;
    c.addEventListener('statechange', () => {
      if (c !== ctx) return;
      if (c.state !== 'running') { clockConfirmed = false; clearTimeout(clockTimer); clockTimer = 0; }
      else confirmClock();
      render();
    });
    source = null;
    bufferPromise = null;
    return ctx;
  }
  function prepare() {
    const c = graph();
    if (source || bufferPromise) return;
    const epoch = generation;
    bufferPromise = decodedBuffer ? Promise.resolve(decodedBuffer) : fetch(config.audio.url, { credentials: 'same-origin', cache: 'force-cache' })
      .then(r => { if (!r.ok) throw new Error('Audio response ' + r.status); return r.arrayBuffer(); })
      .then(bytes => c.decodeAudioData(bytes));
    bufferPromise = bufferPromise.then(buffer => {
        decodedBuffer = buffer;
        if (c !== ctx || epoch !== generation) return;
        // One sample-accurate looping source per page, never one per click.
        if (!source) {
          source = c.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          // Keep the original No.13 file intact, but never replay its beep intro.
          source.loopStart = playbackStart;
          source.loopEnd = buffer.duration;
          source.connect(gain);
          source.start(0, playbackStart);
        }
        applyGain();
        confirmClock();
        render();
      }).catch(() => {
        if (c !== ctx || epoch !== generation) return;
        bufferPromise = null;
        failed = true; session(false);
        render();
      });
  }
  function start(trustedGesture = false) {
    if (!pageLive || document.hidden || !enabled || level === 0 || failed) return;
    session(true);
    if (trustedGesture && (clockBroken || ctx?.state === 'interrupted')) retireGraph();
    clearTimeout(pauseTimer);
    try {
      const c = graph();
      // Call resume synchronously in a genuine click/key handler when present.
      // Outside a gesture the browser may suspend it; do not fake playing state.
      c.resume().then(() => {
        applyGain();
        if (c !== ctx) return;
        if (!pageLive || document.hidden || !enabled || level === 0) c.suspend().catch(() => {});
        confirmClock();
        render();
      }).catch(() => { if (c === ctx) render(); });
      prepare();
      applyGain();
    } catch (_) { failed = true; session(false); }
    render();
  }
  function silence() {
    clearTimeout(pauseTimer);
    clearTimeout(clockTimer); clockTimer = 0; clockConfirmed = false;
    session(false);
    applyGain();
    pauseTimer = setTimeout(() => {
      if (ctx && ctx.state === 'running' && (!enabled || level === 0 || !pageLive || document.hidden)) {
        ctx.suspend().catch(() => {});
      }
    }, 80);
    render();
  }
  toggle.addEventListener('click', event => {
    if (failed) {
      failed = false;
      enabled = true;
      if (level === 0) level = lastNonzero || 1;
      start(event.isTrusted);
    } else if (!enabled) {
      enabled = true;
      if (level === 0) level = lastNonzero || 1;
      start(event.isTrusted);
    } else if (!volumeOpen) {
      volumeOpen = true;
      render();
    } else {
      enabled = false;
      silence();
      retireGraph();
      render();
    }
  });
  volume.addEventListener('input', event => {
    level = Math.min(1, Math.max(0, Number(volume.value) / 100));
    if (level > 0) lastNonzero = level;
    failed = false;
    if (level === 0) { enabled = false; silence(); retireGraph(); }
    else { enabled = true; start(event.isTrusted); }
    render();
  });
  document.addEventListener('pointerdown', event => {
    if (volumeOpen && !root.contains(event.target)) {
      volumeOpen = false;
      render();
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && volumeOpen) {
      volumeOpen = false;
      render();
      toggle.focus();
    }
  });
  // A range input event alone does not carry a valid activation on every iOS
  // version. Also resume directly in the end of the genuine touch/pointer.
  for (const type of ['touchend','pointerup']) volume.addEventListener(type, event => {
    if (enabled && !failed && level > 0) start(event.isTrusted);
  }, { passive: true });
  window.addEventListener('pagehide', () => {
    pageLive = false;
    clearTimeout(pauseTimer); clearTimeout(clockTimer); clockTimer = 0;
    clockConfirmed = false; session(false);
    applyGain(true);
    if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
    render();
  });
document.addEventListener('visibilitychange', () => {
    if (document.hidden) silence();
    else if (enabled && level > 0 && !failed) start();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    pageLive = true;
    enabled = false;
    volumeOpen = false;
    failed = false;
    session(false);
    retireGraph();
    render();
  });
  render();
})();
