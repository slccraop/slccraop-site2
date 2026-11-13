import type { i18n as I18n } from 'i18next';
import { asLang } from './lang';

/** True when `key` exists in the CURRENT language itself (not only through the English fallback). */
export function isTranslated(i18n: I18n, key: string): boolean {
  const lang = asLang(i18n.language);
  return lang === 'en' || i18n.getResource(lang, 'translation', key) !== undefined;
}
