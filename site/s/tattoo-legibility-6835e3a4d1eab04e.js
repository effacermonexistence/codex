(()=>{'use strict';const cfg=window.CR_MOTION;if(!cfg)return;const reduced=matchMedia('(prefers-reduced-motion:reduce)'),mobile=matchMedia('(max-width:767px)'),button=document.querySelector('.cr-motion-toggle'),info=window.__tattooMotion={version:cfg.version,ready:false,active:null,paused:reduced.matches,errors:[],scenes:[]};let motion=!reduced.matches,raf=0;const states=[...document.querySelectorAll('[data-cr-motion-work]')].map((el,i)=>{const work=cfg.works[el.dataset.crMotionWork];if(!work)throw Error('Missing exact tattoo motion source');const video=el.querySelector('video'),record={scene:i,id:el.dataset.crMotionWork,format:null,url:null,loaded:false,playing:false,failed:false};info.scenes.push(record);const s={el,work,video,record,time:0};video.muted=true;video.playsInline=true;video.addEventListener('loadeddata',()=>{record.loaded=true;video.classList.add('is-ready');schedule()});video.addEventListener('playing',()=>{record.playing=true});video.addEventListener('pause',()=>{record.playing=false});video.addEventListener('error',()=>{record.failed=true;record.playing=false;video.classList.remove('is-ready');info.errors.push({id:record.id,format:record.format,code:video.error?.code||0})});return s});
function createTattooSeams(states, info, config) {
  if (!config || states.length < 2) return null;
  const root=document.querySelector('.cr-motion-seam-page');
  if(!root)return null;
  const report=info.seams={version:'continuous-field-seams-v1',halfHeight:0,frames:0,joins:[],errors:[]};
  const frame=document.createElement('canvas'),layer=document.createElement('canvas');
  const out=frame.getContext('2d',{alpha:false}),blend=layer.getContext('2d');
  const joins=states.slice(0,-1).map((a,i)=>{
    const b=states[i+1],top=document.createElement('canvas'),bottom=document.createElement('canvas');
    top.className='cr-motion-seam cr-motion-seam-bottom';bottom.className='cr-motion-seam cr-motion-seam-top';
    for(const c of[top,bottom]){c.setAttribute('aria-hidden','true');c.width=c.height=1;}
    a.el.appendChild(top);b.el.appendChild(bottom);
    const record={index:i,from:a.record.id,to:b.record.id,ready:false,frames:0,visible:false,gap:0};report.joins.push(record);
    return{a,b,top,bottom,record,visible:0,band:null};
  });
  let half=0,raf=0,last=0,moving=false,pairKey=null;
  function geometry(){
    const next=Math.max(150,Math.min(260,innerHeight*.22));
    if(next!==half){half=next;root.style.setProperty('--cr-seam-half',half+'px');report.halfHeight=half;}
    for(const j of joins){const a=j.a.el.getBoundingClientRect(),b=j.b.el.getBoundingClientRect();
      const y=(a.bottom+b.top)/2;j.record.gap=b.top-a.bottom;
      j.band={x:a.left,y:y-half,width:a.width,height:half*2};
      j.visible=Math.max(0,Math.min(y+half,innerHeight)-Math.max(y-half,0));j.record.visible=j.visible>0;
      if(!j.visible&&j.record.ready){for(const c of[j.top,j.bottom]){c.style.opacity='0';c.width=c.height=1;}j.record.ready=false;}
    }
  }
  function source(s){
    const v=s.video;if(!s.record.failed&&v.readyState>=2&&v.videoWidth)return v;
    const image=s.el.querySelector('.cr-motion-media picture img');return image?.complete&&image.naturalWidth?image:null;
  }
  function cover(ctx,media,s,band,dpr){
    const r=s.el.querySelector('.cr-motion-media').getBoundingClientRect();
    function place(image,fit,box=r){
      const sw=image.videoWidth||image.naturalWidth,sh=image.videoHeight||image.naturalHeight;
      const scale=fit==='contain'?Math.min(box.width/sw,box.height/sh):Math.max(box.width/sw,box.height/sh),w=sw*scale,h=sh*scale;
      ctx.drawImage(image,(box.left-band.x+(box.width-w)/2)*dpr,(box.top-band.y+(box.height-h)/2)*dpr,w*dpr,h*dpr);
    }
    if(s.el.dataset.crLegible){
      ctx.fillStyle='#080506';ctx.fillRect(0,0,ctx.canvas.width,ctx.canvas.height);
      const ambient=s.el.querySelector('.cr-visible-ambient img');
      if(ambient?.complete&&ambient.naturalWidth)place(ambient,'cover');
      place(media,'contain',s.el.getBoundingClientRect());
    }else place(media,'cover');
  }
  function draw(){
    const dpr=Math.min(devicePixelRatio||1,1.5);
    for(const j of joins){if(!j.visible)continue;const a=source(j.a),b=source(j.b);if(!a||!b)continue;
      if(Math.abs(j.record.gap)>2){j.record.ready=false;continue;}
      const w=Math.max(1,Math.round(j.band.width*dpr)),h=Math.max(2,Math.round(half*dpr)),full=h*2;
      if(frame.width!==w||frame.height!==full){frame.width=layer.width=w;frame.height=layer.height=full;}
      out.setTransform(1,0,0,1,0,0);out.globalCompositeOperation='source-over';out.globalAlpha=1;
      cover(out,a,j.a,j.band,dpr);
      blend.clearRect(0,0,w,full);blend.globalCompositeOperation='source-over';cover(blend,b,j.b,j.band,dpr);
      const gradient=blend.createLinearGradient(0,0,0,full);gradient.addColorStop(0,'rgba(255,255,255,0)');gradient.addColorStop(1,'rgba(255,255,255,1)');
      blend.globalCompositeOperation='destination-in';blend.fillStyle=gradient;blend.fillRect(0,0,w,full);blend.globalCompositeOperation='source-over';out.drawImage(layer,0,0);
      for(const [canvas,y]of[[j.top,0],[j.bottom,h]]){
        if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
        canvas.getContext('2d',{alpha:false}).drawImage(frame,0,y,w,h,0,0,w,h);canvas.style.opacity='1';
      }
      j.record.ready=true;j.record.frames++;report.frames++;
    }
  }
  function tick(now){raf=0;if(document.hidden||!moving)return;if(now-last>=1000/30){draw();last=now;}if(joins.some(j=>j.visible))raf=requestAnimationFrame(tick);}
  function update(motion){moving=motion;geometry();if(!document.hidden)draw();if(moving&&!document.hidden&&joins.some(j=>j.visible)){if(!raf)raf=requestAnimationFrame(tick);}else if(raf){cancelAnimationFrame(raf);raf=0;}}
  for(const s of states)for(const image of s.el.querySelectorAll('.cr-motion-media picture img'))image.addEventListener('load',()=>update(moving));
  function players(winner){geometry();const ranked=joins.filter(j=>j.visible>1).sort((a,b)=>b.visible-a.visible||Math.abs(a.band.y+half-innerHeight/2)-Math.abs(b.band.y+half-innerHeight/2));
    const j=ranked[0];if(!j){pairKey=null;return new Set(winner?[winner]:[]);}
    if(j.a.record.id===j.b.record.id&&pairKey!==j.record.index&&j.a.video.readyState>=1&&j.b.video.readyState>=1){const lead=winner===j.b?j.b:j.a,other=lead===j.a?j.b:j.a;if(Math.abs(lead.video.currentTime-other.video.currentTime)>.2)other.video.currentTime=lead.video.currentTime;pairKey=j.record.index;}
    return new Set([j.a,j.b]);
  }
  return{players,update};
}

const seams=createTattooSeams(states,info,cfg.seams);
function choose(s){const format=mobile.matches?'mobile':'desktop',asset=s.work[format];if(s.record.format!==format){s.time=s.video.currentTime||0;s.video.pause();s.video.classList.remove('is-ready');s.video.poster=asset.posterUrl;s.video.src=asset.url;s.video.preload='metadata';s.record.format=format;s.record.url=asset.url;s.record.loaded=false;s.record.failed=false;s.video.load();s.video.addEventListener('loadedmetadata',()=>{if(s.time)s.video.currentTime=s.time%s.video.duration},{once:true})}}
function update(){raf=0;info.paused=!motion;let winner=null,best=0;for(const s of states){const r=s.el.getBoundingClientRect(),visible=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));if(visible>best){best=visible;winner=s}if(motion&&r.bottom>-innerHeight&&r.top<innerHeight*2)choose(s)}const active=seams?seams.players(winner):new Set(winner?[winner]:[]);for(const s of states){if(active.has(s)&&motion&&!document.hidden&&!s.record.failed){choose(s);s.video.preload='auto';s.video.play().catch(e=>{if(e.name!=='AbortError'&&e.name!=='NotSupportedError'){s.record.autoplayBlocked=true}});info.active=s.record.scene}else{s.video.pause();if(s.record.format){const r=s.el.getBoundingClientRect();if(r.bottom< -innerHeight*3||r.top>innerHeight*4){s.time=s.video.currentTime||0;s.video.removeAttribute('src');s.video.load();s.video.classList.remove('is-ready');s.record.format=null;s.record.loaded=false}}}}if(!motion||document.hidden)info.active=null;if(button){button.textContent=motion?'Ⅱ':'▶';button.setAttribute('aria-label',motion?'Pause motion':'Play motion');button.setAttribute('aria-pressed',String(!motion))}info.active=motion&&!document.hidden?winner?.record.scene??null:null;info.activeScenes=motion&&!document.hidden?[...active].map(s=>s.record.scene):[];seams?.update(motion);info.ready=true}
function schedule(){if(!raf)raf=requestAnimationFrame(update)}button?.addEventListener('click',()=>{motion=!motion;schedule()});reduced.addEventListener('change',()=>{motion=!reduced.matches;schedule()});mobile.addEventListener('change',schedule);addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);document.addEventListener('visibilitychange',schedule);update();})();
