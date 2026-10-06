(() => {
  // Start a page visit at its landing section, including Safari session restores.
  // Explicit section links such as #contact keep their destination.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  let visitorScrolled = false;
  const markInteraction = () => { visitorScrolled = true; };
  ['wheel', 'touchstart', 'pointerdown'].forEach(type =>
    addEventListener(type, markInteraction, { passive: true })
  );
  addEventListener('keydown', event => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) markInteraction();
  });
  const showLanding = () => {
    if (!location.hash && !visitorScrolled) scrollTo({ top: 0, left: 0, behavior: 'instant' });
  };
  showLanding();
  addEventListener('DOMContentLoaded', showLanding, { once: true });
  addEventListener('pageshow', event => {
    if (event.persisted) visitorScrolled = false;
    showLanding();
    requestAnimationFrame(showLanding);
  });
  const returnToLanding = () => {
    if (location.hash) return;
    visitorScrolled = false;
    showLanding();
    requestAnimationFrame(showLanding);
  };
  addEventListener('popstate', returnToLanding);
  addEventListener('hashchange', returnToLanding);
})();
