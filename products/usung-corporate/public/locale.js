(() => {
  const code = document.documentElement.dataset.language || 'en';
  const dictionary = JSON.parse(document.getElementById('usung-translations').textContent);
  const t = (key, values = {}) => {
    let text = dictionary[key] ?? key;
    for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, value);
    return text;
  };
  window.UsungI18n = { code, t };
  const dialog = document.getElementById('language-dialog');
  const trigger = document.querySelector('.corp-language-button');
  const search = document.getElementById('language-search');
  const items = [...dialog.querySelectorAll('li')];
  const empty = dialog.querySelector('.corp-language-empty');
  trigger.addEventListener('click', () => {
    search.value = '';
    items.forEach(item => item.hidden = false);
    empty.hidden = true;
    dialog.showModal();
    document.body.classList.add('language-open');
    // Keep the phone keyboard closed until the visitor chooses to search.
    (matchMedia('(max-width: 760px)').matches ? dialog.querySelector('.corp-language-close') : search).focus();
  });
  dialog.querySelector('.corp-language-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('language-open');
    trigger.focus();
  });
  const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  search.addEventListener('input', () => {
    const query = fold(search.value.trim());
    items.forEach(item => item.hidden = !fold(item.dataset.languageName).includes(query));
    empty.hidden = items.some(item => !item.hidden);
  });
})();
