(() => {
  'use strict';
  const root = document.getElementById('compact-navigation');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = 'true';
  const toggle = root.querySelector('button');
  const nav = root.querySelector('nav');
  const links = [...nav.querySelectorAll('a')];
  let opened = false, scrollHidden = false;
  const position=()=>Math.max(0,Math.min(window.scrollY||0,Math.max(0,document.documentElement.scrollHeight-window.innerHeight)));
  let previousY=position(), direction=0, directionStart=previousY;
  function resetDirection(){previousY=position();direction=0;directionStart=previousY;}
  function setScrollHidden(next){
    // An open menu and keyboard-focused toggle remain reachable.
    if(next&&(opened||toggle.matches(':focus-visible')))next=false;
    if(scrollHidden===next)return;
    scrollHidden=next;root.classList.toggle('is-scroll-hidden',next);root.inert=next;
  }
  function onScroll(){
    const y=position(),delta=y-previousY;previousY=y;
    if(y<=60||opened){setScrollHidden(false);direction=0;directionStart=y;return;}
    if(Math.abs(delta)<1)return;
    const next=delta>0?1:-1;
    if(next!==direction){direction=next;directionStart=y-delta;}
    if(direction===1&&y-directionStart>=12)setScrollHidden(true);
    else if(direction===-1&&directionStart-y>=8)setScrollHidden(false);
  }
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',()=>{setScrollHidden(false);resetDirection();},{passive:true});
  function applyLinkNames(){
    let labels={};try{labels=JSON.parse(document.getElementById('site-language-controls')?.textContent||'{}').labels||{}}catch{}
    for(const anchor of document.querySelectorAll('#header [data-header-apply-link]'))anchor.setAttribute('aria-label',labels.Apply||'Apply');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',applyLinkNames,{once:true});else applyLinkNames();
  function setOpen(next, restoreFocus = false) {
    opened = next;
    if(next)setScrollHidden(false);
    resetDirection();
    root.classList.toggle('is-open', next);
    toggle.setAttribute('aria-expanded', String(next));
    toggle.setAttribute('aria-label', next ? 'Close Menu' : 'Open Menu');
    nav.setAttribute('aria-hidden', String(!next));
    nav.inert = !next;
    for (const link of links) link.tabIndex = next ? 0 : -1;
    if (restoreFocus) toggle.focus();
  }
  toggle.addEventListener('click', () => setOpen(!opened));
  nav.addEventListener('click', event => {
    if (event.target.closest('a')) setOpen(false);
  });
  document.addEventListener('pointerdown', event => {
    if (opened && !root.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if(event.key==='Tab'){setScrollHidden(false);resetDirection();}
    if (opened && event.key === 'Escape') {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  document.addEventListener('focusin', event => {
    if(root.contains(event.target))setScrollHidden(false);
    if (opened && !root.contains(event.target)) setOpen(false);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) setOpen(false);
    setScrollHidden(false);resetDirection();
  });
})();
