// Language coverage follows Apple's public country/region website, with
// country variants combined and both Chinese writing systems retained.
export const languages = [
  ['en', 'English', 'English', 'EN'],
  ['ko', '한국어', 'Korean', 'KO'],
  ['ar', 'العربية', 'Arabic', 'AR'],
  ['bg', 'Български', 'Bulgarian', 'BG'],
  ['zh-CN', '简体中文', 'Chinese, Simplified', '简'],
  ['zh-TW', '繁體中文', 'Chinese, Traditional', '繁'],
  ['hr', 'Hrvatski', 'Croatian', 'HR'],
  ['cs', 'Čeština', 'Czech', 'CS'],
  ['da', 'Dansk', 'Danish', 'DA'],
  ['nl', 'Nederlands', 'Dutch', 'NL'],
  ['et', 'Eesti', 'Estonian', 'ET'],
  ['fi', 'Suomi', 'Finnish', 'FI'],
  ['fr', 'Français', 'French', 'FR'],
  ['de', 'Deutsch', 'German', 'DE'],
  ['el', 'Ελληνικά', 'Greek', 'EL'],
  ['hu', 'Magyar', 'Hungarian', 'HU'],
  ['it', 'Italiano', 'Italian', 'IT'],
  ['ja', '日本語', 'Japanese', 'JA'],
  ['lv', 'Latviešu', 'Latvian', 'LV'],
  ['lt', 'Lietuvių', 'Lithuanian', 'LT'],
  ['no', 'Norsk', 'Norwegian', 'NO'],
  ['pl', 'Polski', 'Polish', 'PL'],
  ['pt', 'Português', 'Portuguese', 'PT'],
  ['ro', 'Română', 'Romanian', 'RO'],
  ['sk', 'Slovenčina', 'Slovak', 'SK'],
  ['es', 'Español', 'Spanish', 'ES'],
  ['sv', 'Svenska', 'Swedish', 'SV'],
  ['th', 'ไทย', 'Thai', 'TH'],
  ['tr', 'Türkçe', 'Turkish', 'TR'],
  ['uk', 'Українська', 'Ukrainian', 'UK'],
  ['vi', 'Tiếng Việt', 'Vietnamese', 'VI']
].map(([code, nativeName, englishName, shortName]) => ({ code, nativeName, englishName, shortName }));

export const languageCodes = new Set(languages.map(language => language.code));

export function languageSelector(route = '/', code = 'en', dictionary = {}) {
  const t = key => (dictionary[key] ?? key).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const current = languages.find(language => language.code === code) || languages[0];
  return `<div class="corp-language" translate="no"><button class="corp-language-button" type="button" aria-haspopup="dialog" aria-controls="language-dialog" aria-label="${t('Language')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/></svg><span>${current.shortName}</span></button></div>
  <dialog class="corp-language-dialog" id="language-dialog" aria-labelledby="language-dialog-title"><div class="corp-language-panel"><div class="corp-language-heading"><span class="corp-language-eyebrow" translate="no">USUNG / LANGUAGE</span><button class="corp-language-close" type="button" aria-label="${t('Close language selector')}"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="m5 5 14 14M5 19 19 5"/></svg></button></div><h2 id="language-dialog-title">${t('Choose your language')}</h2><div class="corp-language-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input type="search" id="language-search" autocomplete="off" placeholder="${t('Search languages')}" aria-label="${t('Search languages')}"></div><ul class="corp-language-list" translate="no">${languages.map(language => `<li data-language-name="${language.nativeName} ${language.englishName} ${language.code}"><a href="${route}?lang=${language.code}" lang="${language.code}" hreflang="${language.code}" data-language="${language.code}" ${language.code === code ? 'aria-current="true"' : ''}><span dir="auto">${language.nativeName}</span><small lang="en">${language.englishName}</small><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg></a></li>`).join('')}</ul><p class="corp-language-empty" hidden>${t('No languages found')}</p></div></dialog>`;
}
