import { useTranslation } from 'react-i18next';
import { asLang, type Lang } from '../lib/lang';

const OPTIONS: { code: Lang; short: string; full: string }[] = [
  { code: 'en', short: 'EN', full: 'English' },
  { code: 'si', short: 'සිං', full: 'සිංහල' },
  { code: 'ta', short: 'தமிழ்', full: 'தமிழ்' },
];

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = asLang(i18n.language);
  return (
    <span className="lang" role="group" aria-label={t('nav.language')}>
      {OPTIONS.map((o) => (
        <button
          key={o.code}
          type="button"
          lang={o.code}
          aria-label={o.full}
          aria-pressed={current === o.code}
          onClick={() => void i18n.changeLanguage(o.code)}
        >
          {o.short}
        </button>
      ))}
    </span>
  );
}
