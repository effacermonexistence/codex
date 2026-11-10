(() => {
  'use strict';
  const script = document.currentScript;
  const reference = JSON.parse(script.dataset.reference);
  const main = document.querySelector('main');
  const holder = main?.querySelector('[data-desktop-brand-holder]');
  const image = main?.querySelector('[data-desktop-brand-image]');
  if (!holder || !image) return;
  const link = image.closest('.site-body-wordmark-link');
  const desktop = matchMedia('(min-width:768px)');
  let probe = null, mobileProbe = null, frame = 0;
  const veil=image.closest('[data-text-veil="wordmark"]');
  function measure() {
    frame = 0;
    // Remove only this policy's override before recovering the authored flow.
    // This happens in one frame, so resize never compounds an old correction.
    holder.removeAttribute('data-desktop-brand-aligned');
    link?.removeAttribute('data-desktop-brand-link-offset');
    link?.style.removeProperty('--desktop-brand-offset');
    // Re-measure the authored flow once; never compound old resize offsets.
    holder.removeAttribute('data-mobile-brand-aligned');
    holder.style.removeProperty('--mobile-brand-padding');
    holder.style.removeProperty('--mobile-content-offset');
    link?.removeAttribute('data-mobile-brand-link-offset');
    link?.style.removeProperty('--mobile-brand-offset');
    veil?.style.removeProperty('--mobile-brand-veil-offset');
    if (!desktop.matches) {
      holder.style.removeProperty('--desktop-brand-padding');
      if (probe) { probe.remove(); probe = null; }
      if (!link || !reference.mobile) return;
      const r=image.getBoundingClientRect(),header=document.getElementById('header');
      const hh=header?.getBoundingClientRect().height || 0;
      if (!r.height || !hh) return;
      const m=reference.mobile;
      if (!mobileProbe) {
        mobileProbe=document.createElement('span');
        mobileProbe.setAttribute('data-mobile-brand-reference','1');
        mobileProbe.setAttribute('aria-hidden','true'); mobileProbe.inert=true;
        mobileProbe.style.height=m.paddingVmax+'vmax';
        mobileProbe.style.width='var(--mobile-entrance-lift,0px)'; main.append(mobileProbe);
      }
      const metric=mobileProbe.getBoundingClientRect();
      const target=hh+metric.height+m.centerRows*m.rowHeight+m.centerGaps*m.gap-metric.width;
      const original=r.top+scrollY+r.height/2;
      const minGap=m.minimumCopyGapRem*(parseFloat(getComputedStyle(document.documentElement).fontSize)||16);
      // Keep a long title or a chapter heading below the full-width mark.
      // This changes only entrance padding; typography and semantic rows survive.
      const candidates=[...holder.querySelectorAll('h1,h2,h3,h4,h5,h6,p,.cr-title')].filter(e=>!e.closest('.site-section-heading,.site-body-wordmark,[data-continuous-render-brand],footer,#site-shared-footer')&&e.textContent.trim()&&getComputedStyle(e).visibility!=='hidden'&&e.getClientRects().length);
      const first=Math.min(...candidates.map(e=>e.getBoundingClientRect().top+scrollY));
      const firstGapDeficit=Number.isFinite(first)?Math.max(0,target+r.height/2+minGap-first):0;
      const section=image.closest('[data-desktop-brand-section]');
      const sectionBottom=section?section.getBoundingClientRect().bottom+scrollY:Infinity;
      const deficit=Math.max(firstGapDeficit,Math.max(0,target+r.height/2+minGap-sectionBottom));
      const padding=parseFloat(getComputedStyle(holder).paddingTop)||0;
      holder.style.setProperty('--mobile-brand-padding',(padding+deficit).toFixed(4)+'px');
      holder.dataset.mobileBrandAligned='1';
      // The mark can move inside its native slot, leaving existing copy/media in
      // place unless the measured minimum gap actually requires more room.
      const adjusted=image.getBoundingClientRect();
      const offset=(target-(adjusted.top+scrollY+adjusted.height/2)).toFixed(4)+'px';
      link.style.setProperty('--mobile-brand-offset',offset);
      veil?.style.setProperty('--mobile-brand-veil-offset',offset);
      link.dataset.mobileBrandLinkOffset='1';
      holder.dataset.mobileBrandStatus='aligned';
      return;
    }
    if (mobileProbe) { mobileProbe.remove(); mobileProbe=null; }
    if (!probe) {
      probe = document.createElement('span');
      probe.setAttribute('data-desktop-brand-reference', '1');
      probe.setAttribute('aria-hidden', 'true');
      probe.inert = true;
      probe.style.width = 'calc(min(var(--sqs-site-max-width,1500px),calc(100vw - var(--sqs-site-gutter,4vw) * 2)) * ' + reference.rowScale + ')';
      probe.style.height = reference.paddingVmax + 'vmax';
      main.append(probe);
    }
    const metric = probe.getBoundingClientRect();
    const rect = image.getBoundingClientRect();
    const header = document.getElementById('header');
    const headerHeight = header?.getBoundingClientRect().height || 0;
    if (!rect.height || !metric.width || !headerHeight) return;
    const targetCenter = headerHeight + metric.height + reference.centerRows * metric.width + reference.centerGaps * reference.gap;
    const currentCenter = rect.top + scrollY + rect.height / 2;
    const authoredPadding = parseFloat(getComputedStyle(holder).paddingTop) || 0;
    const next = authoredPadding + targetCenter - currentCenter;
    if (!Number.isFinite(next)) return;
    if (next < 0) {
      // A legacy grid can place the mark below the target even with zero
      // padding. Move only that link; never invent negative padding or pull
      // unrelated preceding content above the document entrance.
      if (!link) return;
      link.style.setProperty('--desktop-brand-offset', (targetCenter - currentCenter).toFixed(4) + 'px');
      link.setAttribute('data-desktop-brand-link-offset', '1');
      holder.dataset.desktopBrandStatus = 'aligned';
      holder.dataset.desktopBrandVariant = 'isolated-link';
      return;
    }
    holder.style.setProperty('--desktop-brand-padding', next.toFixed(4) + 'px');
    holder.setAttribute('data-desktop-brand-aligned', '1');
    holder.dataset.desktopBrandStatus = 'aligned';
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(measure); }
  // The synchronous first calibration precedes the native document crossfade.
  measure();
  image.addEventListener('load', schedule);
  window.addEventListener('resize', schedule, {passive:true});
  window.addEventListener('pageshow', schedule);
  window.addEventListener('load', schedule, {once:true});
  desktop.addEventListener('change', schedule);
  if (document.fonts) {
    document.fonts.ready.then(schedule);
    document.fonts.addEventListener?.('loadingdone', schedule);
  }
  if (typeof ResizeObserver !== 'undefined') {
    const header = document.getElementById('header');
    if (header) new ResizeObserver(schedule).observe(header);
    // Mobile content can finish reflowing after the header settles (the moving
    // Continuous Render entrance is one example). Track that actual box too.
    const mobileLayout=new ResizeObserver(()=>{ if (!desktop.matches) schedule(); });
    mobileLayout.observe(holder);
    const entrance=image.closest('[data-desktop-brand-section]');
    if (entrance && entrance!==holder) mobileLayout.observe(entrance);
  }
})();
