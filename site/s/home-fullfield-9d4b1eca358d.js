(() => {
  'use strict';
  const sources = window.FULLFIELD_SOURCES;
  if (!sources) return;
  const french = document.querySelector('main section[data-section-id]')?.dataset.sectionId === '692f889802e91f2fe3e501e4';
  const targets = french ? [
    { role:'axiom', section:'692f889802e91f2fe3e501e7', blocks:['d1fa5ebd6108df6df692'] },
    { role:'archive', section:'692f889802e91f2fe3e501ea', blocks:['b90b18c3682ad168394f'] },
    { role:'entity', section:'698cfbd93ed2b60dc83ee387', blocks:['a23eb3c63eb9f6acc435'] },
    { role:'marble', section:'692f889802e91f2fe3e501ed', blocks:['c570bcbcd2b40667b81b'], merged:'692f889802e91f2fe3e501f0', images:['large','woman','small'] }
  ] : [
    { role:'axiom', section:'681a24c62708ef0c7448932b', blocks:['739933596dc77b9e4da1'] },
    { role:'archive', section:'68490d31ea3ee95b88085e18', blocks:['yui_3_17_2_1_1751287902033_2087'] },
    { role:'entity', section:'698ccb7b40bdb1271700798c', blocks:['5cb7f4cb84c347ff968d'] },
    { role:'marble', section:'68490d6396424d5b2e86a101', blocks:['yui_3_17_2_1_1749617849229_10373'], merged:'681a1e785491a2330ed19188', images:['large','woman','small'] }
  ];
  const info = window.__fullfieldPreview = {version:'home-fullfield-marble-v1',status:'loading',roles:[],errors:[]};
  info.portraitProtection={retainedDisplacement:.5,center:[.474,.345],radius:[.250,.200],feather:.12,scope:'woman face only; exact base preserved outside mask',method:'coordinate recovery + masked corrective pass'};
  const states = [];
  const vertex = 'attribute vec2 pos;varying vec2 uv;uniform float scrollZoom;void main(){uv=vec2((pos.x+1.)*.5,(1.-pos.y)*.5);if(scrollZoom>1.000001)uv=.5+(uv-.5)/scrollZoom;gl_Position=vec4(pos,0.,1.);}';
  const fragment = `precision highp float; varying vec2 uv;
  uniform sampler2D painting0,painting1,painting2;
  uniform vec2 crop0,crop1,crop2,center0,center1,center2,focus0,focus1,focus2;
  uniform float phase0,phase1,phase2,time,marble;
  float brush(float x){x=clamp(x,0.,1.);return x*x*x*(x*(x*6.-15.)+10.);}
  vec3 plane(sampler2D tex,vec2 p,vec2 crop,vec2 focus,float phase,float depth){
    vec2 v=p-.5;
    vec2 flow=vec2(sin(v.y*10.+phase)+.43*sin(v.x*7.-v.y*5.+2.*phase),cos(v.x*9.-phase)+.37*sin(v.y*8.+v.x*4.-2.*phase));
    vec2 warped=clamp(focus+(p+.019*flow-.5)*crop,.001,.999);
    return texture2D(tex,warped).rgb*pow(.973,depth);
  }
  vec3 recurse(sampler2D tex,vec2 p,vec2 crop,vec2 focus,vec2 center,float phase){
    float scale=.88+.008*sin(phase),depth=0.,remaining=1.;vec3 color=vec3(0.);
    for(int i=0;i<24;i++){
      vec2 q=(p-(1.-scale)*center)/scale;
      if(q.x<=0.||q.x>=1.||q.y<=0.||q.y>=1.)break;
      float edge=min(min(q.x,1.-q.x),min(q.y,1.-q.y));float a=brush(edge/.105);
      color+=remaining*(1.-a)*plane(tex,p,crop,focus,phase,depth);remaining*=a;p=q;depth+=1.;
      if(remaining<.00001)break;
    }
    return color+remaining*plane(tex,p,crop,focus,phase,depth);
  }
  void main(){
    vec3 a=recurse(painting0,uv,crop0,focus0,center0,phase0);
    if(marble<.5){gl_FragColor=vec4(a,1.);return;}
    vec3 b=mix(plane(painting1,uv,crop1,focus1,phase1,0.),recurse(painting1,uv,crop1,focus1,center1,phase1),.22);
    vec3 c=recurse(painting2,uv,crop2,focus2,center2,phase2);
    // Flowing nonradial ribbons: no straight seam, circular frame, or spiral hub.
    vec2 q=uv+vec2(.10*sin(uv.y*5.4+time*.10)+.045*sin(uv.y*13.-time*.065),.065*sin(uv.x*6.5-time*.08));
    float ribbon=q.x+.15*sin(q.y*4.8+.7*sin(q.x*5.+time*.05))+ .04*sin(q.y*15.+time*.08);
    float woman=brush((ribbon-.20)/.22)*(1.-brush((ribbon-.78)/.22));
    float side=brush((ribbon-.34)/.40);
    vec3 weights=vec3((1.-woman)*(1.-side),woman,(1.-woman)*side)+.025;
    weights/=weights.x+weights.y+weights.z;
    gl_FragColor=vec4(a*weights.x+b*weights.y+c*weights.z,1.);
  }`;
  // Exact accepted base first, then a face-only corrective pass. Fragment discard
  // prevents even a one-channel rounding change anywhere outside the soft mask.
  const portraitFragment = fragment.replace('  void main(){',
"  float portraitMask(vec2 sourceUV){\n    float d=length((sourceUV-vec2(.474,.345))/vec2(.250,.200));\n    return 1.-brush((d-1.)/.12);\n  }\n  vec3 portraitPlane(sampler2D tex,vec2 p,vec2 crop,vec2 focus,float phase,float depth,float recovery){\n    vec2 v=p-.5;\n    vec2 flow=vec2(sin(v.y*10.+phase)+.43*sin(v.x*7.-v.y*5.+2.*phase),cos(v.x*9.-phase)+.37*sin(v.y*8.+v.x*4.-2.*phase));\n    vec2 warped=clamp(focus+(p+.019*flow-.5)*crop,.001,.999);\n    if(recovery>0.){\n      vec2 nativeFace=clamp(focus+(uv-.5)*crop,.001,.999);\n      warped=mix(warped,nativeFace,recovery);\n    }\n    return texture2D(tex,warped).rgb*pow(.973,depth);\n  }\n  vec3 portraitRecurse(sampler2D tex,vec2 p,vec2 crop,vec2 focus,vec2 center,float phase,float recovery){\n    float scale=.88+.008*sin(phase),depth=0.,remaining=1.;vec3 color=vec3(0.);\n    for(int i=0;i<24;i++){\n      vec2 q=(p-(1.-scale)*center)/scale;\n      if(q.x<=0.||q.x>=1.||q.y<=0.||q.y>=1.)break;\n      float edge=min(min(q.x,1.-q.x),min(q.y,1.-q.y));float a=brush(edge/.105);\n      color+=remaining*(1.-a)*portraitPlane(tex,p,crop,focus,phase,depth,recovery);remaining*=a;p=q;depth+=1.;\n      if(remaining<.00001)break;\n    }\n    return color+remaining*portraitPlane(tex,p,crop,focus,phase,depth,recovery);\n  }\n  void main(){\n    float faceRecovery=.5*portraitMask(focus1+(uv-.5)*crop1);\n    if(faceRecovery<=0.)discard;")
    .replace("    vec3 b=mix(plane(painting1,uv,crop1,focus1,phase1,0.),recurse(painting1,uv,crop1,focus1,center1,phase1),.22);","    vec3 b=mix(portraitPlane(painting1,uv,crop1,focus1,phase1,0.,faceRecovery),portraitRecurse(painting1,uv,crop1,focus1,center1,phase1,faceRecovery),.22);");
  // Only the entrance/exit straight cuts of the moving artwork sequence.
  // Existing SVG curves and every native section/content box remain untouched.
  const joins=[];
  info.joins=[];
  function splitGradient(value){let out=[],start=0,depth=0;for(let i=0;i<value.length;i++){if(value[i]==='(')depth++;else if(value[i]===')')depth--;else if(value[i]===','&&depth===0){out.push(value.slice(start,i).trim());start=i+1;}}out.push(value.slice(start).trim());return out;}
  function canvasGradient(ctx,value,w,h,offsetY){
    if(!value||value==='none')return null;
    const match=/^linear-gradient\(([\s\S]*)\)$/.exec(value);if(!match)return null;
    // CSSOM may omit the default 180deg direction. Never consume a color as an angle.
    const parts=splitGradient(match[1]),direction=/^(-?[\d.]+)deg$/.exec(parts[0]);
    const angle=direction?Number(parts.shift().slice(0,-3)):180;if(angle!==90&&angle!==180)return null;
    const stops=parts.map(p=>{const m=/^(rgba?\([^)]*\)|#[0-9a-f]+|transparent|black|white)(?:\s+([\d.]+)%)?$/.exec(p);if(!m)throw Error('Unsupported owned gradient stop');return{color:m[1],at:m[2]===undefined?null:Number(m[2])/100};});
    if(stops[0].at===null)stops[0].at=0;if(stops.at(-1).at===null)stops.at(-1).at=1;
    for(let i=1;i<stops.length-1;i++)if(stops[i].at===null){let end=i+1;while(stops[end].at===null)end++;for(let k=i;k<end;k++)stops[k].at=stops[i-1].at+(stops[end].at-stops[i-1].at)*(k-i+1)/(end-i+1);i=end-1;}
    const g=angle===90?ctx.createLinearGradient(0,0,w,0):ctx.createLinearGradient(0,-offsetY,0,h-offsetY);for(const stop of stops)g.addColorStop(stop.at,stop.color);return g;
  }
  function makeJoin(id,upper,lower,sourceState,edge){
    const source=sourceState?.section||document.querySelector('[data-fullfield-preview="'+(id==='entry'?'axiom':'marble')+'"]');
    const sourceLayer=source?.querySelector('.fullfield-layer'),host=(id==='entry'?upper:lower)?.querySelector(':scope>.section-border');
    if(!sourceLayer||!host)throw Error('Straight join target absent '+id);
    const layer=document.createElement('div');layer.className='fullfield-straight-join';layer.dataset.straightJoin=id;layer.setAttribute('aria-hidden','true');
    const canvas=document.createElement('canvas');canvas.className='fullfield-straight-join-canvas';layer.append(canvas);host.append(layer);
    const strip=document.createElement('canvas'),part=document.createElement('canvas'),ctx=canvas.getContext('2d'),sc=strip.getContext('2d'),pc=part.getContext('2d');
    const record={id,sourceRole:id==='entry'?'axiom':'marble',upper:upper.dataset.sectionId,lower:lower.dataset.sectionId,frames:0,height:0,source:'live artwork pixels + matching native veil',visible:false};info.joins.push(record);
    const join={layer,sourceState,visible:false,paint:null,place:null};let width=0,height=0,fieldHeight=0,fieldWidth=0,scale=1;
    join.place=()=>{const hr=host.getBoundingClientRect(),ur=upper.getBoundingClientRect(),sr=sourceLayer.getBoundingClientRect();width=hr.width;fieldWidth=sr.width;fieldHeight=sr.height;height=Math.min(160,Math.max(72,innerHeight*.14));
      // Keep the outgoing blend below the next section's heading, not on top of its copy.
      if(id==='exit'){const first=[...lower.querySelectorAll('.sqs-html-content h1,.sqs-html-content h2,.sqs-html-content h3')].find(e=>e.getBoundingClientRect().height>0);if(first){const gap=first.getBoundingClientRect().top-ur.bottom;if(gap>72)height=Math.min(height,gap*.92);}}
      layer.style.top=(ur.bottom-hr.top-(id==='entry'?height:0))+'px';layer.style.height=(height+1)+'px';
      scale=Math.min(1.35,devicePixelRatio||1);canvas.width=strip.width=part.width=Math.max(2,Math.round(width*scale));canvas.height=strip.height=part.height=Math.max(2,Math.round(height*scale));
      record.height=height;record.width=width;record.fieldHeight=fieldHeight;join.paint();};
    join.paint=()=>{if(!width||!height||!fieldHeight)return;const W=canvas.width,H=canvas.height,fullH=fieldHeight*scale,offset=edge==='top'?0:Math.max(0,fullH-H),live=sourceLayer.querySelector('.fullfield-canvas.is-ready');sc.setTransform(1,0,0,1,0,0);sc.clearRect(0,0,W,H);sc.globalCompositeOperation='source-over';
      if(live){sc.drawImage(live,0,offset/fullH*live.height,live.width,H/fullH*live.height,0,0,W,H);}else{
        for(const img of sourceLayer.querySelectorAll('.fullfield-source')){if(!img.complete||!img.naturalWidth)continue;pc.setTransform(1,0,0,1,0,0);pc.clearRect(0,0,W,H);pc.globalCompositeOperation='source-over';const k=Math.max(W/img.naturalWidth,fullH/img.naturalHeight),dw=img.naturalWidth*k,dh=img.naturalHeight*k;pc.drawImage(img,(W-dw)/2,(fullH-dh)/2-offset,dw,dh);const st=getComputedStyle(img),mask=canvasGradient(pc,st.maskImage||st.webkitMaskImage,W,fullH,offset);if(mask){pc.globalCompositeOperation='destination-in';pc.fillStyle=mask;pc.fillRect(0,0,W,H);pc.globalCompositeOperation='source-over';}sc.drawImage(part,0,0);}
      }
      const style=getComputedStyle(sourceLayer,'::after');if(style.display!=='none'){const veil=canvasGradient(sc,style.backgroundImage,W,fullH,offset);record.nativeVeil=style.backgroundImage;record.nativeVeilCopied=Boolean(veil);if(veil){sc.fillStyle=veil;sc.fillRect(0,0,W,H);}}
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,W,H);ctx.translate(0,H);ctx.scale(1,-1);ctx.drawImage(strip,0,0);ctx.setTransform(1,0,0,1,0,0);record.frames++;
    };
    layer.dataset.direction=id==='entry'?'into-next':'from-previous';joins.push(join);join.place();new ResizeObserver(join.place).observe(sourceLayer);new ResizeObserver(join.place).observe(host);
    const observer=new IntersectionObserver(entries=>{join.visible=entries[0].isIntersecting;record.visible=join.visible;},{rootMargin:'40px'});observer.observe(layer);
  }
  function setupStraightJoins(){if(info.joins.length)return;try{
    const hero=document.querySelector('main section[data-section-id]'),axiom=states.find(s=>s.record.role==='axiom'),marble=states.find(s=>s.record.role==='marble'),marbleSection=marble?.section||document.querySelector('[data-fullfield-preview="marble"]');
    let next=marbleSection?.nextElementSibling;while(next&&(!next.matches('section[data-section-id]')||getComputedStyle(next).display==='none'))next=next.nextElementSibling;
    makeJoin('entry',hero,axiom?.section||document.querySelector('[data-fullfield-preview="axiom"]'),axiom,'top');makeJoin('exit',marbleSection,next,marble,'bottom');
  }catch(error){info.errors.push(String(error));}}

  // Scroll camera only. Existing texture, source video and authored layout stay intact.
  const zoomSettings={maxScale:1.06,travelViewports:1.8,dampingMs:720,maxDeltaMs:64,epsilon:.000008};
  const zoomReduced=matchMedia('(prefers-reduced-motion:reduce)'),zoomStates=[];
  const zoomInfo=info.scrollZoom={version:'slow-scroll-camera-v1',settings:zoomSettings,records:[],frameSource:'display requestAnimationFrame timestamps'};
  let zoomDirty=true,zoomLast=performance.now();
  const smoothUnit=x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(x*(x*6-15)+10);};
  function zoomTarget(section){if(zoomReduced.matches)return 1;const r=section.getBoundingClientRect(),p=(innerHeight-r.top)/(Math.max(1,innerHeight)*zoomSettings.travelViewports);return 1+(zoomSettings.maxScale-1)*(1-smoothUnit(p));}
  function registerZoom(section,record,element){const value=zoomTarget(section),z={section,record,element,value,target:value,active:false,changed:false,priorWillChange:element?.style.willChange||''};record.cameraScale=value;record.cameraTarget=value;record.zoomUpdates=0;zoomStates.push(z);zoomInfo.records.push(record);if(element){const host=element.closest('[data-effacer-hero]'),fx=Number(host?.dataset.heroFocalX),fy=Number(host?.dataset.heroFocalY),ox=fx>0&&fx<1?fx:.5,oy=fy>0&&fy<1?fy:.5;record.cameraOrigin=[ox,oy];element.style.transformOrigin=(ox*100)+'% '+(oy*100)+'%';element.style.transform=zoomReduced.matches?'none':'scale('+value.toFixed(7)+')';}return z;}
  function updateScrollZoom(now){const dt=Math.min(zoomSettings.maxDeltaMs,Math.max(0,now-zoomLast));zoomLast=now;for(const z of zoomStates)z.changed=false;if(document.hidden){zoomDirty=true;return false;}
    if(zoomDirty){for(const z of zoomStates){const r=z.section.getBoundingClientRect();z.active=r.bottom> -120&&r.top<innerHeight+120;z.target=zoomTarget(z.section);z.record.cameraTarget=z.target;z.record.cameraVisible=z.active;}zoomDirty=false;}
    let changed=false;for(const z of zoomStates){if(!z.active&&!zoomReduced.matches)continue;const next=zoomReduced.matches?1:z.value+(z.target-z.value)*(1-Math.exp(-dt/zoomSettings.dampingMs));const value=Math.abs(next-z.target)<zoomSettings.epsilon?z.target:Math.max(1,Math.min(zoomSettings.maxScale,next));if(value!==z.value){z.value=value;z.changed=true;changed=true;z.record.cameraScale=value;z.record.zoomUpdates++;if(z.element)z.element.style.transform=zoomReduced.matches?'none':'scale('+value.toFixed(7)+')';}if(z.element)z.element.style.willChange=z.active&&Math.abs(z.value-z.target)>zoomSettings.epsilon?'transform':z.priorWillChange;}return changed;
  }
  const dirtyZoom=()=>{zoomDirty=true;};
  addEventListener('scroll',dirtyZoom,{passive:true});addEventListener('resize',dirtyZoom,{passive:true});document.addEventListener('visibilitychange',()=>{zoomLast=performance.now();zoomDirty=true;});zoomReduced.addEventListener?.('change',dirtyZoom);

  function make(config) {
    const section=document.querySelector('[data-section-id="'+config.section+'"]');
    if(!section)throw Error('Missing section '+config.role);
    const layer=document.createElement('div');layer.className='fullfield-layer';layer.setAttribute('aria-hidden','true');
    const roles=config.images||[config.role];
    // Native source photos remain beneath each enhanced field as a no-WebGL floor.
    for(const role of roles){const img=document.createElement('img');img.className='fullfield-source';img.dataset.role=role;img.alt='';img.decoding='async';img.src=sources[role].url;layer.append(img);}
    section.querySelector('.section-background').append(layer);section.dataset.fullfieldPreview=config.role;
    for(const id of config.blocks){const block=document.getElementById('block-'+id);if(!block)throw Error('Missing block '+id);block.closest('.fe-block').style.visibility='hidden';}
    if(config.merged){const other=document.querySelector('[data-section-id="'+config.merged+'"]');if(!other)throw Error('Missing merged artwork band');other.dataset.fullfieldMergedInto=config.section;other.hidden=true;other.style.setProperty('display','none','important');}
    const canvas=document.createElement('canvas');canvas.className='fullfield-canvas';canvas.dataset.role=config.role;layer.append(canvas);
    const record={role:config.role,images:roles,centers:roles.map(r=>sources[r].center),rates:roles.map(r=>sources[r].rate),frames:0,ready:false,fallback:false};info.roles.push(record);
    const gl=canvas.getContext('webgl',{alpha:false,antialias:false,preserveDrawingBuffer:true});
    if(!gl){record.fallback=true;record.ready=true;canvas.remove();return;}
    function compile(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
    const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(program,'pos');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    const renderPrograms=[program];
    if(config.role==='marble'&&roles[1]==='woman'){
      const faceProgram=gl.createProgram();
      gl.attachShader(faceProgram,compile(gl.VERTEX_SHADER,vertex));
      gl.attachShader(faceProgram,compile(gl.FRAGMENT_SHADER,portraitFragment));
      gl.bindAttribLocation(faceProgram,pos,'pos');gl.linkProgram(faceProgram);
      if(!gl.getProgramParameter(faceProgram,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(faceProgram));
      renderPrograms.push(faceProgram);record.portraitProtection=.5;
    }
    function eachProgram(set){for(const p of renderPrograms){gl.useProgram(p);set(p);}gl.useProgram(program);}
    const state={section,canvas,record,loaded:false,visible:false,draw:null,sceneTime:0,lastSceneTime:null,zoom:null};state.zoom=registerZoom(section,record,null);states.push(state);
    const actual=[roles[0],roles[1]||roles[0],roles[2]||roles[0]];
    Promise.all(roles.map(role=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('Source image '+role));img.src=sources[role].url;}))).then(images=>{
      images.forEach((image,i)=>{gl.activeTexture(gl.TEXTURE0+i);const tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,image);eachProgram(p=>{gl.uniform1i(gl.getUniformLocation(p,'painting'+i),i);gl.uniform2f(gl.getUniformLocation(p,'center'+i),...sources[actual[i]].center);gl.uniform2f(gl.getUniformLocation(p,'focus'+i),actual[i]==='woman'?.36:.5,actual[i]==='woman'?.34:.5);});});
      if(roles.length===1){gl.uniform1i(gl.getUniformLocation(program,'painting1'),0);gl.uniform1i(gl.getUniformLocation(program,'painting2'),0);}
      eachProgram(p=>gl.uniform1f(gl.getUniformLocation(p,'marble'),config.role==='marble'?1:0));
      function resize(){const r=layer.getBoundingClientRect(),budget=config.role==='marble'?1100000:1600000,factor=Math.min(1.35,Math.sqrt(budget/Math.max(1,r.width*r.height)));canvas.width=Math.max(2,Math.round(r.width*factor));canvas.height=Math.max(2,Math.round(r.height*factor));gl.viewport(0,0,canvas.width,canvas.height);record.width=canvas.width;record.height=canvas.height;images.forEach((img,i)=>{const ar=canvas.width/canvas.height,sr=img.width/img.height;
        if(config.role==='marble'&&actual[i]==='woman'&&innerWidth<=767){
          // Source landmarks: hairline~.15, chin~.52, gaze~.315 in the original photo.
          // Compose the portrait for the visible phone screen, not the tall text band.
          const cropY=Math.max(.56,Math.min(.86,.37*r.height/(Math.max(1,innerHeight)*.63))),cropX=cropY*ar/sr;
          const localTop=r.top-section.getBoundingClientRect().top;
          const focusX=.40,focusY=.315+cropY*(.5-Math.min(.5,(innerHeight*.44-localTop)/r.height));
          eachProgram(p=>{gl.uniform2f(gl.getUniformLocation(p,'crop'+i),cropX,cropY);gl.uniform2f(gl.getUniformLocation(p,'focus'+i),focusX,focusY);});
          record.mobilePortrait={version:'desktop-expression-phone-frame-v1',crop:[cropX,cropY],focus:[focusX,focusY],gazeHeightRatio:.44,targetFaceHeightRatio:.63};
          const fallback=layer.querySelector('.fullfield-source[data-role=woman]');
          if(fallback){const iw=r.width/cropX,ih=r.height/cropY;Object.assign(fallback.style,{width:iw+'px',height:ih+'px',left:(r.width*.5-focusX*iw)+'px',top:(r.height*.5-focusY*ih)+'px',right:'auto',bottom:'auto'});}
        }else{
          eachProgram(p=>{gl.uniform2f(gl.getUniformLocation(p,'crop'+i),.94*Math.min(1,ar/sr),.94*Math.min(1,sr/ar));gl.uniform2f(gl.getUniformLocation(p,'focus'+i),actual[i]==='woman'?.36:.5,actual[i]==='woman'?.34:.5);});
          if(config.role==='marble'&&actual[i]==='woman'){delete record.mobilePortrait;const fallback=layer.querySelector('.fullfield-source[data-role=woman]');if(fallback)for(const key of['width','height','left','top','right','bottom'])fallback.style.removeProperty(key);}
        }
      });}
      state.draw=t=>{for(const p of renderPrograms){gl.useProgram(p);actual.forEach((role,i)=>gl.uniform1f(gl.getUniformLocation(p,'phase'+i),t/18*2*Math.PI*sources[role].rate+sources[role].phase));gl.uniform1f(gl.getUniformLocation(p,'time'),t);gl.uniform1f(gl.getUniformLocation(p,'scrollZoom'),state.zoom.value);gl.drawArrays(gl.TRIANGLES,0,6);}canvas.classList.add('is-ready');record.frames++;};
      resize();state.loaded=true;record.ready=true;state.draw(0);const reframe=()=>{resize();state.draw(state.sceneTime);zoomDirty=true;};new ResizeObserver(reframe).observe(layer);if(config.role==='marble')addEventListener('resize',reframe,{passive:true});checkReady();
    }).catch(error=>{record.ready=true;record.fallback=true;info.errors.push(String(error));canvas.classList.remove('is-ready');checkReady();});
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();state.loaded=false;record.fallback=true;canvas.classList.remove('is-ready');});
  }
  function checkReady(){info.status=info.roles.length===4&&info.roles.every(r=>r.ready)?'ready':'loading';if(info.status==='ready')setupStraightJoins();}
  let lastTime=0,last=0,start=performance.now();
  for(const config of targets){try{make(config);}catch(error){info.errors.push(String(error));}}
  checkReady();
  const heroHost=document.querySelector('[data-effacer-hero="recursive-soft-no11"]'),heroVideo=heroHost?.querySelector('video');if(heroVideo&&getComputedStyle(heroVideo).transform==='none'){const section=heroHost.closest('section[data-section-id]');if(section)registerZoom(section,{role:'hero',source:'unchanged video; compositor camera only'},heroVideo);}
  const observer=new IntersectionObserver(entries=>{for(const e of entries)for(const s of states)if(s.section===e.target)s.visible=e.isIntersecting;},{rootMargin:'120px'});states.forEach(s=>observer.observe(s.section));
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  function tick(now){updateScrollZoom(now);const regularFrame=now-last>1000/30;if(!document.hidden){lastTime=(now-start)/1000;for(const s of states){const active=s.visible||joins.some(j=>j.visible&&j.sourceState===s);if(!s.loaded||!active||reduced.matches)s.lastSceneTime=null;else{if(s.lastSceneTime!==null)s.sceneTime+=Math.min(64,Math.max(0,now-s.lastSceneTime))/1000;s.lastSceneTime=now;}if(s.loaded&&((active&&!reduced.matches&&(regularFrame||s.zoom.changed))||(reduced.matches&&s.zoom.changed)))s.draw(s.sceneTime);}for(const j of joins)if(j.visible&&(regularFrame||j.sourceState?.zoom.changed))j.paint();if(regularFrame)last=now;}else for(const s of states)s.lastSceneTime=null;requestAnimationFrame(tick);}requestAnimationFrame(tick);
  window.__drawFullfieldAt=t=>{for(const s of states)if(s.loaded)s.draw(t);for(const j of joins)j.paint();};
  window.__drawStraightJoins=()=>{for(const j of joins)j.paint();};
})();
