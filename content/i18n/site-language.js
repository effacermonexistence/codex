/* Locale persistence is first-party only. No translation network calls. */
(() => {
  'use strict';
  const root = document.documentElement;
  // The non-live native empty cart bypasses page HTML and form dictionaries.
  // Only its three observed empty-state display nodes are localized. Never
  // touch native cart configuration, prices, products, inputs or transport.
  const cartDisplay = document.getElementById('site-cart-empty-ui-i18n');
  if (cartDisplay) {
    let config;
    try { config = JSON.parse(cartDisplay.textContent); } catch { config = null; }
    const cart = document.getElementById('sqs-cart-container');
    if (cart && config?.schemaVersion === 1 && config.locale !== 'en' && config.locale === root.dataset.siteLanguage) {
      const selectors = {title:'h2.cart-title',empty:'p[data-test="empty-message"]',continue:'a[data-test="continue-shopping-link"]'};
      const update = () => {
        if (!cart.querySelector(selectors.empty)) return;
        for (const [key,selector] of Object.entries(selectors)) {
          const target=config.labels?.[key],source=config.source?.[key];
          if (typeof target !== 'string' || !target || typeof source !== 'string') continue;
          for (const element of cart.querySelectorAll(selector)) {
            for (const text of element.childNodes) if (text.nodeType === Node.TEXT_NODE && text.nodeValue.trim() === source) text.nodeValue=text.nodeValue.replace(source,target);
            if (element.getAttribute('aria-label') === source) element.setAttribute('aria-label',target);
          }
        }
      };
      update();
      new MutationObserver(update).observe(cart,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-label']});
    }
  }
  // One observed vendor transport-failure wording bypasses its UI dictionary.
  // Normalize only that exact text node in that exact form error element.
  // Never rewrite inputs, arbitrary scripts, unrelated text or form state.
  const formDisplay = document.getElementById('site-form-ui-display-i18n');
  if (formDisplay) {
    let config;
    try { config = JSON.parse(formDisplay.textContent); } catch { config = null; }
    if (config?.schemaVersion === 1 && config.locale !== 'en' && Array.isArray(config.targets)) {
      const knownError = 'There was an error submitting the form.';
      for (const target of config.targets) {
        if (!/^form-context-(?!localized-strings-)[\w-]+$/.test(target.contextScriptId) || typeof target.message !== 'string' || !target.message) continue;
        const block = document.getElementById(target.contextScriptId)?.closest('.sqs-block-form');
        if (!block) continue;
        const update = () => {
          for (const error of block.querySelectorAll('p.form-field-error')) {
            for (const node of error.childNodes) {
              if (node.nodeType !== Node.TEXT_NODE || node.nodeValue.trim() !== knownError) continue;
              const leading = node.nodeValue.match(/^\s*/)[0], trailing = node.nodeValue.match(/\s*$/)[0];
              node.nodeValue = leading + target.message + trailing;
            }
          }
        };
        update();
        new MutationObserver(update).observe(block, { childList: true, subtree: true, characterData: true });
      }
    }
  }
  const labelsNode=document.getElementById('site-language-controls');
  if(labelsNode){let config;try{config=JSON.parse(labelsNode.textContent)}catch{}
    if(config?.schemaVersion===1&&config.locale===root.dataset.siteLanguage){
      const labels=config.labels||{},observed=new WeakSet();
      const update=owner=>{for(const e of [owner,...owner.querySelectorAll('[aria-label],[title],[data-audio-label],.apply-upload-title,.apply-upload-chooser span:not(.apply-upload-plus),.apply-upload-note,.apply-upload-item-state,.apply-upload-remove,.apply-upload-error')]){
        for(const name of ['aria-label','title']){const value=e.getAttribute(name),target=labels[value];if(target&&target!==value)e.setAttribute(name,target)}
        if(e.matches('[data-audio-label],.apply-upload-title,.apply-upload-chooser span:not(.apply-upload-plus),.apply-upload-note,.apply-upload-item-state,.apply-upload-remove,.apply-upload-error')){const target=labels[e.textContent];if(target&&target!==e.textContent)e.textContent=target}
      }};
      const mount=()=>{for(const owner of document.querySelectorAll('#compact-navigation button,#home-ambient-audio,.cr-motion-toggle,#apply-upload-v1'))if(!observed.has(owner)){observed.add(owner);update(owner);new MutationObserver(()=>update(owner)).observe(owner,{attributes:true,attributeFilter:['aria-label','title'],childList:true,subtree:true,characterData:true})}};
      mount();new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});
    }
  }
  const dialog = document.getElementById('site-language-dialog');
  if (!dialog) return;
  const triggers = [...document.querySelectorAll('.site-language-trigger')];
  const close = dialog.querySelector('.site-language-close');
  const search = dialog.querySelector('.site-language-search');
  const items = [...dialog.querySelectorAll('.site-language-list li')];
  const empty = dialog.querySelector('.site-language-empty');
  const selected = root.dataset.siteRequestedLanguage || root.dataset.siteLanguage || 'en';
  let opener = triggers[0];
  const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  function localeHref(raw, language) {
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return raw;
      if (url.pathname.startsWith('/s/') || url.pathname.startsWith('/api/') || /\.[a-z0-9]{1,8}$/i.test(url.pathname)) return raw;
      if (raw.startsWith('#')) return raw;
      url.searchParams.set('lang', language);
      return url.pathname + url.search + url.hash;
    } catch { return raw; }
  }
  function links(node = document) {
    for (const anchor of node.querySelectorAll('a[href]')) {
      if (anchor.dataset.siteLanguageOption || anchor.hasAttribute('download')) continue;
      const href = anchor.getAttribute('href');
      const next = localeHref(href, selected);
      if (next !== href) anchor.setAttribute('href', next);
    }
  }
  for (const trigger of triggers) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-controls', dialog.id);
    trigger.addEventListener('click', event => {
      event.preventDefault(); opener = trigger;
      search.value = '';
      items.forEach(item => { item.hidden = false; });
      empty.hidden = true;
      dialog.showModal();
      (matchMedia('(max-width: 600px)').matches ? close : search).focus();
    });
  }
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener?.focus());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  search.addEventListener('input', () => {
    const query = fold(search.value.trim());
    items.forEach(item => { item.hidden = !fold(item.dataset.languageName).includes(query); });
    empty.hidden = items.some(item => !item.hidden);
  });
  for (const anchor of dialog.querySelectorAll('[data-site-language-option]')) {
    const language = anchor.dataset.siteLanguageOption;
    const url = new URL(location.href);
    url.searchParams.set('lang', language);
    anchor.href = url.pathname + url.search + url.hash;
    anchor.setAttribute('aria-current', String(language === selected));
    anchor.addEventListener('click', () => {
      document.cookie = `effacer_lang=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    });
  }
  // Preserve original hrefs and exact-selector behavior; locale persists in cookie.
  addEventListener('pageshow', event => {
    if(!event.persisted||new URL(location.href).searchParams.has('lang'))return;
    const saved=/(?:^|;\s*)effacer_lang=([^;]*)/.exec(document.cookie)?.[1];
    if(saved&&items.some(x=>x.querySelector('[data-site-language-option="'+saved+'"]'))&&saved!==selected)location.reload();
  });
})();
