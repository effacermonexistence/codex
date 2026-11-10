(() => {
  'use strict';
  const canvas = document.querySelector('#apply-artwork canvas');
  if (!canvas) return;
  // Keep the accepted lower field's composite brightness exactly. Only the
  // phone introduction opens up, ending in a short fade before the form.
  const host = canvas.parentElement;
  const form = document.querySelector('.fe-block-61b1bd79481c34f2f1bb');
  const intro = document.getElementById('block-5f763f8b417eaf376549');
  const phone = matchMedia('(max-width: 767px)');
  const originalVeil = [[0,.7],[.17,.25],[.38,.38],[.76,.68],[1,1]];
  function refreshIntroTone() {
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
  phone.addEventListener('change',refreshIntroTone);
  document.fonts?.ready.then(refreshIntroTone);
  const painting = {"url":"/s/fullfield-axiom-b9404bf108de.png","sourceSha256":"b9404bf108de86f1a698e562560f5f615339f42cb96d3ee0738a3f56572d2dec","center":[-0.7,0.18],"phase":0.37,"file":"fullfield-axiom-b9404bf108de.png","rate":1};
  const vertex = "attribute vec2 pos;varying vec2 uv;uniform float scrollZoom;void main(){uv=vec2((pos.x+1.)*.5,(1.-pos.y)*.5);if(scrollZoom>1.000001)uv=.5+(uv-.5)/scrollZoom;gl_Position=vec4(pos,0.,1.);}";
  const fragment = "precision highp float; varying vec2 uv;\n  uniform sampler2D painting0,painting1,painting2;\n  uniform vec2 crop0,crop1,crop2,center0,center1,center2,focus0,focus1,focus2;\n  uniform float phase0,phase1,phase2,time,marble;\n  float brush(float x){x=clamp(x,0.,1.);return x*x*x*(x*(x*6.-15.)+10.);}\n  vec3 plane(sampler2D tex,vec2 p,vec2 crop,vec2 focus,float phase,float depth){\n    vec2 v=p-.5;\n    vec2 flow=vec2(sin(v.y*10.+phase)+.43*sin(v.x*7.-v.y*5.+2.*phase),cos(v.x*9.-phase)+.37*sin(v.y*8.+v.x*4.-2.*phase));\n    vec2 warped=clamp(focus+(p+.019*flow-.5)*crop,.001,.999);\n    return texture2D(tex,warped).rgb*pow(.973,depth);\n  }\n  vec3 recurse(sampler2D tex,vec2 p,vec2 crop,vec2 focus,vec2 center,float phase){\n    float scale=.88+.008*sin(phase),depth=0.,remaining=1.;vec3 color=vec3(0.);\n    for(int i=0;i<24;i++){\n      vec2 q=(p-(1.-scale)*center)/scale;\n      if(q.x<=0.||q.x>=1.||q.y<=0.||q.y>=1.)break;\n      float edge=min(min(q.x,1.-q.x),min(q.y,1.-q.y));float a=brush(edge/.105);\n      color+=remaining*(1.-a)*plane(tex,p,crop,focus,phase,depth);remaining*=a;p=q;depth+=1.;\n      if(remaining<.00001)break;\n    }\n    return color+remaining*plane(tex,p,crop,focus,phase,depth);\n  }\n  void main(){\n    vec3 a=recurse(painting0,uv,crop0,focus0,center0,phase0);\n    if(marble<.5){gl_FragColor=vec4(a,1.);return;}\n    vec3 b=mix(plane(painting1,uv,crop1,focus1,phase1,0.),recurse(painting1,uv,crop1,focus1,center1,phase1),.22);\n    vec3 c=recurse(painting2,uv,crop2,focus2,center2,phase2);\n    // Flowing nonradial ribbons: no straight seam, circular frame, or spiral hub.\n    vec2 q=uv+vec2(.10*sin(uv.y*5.4+time*.10)+.045*sin(uv.y*13.-time*.065),.065*sin(uv.x*6.5-time*.08));\n    float ribbon=q.x+.15*sin(q.y*4.8+.7*sin(q.x*5.+time*.05))+ .04*sin(q.y*15.+time*.08);\n    float woman=brush((ribbon-.20)/.22)*(1.-brush((ribbon-.78)/.22));\n    float side=brush((ribbon-.34)/.40);\n    vec3 weights=vec3((1.-woman)*(1.-side),woman,(1.-woman)*side)+.025;\n    weights/=weights.x+weights.y+weights.z;\n    gl_FragColor=vec4(a*weights.x+b*weights.y+c*weights.z,1.);\n  }";
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
