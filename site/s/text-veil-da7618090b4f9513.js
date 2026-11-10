(() => {
  'use strict';
  if (['/','/exist','/exist-fr'].includes(location.pathname.replace(/\/$/,'')||'/')) return;
  const main=document.querySelector('main');if(!main)return;
  const owners=[...main.querySelectorAll('[data-text-veil]')];if(!owners.length)return;
  const visible=new Set(),pending=new Set(),applied=new WeakMap();let scheduled=0;
  function color(value){
    if(value==='transparent')return[0,0,0,0];
    const wide=value.match(/^color\((?:srgb|display-p3)\s+(.+)\)$/),normal=value.match(/^rgba?\((.+)\)$/);
    const numbers=(wide?.[1]||normal?.[1]||'').match(/[\d.]+%?/g);if(!numbers||numbers.length<3)return null;
    const rgb=numbers.slice(0,3).map(n=>n.endsWith('%')?parseFloat(n)*2.55:parseFloat(n)*(wide?255:1));
    const a=numbers[3];return[...rgb,a===undefined?1:a.endsWith('%')?parseFloat(a)/100:parseFloat(a)];
  }
  function tone(value){
    const rgb=color(value);if(!rgb||rgb[3]<.05)return null;
    const [r,g,b]=rgb.slice(0,3).map(n=>{const s=Math.min(255,Math.max(0,n))/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});
    const light=.2126*r+.7152*g+.0722*b;
    return (light+.05)/.05 >= 1.05/(light+.05)?'dark':'light';
  }
  function shown(node){const s=getComputedStyle(node);return s.display!=='none'&&s.visibility!=='hidden'&&s.visibility!=='collapse'&&node.getClientRects().length>0;}
  function inkRuns(owner){
    const runs=new Map(),seen=new Set(),walker=document.createTreeWalker(owner,NodeFilter.SHOW_TEXT);
    for(let text;(text=walker.nextNode());){
      const parent=text.parentElement;
      if(!text.textContent.trim()||seen.has(parent)||parent.closest('script,style,noscript,template'))continue;
      seen.add(parent);if(shown(parent)){const value=tone(getComputedStyle(parent).color);if(value)runs.set(parent,value);}
    }
    return runs;
  }
  function paintVisible(media,background){
    if(media.tagName==='IMG'&&(!media.complete||!media.naturalWidth))return false;
    const r=media.getBoundingClientRect();if(r.width<=0||r.height<=0)return false;
    let opacity=1;
    for(let n=media;n&&n!==background.parentElement;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden')return false;opacity*=Number(s.opacity);}
    return opacity>.025;
  }
  function hasPainting(owner){
    const section=owner.closest('.page-section');if(!section)return false;
    for(let n=owner;n&&n!==section;n=n.parentElement){
      const s=getComputedStyle(n),rgb=color(s.backgroundColor);
      if(rgb&&rgb[3]>.96&&Math.max(...rgb.slice(0,3))<32&&s.backgroundImage==='none')return false;
    }
    for(const bg of section.querySelectorAll('.section-background')){
      if(bg.closest('.page-section')!==section||!shown(bg))continue;
      const overlay=bg.querySelector('.section-background-overlay');
      if(overlay){const s=getComputedStyle(overlay),rgb=color(s.backgroundColor);if(Number(s.opacity)>.96&&rgb&&rgb[3]>.96&&Math.max(...rgb.slice(0,3))<32)continue;}
      if([...bg.querySelectorAll('img,video,canvas')].some(m=>paintVisible(m,bg)))return true;
      for(const n of [bg,...bg.querySelectorAll('[style]')]){const s=getComputedStyle(n);if(s.backgroundImage!=='none'&&shown(n)&&Number(s.opacity)>.025)return true;}
    }
    return false;
  }
  function reset(owner){for(const node of applied.get(owner)||[]){delete node.dataset.textVeilTone;delete node.dataset.textVeilPosition;}applied.delete(owner);}
  function attach(node,value,list){
    if(!value)return;
    if(getComputedStyle(node).position==='static')node.dataset.textVeilPosition='relative';
    node.dataset.textVeilTone=value;list.push(node);
  }
  function refresh(owner){
    if(!owner.isConnected||!hasPainting(owner)){reset(owner);return;}
    const runs=inkRuns(owner),distinct=new Set(runs.values());
    reset(owner);const list=[];
    if(owner.dataset.textVeil==='wordmark'){attach(owner,'dark',list);}
    else if(owner.dataset.textVeil==='form'){
      const field=owner.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]),textarea,select');
      const style=field&&getComputedStyle(field),base=style&&(tone(style.webkitTextFillColor||'')||tone(style.color));
      if(base){attach(owner,base,list);for(const[node,value]of runs)if(value!==base)attach(node,value,list);}
      else if(distinct.size===1)attach(owner,[...distinct][0],list);
    }
    else if(distinct.size===1){attach(owner,[...distinct][0],list);}
    else{
      for(const[node,value]of runs){
        let nested=false;for(let p=node.parentElement;p;p=p.parentElement){if(runs.get(p)===value){nested=true;break;}if(p===owner)break;}
        if(!nested)attach(node,value,list);
      }
    }
    applied.set(owner,list);
  }
  function flush(){scheduled=0;if(document.hidden)return;const batch=[...pending];pending.clear();for(const owner of batch)if(visible.has(owner))refresh(owner);}
  function queue(owner){if(owner)pending.add(owner);if(!scheduled)scheduled=requestAnimationFrame(flush);}
  const observer=new IntersectionObserver(entries=>{for(const e of entries){if(e.isIntersecting){visible.add(e.target);queue(e.target);}else visible.delete(e.target);}},{rootMargin:'160px'});
  owners.forEach(o=>observer.observe(o));
  function refreshSection(target){const section=target.closest?.('.page-section');for(const owner of visible)if(!section||owner.closest('.page-section')===section)queue(owner);}
  main.addEventListener('load',e=>refreshSection(e.target),true);
  for(const event of ['pointerover','pointerout','focusin','focusout','animationend','transitionend'])main.addEventListener(event,e=>{
    if(event.startsWith('pointer')&&!e.target.closest?.('a,button,input,textarea,select,[role="button"]'))return;
    queue(e.target.closest?.('[data-text-veil]'));
  },{passive:true});
  const changes=new MutationObserver(records=>{for(const r of records){const node=r.target.nodeType===1?r.target:r.target.parentElement;if(!node||node.matches('canvas,video,img')||r.type==='attributes'&&!['class','style'].includes(r.attributeName))continue;const owner=node.closest('[data-text-veil]');if(owner)queue(owner);}});
  changes.observe(main,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style']});
  const resize=new ResizeObserver(()=>{for(const owner of visible)queue(owner);});resize.observe(main);
  window.addEventListener('pageshow',()=>{for(const owner of visible)queue(owner);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)for(const owner of visible)queue(owner);});
  document.fonts?.ready.then(()=>{for(const owner of visible)queue(owner);});
})();
