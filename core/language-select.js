import { SUPPORTED_LANGUAGES, formatLanguageLabel } from './language-registry.js';
import { t } from './i18n.js';

export function renderLanguageSelect(select, { locale, selectedValue } = {}) {
  if (!select) return;
  const previous = selectedValue || select.value;
  const popular = SUPPORTED_LANGUAGES.filter((language) => language.popular);
  const others = SUPPORTED_LANGUAGES.filter((language) => !language.popular);

  select.innerHTML = '';

  const popularGroup = document.createElement('optgroup');
  popularGroup.label = t(locale, 'popularLanguages');
  for (const language of popular) {
    popularGroup.appendChild(new Option(formatLanguageLabel(language), language.code));
  }

  const allGroup = document.createElement('optgroup');
  allGroup.label = t(locale, 'allLanguages');
  for (const language of others) {
    allGroup.appendChild(new Option(formatLanguageLabel(language), language.code));
  }

  select.append(popularGroup, allGroup);
  if (previous) select.value = previous;
}
