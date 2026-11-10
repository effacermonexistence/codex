(() => {
  'use strict';
  const canvas = document.querySelector('#apply-artwork canvas');
  if (!canvas) return;
  // The lower field keeps its accepted tone. A separate short veil follows
  // the logo while the introduction opens up before the form.
  const host = canvas.parentElement;
  const form = document.querySelector('.fe-block-61b1bd79481c34f2f1bb');
  const intro = document.getElementById('block-5f763f8b417eaf376549');
  const logo = document.querySelector('main [data-body-wordmark="native"] .site-body-wordmark-image');
  const title = document.getElementById('block-09429f6eb187d25e035b');
  const phone = matchMedia('(max-width: 767px)');
  const originalVeil = [[0,.7],[.17,.25],[.38,.38],[.76,.68],[1,1]];
  function refreshIntroTone() {
    const bounds = host.getBoundingClientRect();
    if (bounds.height > 0) {
      const logoEnd = logo ? logo.getBoundingClientRect().bottom-bounds.top : 120;
      const formTop = form ? form.getBoundingClientRect().top-bounds.top : bounds.height;
      const titleTop = title ? title.getBoundingClientRect().top-bounds.top : logoEnd+128;
      const start = Math.max(0,Math.min(logoEnd+12,formTop-192));
      const end = Math.min(bounds.height,formTop-112,Math.max(start+64,Math.min(start+128,titleTop+40)));
      if (end > start) {
        const alpha = phone.matches ? .6 : .18;
        host.style.setProperty('--apply-logo-veil','linear-gradient(180deg,rgba(0,0,0,'+alpha+') 0px,rgba(0,0,0,'+(alpha*.9).toFixed(3)+') '+start.toFixed(3)+'px,rgba(0,0,0,0) '+end.toFixed(3)+'px)');
        host.dataset.logoFadeEnd=end.toFixed(3);
      }
    }
    if (!phone.matches || !form) {
      delete host.dataset.introTone;
      host.style.removeProperty('--apply-intro-veil');
      return;
    }
    const box = host.getBoundingClientRect();
    const end = Math.min(box.height, form.getBoundingClientRect().top-box.top-16);
    if (box.height <= 0 || end < 120) return;
    const start = Math.max(0,end-96), fraction = end/box.height;
    let oldAlpha = 1;
    for (let i=1;i<originalVeil.length;i++) {
      if (fraction <= originalVeil[i][0]) {
        const [a,alphaA] = originalVeil[i-1], [b,alphaB] = originalVeil[i];
        oldAlpha = alphaA+(alphaB-alphaA)*(fraction-a)/(b-a); break;
      }
    }
    // Original source opacity .45 becomes 1 above the form. Compensate the
    // black veil by 1-.45*(1-alpha) below it, preserving every lower tone.
    const lower = [[fraction,1-.45*(1-oldAlpha)],
      ...originalVeil.filter(([at])=>at>fraction).map(([at,alpha])=>[at,1-.45*(1-alpha)])];
    const stops = ['rgba(0,0,0,.16) 0px','rgba(0,0,0,.22) '+start.toFixed(3)+'px',
      ...lower.map(([at,alpha])=>'rgba(0,0,0,'+alpha.toFixed(8)+') '+(at*box.height).toFixed(3)+'px')];
    host.style.setProperty('--apply-intro-veil','linear-gradient(180deg,'+stops.join(',')+')');
    host.dataset.introTone = 'mobile';
    host.dataset.introFadeEnd = end.toFixed(3);
  }
  refreshIntroTone();
  const toneResize = new ResizeObserver(refreshIntroTone);
  toneResize.observe(host);
  if (form) toneResize.observe(form);
  if (intro) toneResize.observe(intro);
  if (logo) toneResize.observe(logo);
  if (title) toneResize.observe(title);
  window.addEventListener('pageshow',refreshIntroTone);
  phone.addEventListener('change',refreshIntroTone);
  document.fonts?.ready.then(refreshIntroTone);
  const painting = __AXIOM_SOURCE__;
  const vertex = __AXIOM_VERTEX__;
  const fragment = __AXIOM_FRAGMENT__;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let gl;
  try { gl = canvas.getContext('webgl', {alpha:false, antialias:false}); } catch {}
  if (!gl) { canvas.dataset.renderMode = 'image-fallback'; return; }
  let frame = 0, phaseTime = 0, priorTime = null, visible = false, pending = 0;
  try {
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error('Background shader');
      return shader;
    }
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Background program');
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program,'pos');
    gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    const uniform = name => gl.getUniformLocation(program,name);
    gl.uniform1f(uniform('marble'),0); gl.uniform1f(uniform('scrollZoom'),1);
    gl.uniform1i(uniform('painting0'),0); gl.uniform1i(uniform('painting1'),0); gl.uniform1i(uniform('painting2'),0);
    gl.uniform2f(uniform('center0'),...painting.center); gl.uniform2f(uniform('focus0'),.5,.5);
    const image = new Image();
    image.onload = () => {
      const texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);
      function draw() {
        gl.uniform1f(uniform('phase0'), phaseTime/18*2*Math.PI*painting.rate+painting.phase);
        gl.uniform1f(uniform('time'),phaseTime); gl.drawArrays(gl.TRIANGLES,0,6);
        canvas.classList.add('is-ready'); canvas.dataset.frames = String(++frame);
        canvas.dataset.renderMode = reduced.matches ? 'still' : 'animated';
      }
      function resize() {
        const r = canvas.parentElement.getBoundingClientRect();
        const scale = Math.min(1.25,Math.sqrt(1200000/Math.max(1,r.width*r.height)));
        canvas.width = Math.max(2,Math.round(r.width*scale)); canvas.height = Math.max(2,Math.round(r.height*scale));
        gl.viewport(0,0,canvas.width,canvas.height);
        const ar = canvas.width/canvas.height, sr = image.width/image.height;
        gl.uniform2f(uniform('crop0'),.94*Math.min(1,ar/sr),.94*Math.min(1,sr/ar)); draw();
      }
      function tick(now) {
        pending = 0;
        if (!visible || document.hidden || reduced.matches) { priorTime = null; return; }
        if (priorTime === null || now-priorTime >= 1000/30) {
          if (priorTime !== null) phaseTime += Math.min(64,now-priorTime)/1000;
          priorTime = now; draw();
        }
        pending = requestAnimationFrame(tick);
      }
      function resume() {
        if (pending) cancelAnimationFrame(pending);
        pending = 0; priorTime = null;
        if (reduced.matches) { draw(); return; }
        if (visible && !document.hidden) pending = requestAnimationFrame(tick);
      }
      resize(); new ResizeObserver(resize).observe(canvas.parentElement);
      new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;resume();},{rootMargin:'80px'}).observe(canvas.parentElement);
      document.addEventListener('visibilitychange',resume);
      reduced.addEventListener('change',resume);
      canvas.addEventListener('webglcontextlost',()=>{
        if (pending) cancelAnimationFrame(pending);
        canvas.classList.remove('is-ready'); canvas.dataset.renderMode='image-fallback';
      });
    };
    image.onerror = () => { canvas.dataset.renderMode='image-fallback'; };
    image.src = painting.url;
  } catch {
    canvas.dataset.renderMode = 'image-fallback';
  }
})();
