(() => {
  'use strict';
  for (const hero of document.querySelectorAll('main [data-landing-rhythm]')) {
    if (hero.dataset.landingRhythmReady) continue;
    hero.dataset.landingRhythmReady = '1';
    const brand = hero.querySelector('[data-landing-brand]');
    const copy = hero.querySelector('[data-landing-copy]');
    const title = hero.querySelector('[data-landing-title]');
    const logic = hero.querySelector('[data-landing-logic]');
    const action = hero.querySelector('[data-landing-action-link]');
    if (!brand || !copy || !title || !logic || !action) continue;
    let copyLift = 0, actionLift = 0, frame = 0;
    const round = value => Math.round(value * 1000) / 1000;
    function measure() {
      frame = 0;
      const b = brand.getBoundingClientRect();
      const t = title.getBoundingClientRect();
      const l = logic.getBoundingClientRect();
      const a = action.getBoundingClientRect();
      if (!b.height || !t.height || !l.height || !a.height) return;
      // Add our offsets back to recover native gaps; resizing must never
      // halve an already adjusted gap a second time.
      const brandGap = Math.max(0, t.top + copyLift - b.bottom);
      const actionGap = Math.max(0, a.top + actionLift - l.bottom - copyLift);
      const nextCopy = round(brandGap / 2);
      const nextAction = round(nextCopy + actionGap / 3);
      if (Math.abs(nextCopy - copyLift) > .001) {
        copyLift = nextCopy;
        hero.style.setProperty('--landing-copy-lift', copyLift + 'px');
      }
      if (Math.abs(nextAction - actionLift) > .001) {
        actionLift = nextAction;
        hero.style.setProperty('--landing-action-lift', actionLift + 'px');
      }
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(schedule);
      for (const element of [hero, brand, title, logic, action]) observer.observe(element);
    }
    brand.addEventListener('load', schedule);
    window.addEventListener('resize', schedule, {passive: true});
    window.addEventListener('pageshow', schedule);
    for (const event of ['transitionend', 'animationend']) {
      hero.addEventListener(event, e => { if (copy.contains(e.target)) schedule(); }, true);
    }
    if (document.fonts) {
      document.fonts.ready.then(schedule);
      document.fonts.addEventListener?.('loadingdone', schedule);
    }
    schedule();
  }
})();
