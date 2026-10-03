const toggle = document.querySelector('.corp-menu-toggle');
const navigation = document.querySelector('.corp-nav');
const setOpen = (open) => {
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? '사업 메뉴 닫기' : '사업 메뉴 열기');
  navigation.classList.toggle('is-open', open);
  document.querySelector('.corp-header').classList.toggle('menu-open', open);
};
toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') { setOpen(false); toggle.focus(); }
});
document.addEventListener('click', event => { if (!event.target.closest('.corp-header')) setOpen(false); });
matchMedia('(min-width: 761px)').addEventListener('change', () => setOpen(false));
// The original construction page keeps its section links and interactions.
const legacy = document.querySelector('.site-header');
if (legacy) legacy.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', () => setOpen(false)));
