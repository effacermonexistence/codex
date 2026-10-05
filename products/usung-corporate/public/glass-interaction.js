(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const vertexSource = `attribute vec2 a_position; varying vec2 v_uv; void main(){ v_uv=a_position*.5+.5; gl_Position=vec4(a_position,0.,1.); }`;
  const fragmentSource = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform vec2 u_scale;
    uniform vec2 u_offset;
    uniform vec2 u_shift;
    uniform float u_strength;
    void main(){
      vec2 uv=v_uv*u_scale+u_offset;
      if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.){gl_FragColor=vec4(0.);return;}
      vec4 original=texture2D(u_texture,uv);
      float interior=smoothstep(.75,.98,original.a);
      vec4 refracted=texture2D(u_texture,clamp(uv+u_shift*interior,vec2(0.),vec2(1.)));
      gl_FragColor=vec4(mix(original.rgb,refracted.rgb,.22*u_strength*interior),original.a);
    }`;

  function makeRenderer(canvas, image) {
    const gl = canvas.getContext('webgl', { alpha:true, premultipliedAlpha:false, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:false, powerPreference:'low-power' });
    if (!gl || image.naturalWidth > gl.getParameter(gl.MAX_TEXTURE_SIZE) || image.naturalHeight > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return null;
    const shader = (type, source) => {
      const result = gl.createShader(type);
      if (!result) throw new Error('shader');
      gl.shaderSource(result, source); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); throw new Error('shader'); }
      return result;
    };
    let program, texture, buffer, vertex, fragment;
    try {
      vertex = shader(gl.VERTEX_SHADER, vertexSource); fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
      program = gl.createProgram();
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      vertex=fragment=null;
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('program');
      gl.useProgram(program);
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.disable(gl.BLEND); gl.clearColor(0,0,0,0);
      const uniforms = Object.fromEntries(['texture','scale','offset','shift','strength'].map(name => [name,gl.getUniformLocation(program,'u_'+name)]));
      gl.uniform1i(uniforms.texture, 0);
      let scaleX=1, scaleY=1, offsetX=0, offsetY=0;
      const positionFraction = (part, axis) => {
        if (part === 'center') return .5;
        if (part === (axis === 'x' ? 'left' : 'top')) return 0;
        if (part === (axis === 'x' ? 'right' : 'bottom')) return 1;
        return part?.endsWith('%') ? clamp(parseFloat(part)/100,0,1) : .5;
      };
      return {
        resize() {
          const width=Math.max(1,canvas.clientWidth), height=Math.max(1,canvas.clientHeight);
          const ratio=Math.min(devicePixelRatio || 1,1.5,Math.sqrt(1150000/(width*height)),1536/Math.max(width,height));
          const targetWidth=Math.max(1,Math.round(width*ratio)), targetHeight=Math.max(1,Math.round(height*ratio));
          if (canvas.width!==targetWidth || canvas.height!==targetHeight) { canvas.width=targetWidth; canvas.height=targetHeight; }
          gl.viewport(0,0,canvas.width,canvas.height);
          const style=getComputedStyle(image), fit=style.objectFit;
          const factor=fit==='cover' ? Math.max(width/image.naturalWidth,height/image.naturalHeight) : Math.min(width/image.naturalWidth,height/image.naturalHeight);
          scaleX=fit==='fill' ? 1 : width/(image.naturalWidth*factor);
          scaleY=fit==='fill' ? 1 : height/(image.naturalHeight*factor);
          const parts=style.objectPosition.split(/\s+/);
          offsetX=(1-scaleX)*positionFraction(parts[0],'x');
          offsetY=(1-scaleY)*(1-positionFraction(parts[1] || '50%','y'));
        },
        draw(phase, pointerX, pointerY, strength=1) {
          if (gl.isContextLost()) return false;
          gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D,texture);
          gl.uniform2f(uniforms.scale,scaleX,scaleY); gl.uniform2f(uniforms.offset,offsetX,offsetY);
          // Subpixel sampling only, with original alpha fixed: no new light, colour grading or silhouette.
          gl.uniform2f(uniforms.shift,(Math.sin(phase*.7)*.15+pointerX*.09)/image.naturalWidth,(Math.cos(phase*.6)*.1+pointerY*.06)/image.naturalHeight);
          gl.uniform1f(uniforms.strength,strength);
          gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES,0,6);
          return true;
        },
        valid() { return !gl.isContextLost() && gl.getError()===gl.NO_ERROR; },
        dispose() { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); }
      };
    } catch {
      if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment);
      if (texture) gl.deleteTexture(texture); if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program);
      return null;
    }
  }

  document.querySelectorAll('[data-glass-scene]').forEach(scene => {
    const image=scene.querySelector('.usung-glass-source'), canvas=scene.querySelector('canvas'), owner=scene.closest('section');
    if (!image || !canvas || !owner) return;
    let renderer=null, frameId=0, running=false, phase=0, previousTime=0, needsResize=true, initializing=false, disposed=false, pageSuspended=false;
    let targetX=0,targetY=0,pointerX=0,pointerY=0;
    scene.dataset.renderReady='false'; scene.dataset.pointerActive='false'; scene.dataset.glassRunning='false'; scene.dataset.glassRenderer='image';
    const allowed = () => !disposed && !pageSuspended && scene.isConnected && owner.dataset.heroRunning==='true' && !reduced.matches && !document.hidden;
    const dropRenderer = () => {
      renderer?.dispose(); renderer=null;
      scene.dataset.renderReady='false'; scene.dataset.glassRenderer='image';
    };
    const reset = () => {
      targetX=targetY=pointerX=pointerY=0;
      scene.dataset.pointerActive='false';
      for (const [name,value] of [['rx','0deg'],['ry','0deg'],['x','0px'],['y','0px']]) scene.style.setProperty('--glass-'+name,value);
    };
    function frame(time) {
      frameId=0;
      if (!allowed()) { update(); return; }
      const elapsed=previousTime ? Math.min(50,time-previousTime)/1000 : 0;
      previousTime=time; phase+=elapsed;
      const easing=1-Math.exp(-elapsed*9);
      pointerX+=(targetX-pointerX)*easing; pointerY+=(targetY-pointerY)*easing;
      scene.style.setProperty('--glass-rx',clamp(-pointerY*2.8+Math.sin(phase*.47)*.35,-4,4).toFixed(3)+'deg');
      scene.style.setProperty('--glass-ry',clamp(pointerX*2.8+Math.sin(phase*.38)*.7,-4,4).toFixed(3)+'deg');
      scene.style.setProperty('--glass-x',(pointerX*5+Math.sin(phase*.31)*2).toFixed(3)+'px');
      scene.style.setProperty('--glass-y',(pointerY*4+Math.sin(phase*.5)*6).toFixed(3)+'px');
      if (renderer) {
        try {
          if (needsResize) { renderer.resize(); needsResize=false; }
          if (renderer.draw(phase,pointerX,pointerY)) scene.dataset.renderReady='true';
          else dropRenderer();
        } catch { dropRenderer(); }
      }
      frameId=requestAnimationFrame(frame);
    }
    function update() {
      const next=allowed();
      if (next===running && (!next || frameId)) return;
      running=next; scene.dataset.glassRunning=String(next);
      if (next) { previousTime=0; if (!frameId) frameId=requestAnimationFrame(frame); }
      else { if (frameId) cancelAnimationFrame(frameId); frameId=0; previousTime=0; reset(); }
    }
    async function initialize() {
      if (initializing || disposed || renderer || !image.complete || !image.naturalWidth) return;
      initializing=true;
      try {
        if (image.decode) await image.decode();
        if (disposed) return;
        renderer=makeRenderer(canvas,image);
        if (renderer) {
          renderer.resize();
          if (!renderer.draw(0,0,0,0) || !renderer.valid()) { renderer.dispose(); renderer=null; }
          else { needsResize=false; scene.dataset.renderReady='true'; scene.dataset.glassRenderer='webgl'; }
        }
      } catch { dropRenderer(); }
      finally { initializing=false; update(); }
    }
    const pointer = event => {
      if (!allowed() || !['mouse','pen'].includes(event.pointerType)) return;
      const bounds=owner.getBoundingClientRect();
      targetX=clamp((event.clientX-bounds.left)/Math.max(1,bounds.width)*2-1,-1,1);
      targetY=clamp((event.clientY-bounds.top)/Math.max(1,bounds.height)*2-1,-1,1);
      scene.dataset.pointerActive='true';
    };
    const leave = () => { targetX=targetY=0; scene.dataset.pointerActive='false'; };
    owner.addEventListener('pointermove',pointer,{passive:true}); owner.addEventListener('pointerleave',leave,{passive:true});
    const mutation=new MutationObserver(update); mutation.observe(owner,{attributes:true,attributeFilter:['data-hero-running']});
    const resize=new ResizeObserver(() => { needsResize=true; }); resize.observe(scene);
    document.addEventListener('visibilitychange',update); document.addEventListener('usung:motion-state',update); reduced.addEventListener('change',update);
    image.addEventListener('load',initialize,{once:true});
    canvas.addEventListener('webglcontextlost',event => { event.preventDefault(); renderer=null; scene.dataset.renderReady='false'; scene.dataset.glassRenderer='image'; });
    canvas.addEventListener('webglcontextrestored',() => { renderer=null; initialize(); });
    const pagehide = event => {
      pageSuspended=true; update();
      if (event.persisted) return;
      disposed=true; mutation.disconnect(); resize.disconnect();
      document.removeEventListener('visibilitychange',update); document.removeEventListener('usung:motion-state',update); reduced.removeEventListener('change',update);
      owner.removeEventListener('pointermove',pointer); owner.removeEventListener('pointerleave',leave);
      removeEventListener('pagehide',pagehide); removeEventListener('pageshow',pageshow);
      renderer?.dispose(); renderer=null;
    };
    const pageshow = () => { if (!disposed) { pageSuspended=false; needsResize=true; update(); } };
    addEventListener('pagehide',pagehide); addEventListener('pageshow',pageshow);
    initialize(); update();
  });
})();
