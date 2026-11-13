import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { site } from '../config/site';
import en from '../i18n/en.json';
import si from '../i18n/si.json';
import ta from '../i18n/ta.json';
import { asLang, isLang, type Lang } from './lang';

const STORAGE_KEY = 'slccraop.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isLang(saved)) return saved;
  } catch {
    // Storage can be blocked by the browser. Falling back to the browser language is the intended behaviour.
  }
  return typeof navigator === 'undefined' ? 'en' : asLang(navigator.language);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, si: { translation: si }, ta: { translation: ta } },
  lng: initialLang(),
  fallbackLng: 'en',
  initAsync: false,
  interpolation: { escapeValue: false, defaultVariables: { ...site.placeholders } },
  react: { useSuspense: false },
});

i18n.on('languageChanged', (lng) => {
  if (typeof document !== 'undefined') document.documentElement.lang = asLang(lng);
  try {
    localStorage.setItem(STORAGE_KEY, asLang(lng));
  } catch {
    // Not being able to remember the language is harmless.
  }
});
if (typeof document !== 'undefined') document.documentElement.lang = asLang(i18n.language);

export default i18n;
