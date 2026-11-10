(() => {
  'use strict';
  const hosts=[...document.querySelectorAll('[data-effacer-circle="recursive-soft"]')];
  if(!hosts.length)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const states=hosts.map(host=>({host,video:host.querySelector('video'),loaded:false,failed:false,visible:false,playResolved:false,generation:0,frame:null}));
  const fallback=s=>s.host.classList.remove('is-playing');
  const mayPlay=s=>s.visible&&!s.failed&&!reduced.matches&&!document.hidden;
  function pause(s) {
    s.generation++;s.playResolved=false;
    if(s.frame!==null&&s.video.cancelVideoFrameCallback)s.video.cancelVideoFrameCallback(s.frame);
    s.frame=null;s.video.pause();fallback(s);
  }
  function load(s) {
    if(s.loaded||s.failed||reduced.matches)return;
    const source=s.video.querySelector('source[data-circle-src]');if(!source)return;
    s.loaded=true;source.src=source.dataset.circleSrc;s.video.load();
  }
  function reveal(s,generation) {
    if(generation!==s.generation||!s.playResolved||!mayPlay(s)||s.video.paused||s.video.readyState<2)return;
    if(s.video.requestVideoFrameCallback) {
      s.frame=s.video.requestVideoFrameCallback(()=>{s.frame=null;if(generation===s.generation&&mayPlay(s)&&!s.video.paused)s.host.classList.add('is-playing');});
    } else {
      requestAnimationFrame(()=>{if(generation===s.generation&&mayPlay(s)&&!s.video.paused&&s.video.readyState>=2)s.host.classList.add('is-playing');});
    }
  }
  function play(s) {
    if(!mayPlay(s)){pause(s);return;}
    load(s);if(!s.loaded)return;
    const generation=++s.generation;s.playResolved=false;
    Promise.resolve(s.video.play()).then(()=>{if(generation===s.generation){s.playResolved=true;reveal(s,generation);}}).catch(()=>{if(generation===s.generation)fallback(s);});
  }
  for(const s of states) {
    if(!s.video)continue;
    s.video.muted=true;s.video.defaultMuted=true;s.video.playsInline=true;
    s.video.addEventListener('playing',()=>reveal(s,s.generation));
    const failure=()=>{s.failed=true;pause(s);};
    s.video.addEventListener('error',failure);
    s.video.querySelector('source')?.addEventListener('error',failure);
    s.video.addEventListener('emptied',()=>fallback(s));
  }
  if('IntersectionObserver' in window) {
    const loading=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){const s=states.find(x=>x.host===e.target);load(s);if(s.loaded)loading.unobserve(e.target);}},{rootMargin:'400px'});
    const visibility=new IntersectionObserver(entries=>{for(const e of entries){const s=states.find(x=>x.host===e.target);s.visible=e.isIntersecting&&e.intersectionRatio>0;play(s);}},{threshold:0});
    for(const s of states){loading.observe(s.host);visibility.observe(s.host);}
  } else for(const s of states){s.visible=true;play(s);}
  const refresh=()=>{for(const s of states)play(s);};
  reduced.addEventListener?.('change',refresh);
  document.addEventListener('visibilitychange',refresh);
})();
