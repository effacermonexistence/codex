(() => {
  'use strict';
  const root = document.getElementById('compact-navigation');
  if (!root || root.dataset.ready) return;
  root.dataset.ready = 'true';
  const toggle = root.querySelector('button');
  const nav = root.querySelector('nav');
  const links = [...nav.querySelectorAll('a')];
  let opened = false;
  function setOpen(next, restoreFocus = false) {
    opened = next;
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
    if (opened && event.key === 'Escape') {
      event.preventDefault();
      setOpen(false, true);
    }
  });
  document.addEventListener('focusin', event => {
    if (opened && !root.contains(event.target)) setOpen(false);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) setOpen(false);
  });
})();
