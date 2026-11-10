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
    let pageLive=true,visible=true,pending=false,blocked=false,epoch=0,frame=null,watch=0,retry=0;
    let clock=video.currentTime,advancedAt=performance.now(),requestedAt=0,reloads=0,attempts=0;
    const active=()=>pageLive&&!document.hidden&&!still.matches&&visible;
    const status=s=>{host.dataset.heroState=s;};
    function cancelFrame(){if(frame!==null&&video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(frame);frame=null;}
    function poster(s){host.classList.remove('is-playing');status(s);}
    function reveal(){
      if(!active()||video.paused||video.error||video.readyState<2)return;
      if(frame!==null)return;
      const generation=epoch;
      const ready=()=>{frame=null;if(generation===epoch&&active()&&!video.paused&&video.readyState>=2){host.classList.add('is-playing');status('playing');}};
      if(video.requestVideoFrameCallback)frame=video.requestVideoFrameCallback(ready);else ready();
    }
    function pause(reason){
      epoch++;pending=false;cancelFrame();clearTimeout(retry);retry=0;clearInterval(watch);watch=0;
      video.pause();poster(reason);
    }
    function watchdog(){
      if(watch)return;
      watch=setInterval(()=>{
        if(!active()||blocked)return;
        const now=performance.now();
        if(video.currentTime!==clock){clock=video.currentTime;advancedAt=now;return;}
        if(now-advancedAt<6000||now-requestedAt<6000)return;
        // One bounded restart of a genuinely stalled clock, not a frame loop.
        epoch++;pending=false;cancelFrame();video.pause();
        advancedAt=now;
        if(video.readyState<2&&reloads<1){reloads++;video.load();}
        play();
      },1000);
    }
    function play(gesture=false){
      if(!active()){pause(still.matches?'reduced-motion':'paused');return;}
      if(pending||blocked&&!gesture)return;
      const source=video.querySelector('source[data-hero-source]');
      if(source&&!source.getAttribute('src')){source.src=matchMedia('(max-width:767px)').matches?source.dataset.heroMobile:source.dataset.heroDesktop;video.load();}
      if(!video.paused&&!video.error&&video.readyState>=2){reveal();watchdog();return;}
      blocked=false;pending=true;requestedAt=performance.now();const generation=++epoch;
      status('loading');watchdog();
      let request;
      try{request=video.play();}catch(error){request=Promise.reject(error);}
      Promise.resolve(request).then(()=>{
        if(generation!==epoch)return;pending=false;blocked=false;advancedAt=performance.now();reveal();
      }).catch(error=>{
        if(generation!==epoch)return;pending=false;cancelFrame();
        blocked=error?.name==='NotAllowedError';poster(blocked?'waiting-gesture':'buffering');
        if(blocked){clearInterval(watch);watch=0;}
        if(!blocked&&active()&&!retry){
          if(attempts++<3)retry=setTimeout(()=>{retry=0;play();},1500);
          else{blocked=true;clearInterval(watch);watch=0;poster('error');}
        }
      });
    }
    function refresh(){
      const r=host.getBoundingClientRect();visible=r.bottom>0&&r.top<innerHeight;
      if(active())play();else pause(still.matches?'reduced-motion':'paused');
    }
    video.addEventListener('playing',()=>{blocked=false;attempts=0;advancedAt=performance.now();reveal();});
    video.addEventListener('canplay',()=>{if(active()&&!blocked)play();});
    video.addEventListener('waiting',()=>{if(active())status('buffering');});
    video.addEventListener('stalled',()=>{if(active())status('buffering');});
    video.addEventListener('emptied',()=>poster('loading'));
    video.addEventListener('error',()=>{
      poster('error');
      if(active()&&reloads<2&&!retry)retry=setTimeout(()=>{retry=0;reloads++;pending=false;video.load();play();},1500);
    });
    still.addEventListener?.('change',refresh);
    document.addEventListener('visibilitychange',refresh);
    window.addEventListener('pagehide',()=>{pageLive=false;pause('paused');});
    window.addEventListener('pageshow',()=>{pageLive=true;blocked=false;attempts=0;refresh();});
    for(const type of ['pointerdown','touchend','keydown'])window.addEventListener(type,event=>{
      if(event.isTrusted&&active()&&(blocked||video.paused)){blocked=false;attempts=0;play(true);}
    },{passive:true});
    if(window.IntersectionObserver)new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(active())play();else pause('paused');},{threshold:0}).observe(host);
    refresh();
  });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start, {once:true}) : start();
})();
