(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const vertexSource = `
    attribute vec2 a_position;
    varying highp vec2 v_uv;
    void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;
  const fragmentSource = `
    precision highp float;
    varying highp vec2 v_uv;
    uniform sampler2D u_texture;
    uniform vec2 u_scale;
    uniform vec2 u_texel;
    uniform vec2 u_offset;
    uniform vec2 u_pointer;
    uniform vec2 u_velocity;
    uniform float u_time;
    uniform float u_hover;
    uniform float u_motion;
    void main(){
      vec2 uv=v_uv*u_scale+u_offset;
      // A broad, slow flow bends the existing ribbons, including their contours.
      vec2 flow=vec2(
        sin(uv.y*5.2-u_time*.42)*cos(uv.x*3.1+u_time*.31),
        cos(uv.x*4.6+u_time*.35)*sin(uv.y*3.8-u_time*.29)
      )*vec2(.011,.010);
      vec2 aspect=vec2(1.5,1.);
      vec2 delta=(uv-u_pointer)*aspect;
      float influence=exp(-dot(delta,delta)/.046);
      // Local compression plus a small inertial drag; neither moves the whole image.
      vec2 pressure=delta/aspect*.48*influence;
      vec2 drag=u_velocity*.035*influence;
      vec2 sampleUV=uv+u_motion*(flow+u_hover*(pressure-drag));
      // RGB and alpha travel together. The texture and canvas are both premultiplied.
      // Sample before applying coverage so mipmap derivatives remain defined at the boundary.
      vec4 sampleColor=texture2D(u_texture,sampleUV);
      vec2 edge=smoothstep(vec2(0.),u_texel*4.,sampleUV)*smoothstep(vec2(0.),u_texel*4.,vec2(1.)-sampleUV);
      gl_FragColor=sampleColor*edge.x*edge.y;
    }`;

  function makeRenderer(canvas, image) {
    const contextOptions={alpha:true,premultipliedAlpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'low-power'};
    const gl=canvas.getContext('webgl2',contextOptions) || canvas.getContext('webgl',contextOptions);
    const modern=typeof WebGL2RenderingContext!=='undefined' && gl instanceof WebGL2RenderingContext;
    if (!gl || image.naturalWidth > gl.getParameter(gl.MAX_TEXTURE_SIZE) || image.naturalHeight > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return null;
    const highPrecision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
    if (!highPrecision || !highPrecision.precision) return null;
    const shader = (type, source) => {
      const result = gl.createShader(type);
      if (!result) throw new Error('shader');
      gl.shaderSource(result, source); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) { gl.deleteShader(result); throw new Error('shader'); }
      return result;
    };
    let program, texture, buffer, vertex, fragment;
    try {
      const vertexText=modern ? '#version 300 es\n'+vertexSource.replace('attribute vec2','in vec2').replace('varying highp','out highp') : vertexSource;
      const fragmentText=modern ? '#version 300 es\n'+fragmentSource.replace('varying highp','in highp').replace('uniform sampler2D','out vec4 outColor;\n    uniform sampler2D').replaceAll('gl_FragColor','outColor').replaceAll('texture2D','texture') : fragmentSource;
      vertex=shader(gl.VERTEX_SHADER,vertexText); fragment=shader(gl.FRAGMENT_SHADER,fragmentText);
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
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      if (modern) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR); }
      canvas.dataset.textureFilter=modern ? 'trilinear' : 'linear';
      gl.disable(gl.BLEND); gl.clearColor(0,0,0,0);
      const uniforms = Object.fromEntries(['texture','scale','texel','offset','pointer','velocity','time','hover','motion'].map(name => [name,gl.getUniformLocation(program,'u_'+name)]));
      gl.uniform1i(uniforms.texture,0);
      gl.uniform2f(uniforms.texel,1/image.naturalWidth,1/image.naturalHeight);
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
          const ratio=Math.min(devicePixelRatio || 1,2,Math.sqrt(4000000/(width*height)),4096/Math.max(width,height));
          const targetWidth=Math.max(1,Math.round(width*ratio)), targetHeight=Math.max(1,Math.round(height*ratio));
          if (canvas.width!==targetWidth || canvas.height!==targetHeight) { canvas.width=targetWidth; canvas.height=targetHeight; }
          gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight);
          canvas.dataset.resolution=canvas.width+'×'+canvas.height;
          const style=getComputedStyle(image), fit=style.objectFit;
          const factor=(fit==='cover' ? Math.max(width/image.naturalWidth,height/image.naturalHeight) : Math.min(width/image.naturalWidth,height/image.naturalHeight))*.97;
          scaleX=fit==='fill' ? 1 : width/(image.naturalWidth*factor);
          scaleY=fit==='fill' ? 1 : height/(image.naturalHeight*factor);
          const parts=style.objectPosition.split(/\s+/);
          offsetX=(1-scaleX)*positionFraction(parts[0],'x');
          offsetY=(1-scaleY)*(1-positionFraction(parts[1] || '50%','y'));
        },
        imagePoint(x,y) { return [x*scaleX+offsetX,(1-y)*scaleY+offsetY]; },
        draw(phase, pointerX, pointerY, velocityX=0, velocityY=0, hover=0, motion=1) {
          if (gl.isContextLost()) return false;
          gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D,texture);
          gl.uniform2f(uniforms.scale,scaleX,scaleY); gl.uniform2f(uniforms.offset,offsetX,offsetY);
          gl.uniform2f(uniforms.pointer,pointerX,pointerY);
          gl.uniform2f(uniforms.velocity,velocityX,velocityY);
          gl.uniform1f(uniforms.time,phase);
          gl.uniform1f(uniforms.hover,hover);
          gl.uniform1f(uniforms.motion,motion);
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
    let targetX=.5,targetY=.5,pointerX=.5,pointerY=.5,targetHover=0,hover=0,velocityX=0,velocityY=0;
    scene.dataset.renderReady='false'; scene.dataset.pointerActive='false'; scene.dataset.glassRunning='false'; scene.dataset.glassRenderer='image';
    scene.dataset.glassInteraction='local-displacement';
    const allowed = () => !disposed && Boolean(renderer) && !pageSuspended && scene.isConnected && owner.dataset.heroRunning==='true' && !reduced.matches && !document.hidden;
    const dropRenderer = () => {
      renderer?.dispose(); renderer=null;
      scene.dataset.renderReady='false'; scene.dataset.glassRenderer='image';
    };
    const reset = () => {
      targetHover=hover=velocityX=velocityY=0;
      targetX=pointerX=.5; targetY=pointerY=.5;
      scene.dataset.pointerActive='false';
    };
    function frame(time) {
      frameId=0;
      if (!allowed()) { update(); return; }
      const elapsed=previousTime ? Math.min(50,time-previousTime)/1000 : 0;
      previousTime=time; phase+=elapsed;
      const easing=1-Math.exp(-elapsed*9);
      const dx=(targetX-pointerX)*easing,dy=(targetY-pointerY)*easing;
      pointerX+=dx; pointerY+=dy;
      const settle=1-Math.exp(-elapsed*5);
      velocityX+=(clamp(elapsed ? dx/elapsed : 0,-.55,.55)-velocityX)*settle;
      velocityY+=(clamp(elapsed ? dy/elapsed : 0,-.55,.55)-velocityY)*settle;
      hover+=(targetHover-hover)*(1-Math.exp(-elapsed*(targetHover ? 8 : 3.5)));
      if (renderer) {
        try {
          if (needsResize) { renderer.resize(); needsResize=false; }
          if (renderer.draw(phase,pointerX,pointerY,velocityX,velocityY,hover,1-Math.exp(-phase*.9))) scene.dataset.renderReady='true';
          else dropRenderer();
        } catch { dropRenderer(); }
      }
      if (allowed()) frameId=requestAnimationFrame(frame);
      else update();
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
          if (!renderer.draw(0,.5,.5,0,0,0,0) || !renderer.valid()) { renderer.dispose(); renderer=null; }
          else { needsResize=false; scene.dataset.renderReady='true'; scene.dataset.glassRenderer='webgl'; }
        }
      } catch { dropRenderer(); }
      finally { initializing=false; update(); }
    }
    const pointer = event => {
      if (!allowed() || !renderer || !['mouse','pen'].includes(event.pointerType)) return;
      const bounds=scene.getBoundingClientRect();
      const point=renderer.imagePoint((event.clientX-bounds.left)/Math.max(1,bounds.width),(event.clientY-bounds.top)/Math.max(1,bounds.height));
      if (point[0]<0 || point[0]>1 || point[1]<0 || point[1]>1) { leave(); return; }
      if (!targetHover && hover<.01) { pointerX=point[0]; pointerY=point[1]; }
      targetX=point[0]; targetY=point[1]; targetHover=1;
      scene.dataset.pointerActive='true';
    };
    const leave = () => { targetHover=0; scene.dataset.pointerActive='false'; };
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
